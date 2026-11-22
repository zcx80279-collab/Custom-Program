import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  AppConfig,
  DeviceCompactConfig,
  MacroDefinition,
  MacroStepType,
  ProgramLaunchTestRequest,
} from '../src/shared/types';
import {
  FirmwareBuildRequest,
  FirmwareFlashRequest,
  FirmwareImageRole,
  FirmwareInstallMode,
  FirmwareSelectionState,
  getDefaultOffsetForRole,
  getRoleLabelKo,
} from '../src/shared/firmware';
import {
  extractProgramNameFromPath,
  normalizeWindowsPathForMatch,
} from '../src/shared/programLaunch';
import { SerialDeviceService } from './services/SerialDeviceService';
import { WindowsMacroExecutor } from './services/WindowsMacroExecutor';
import { FileConfigStore } from './services/FileConfigStore';
import { FirmwareFlashService } from './services/FirmwareFlashService';
import { FirmwareBuildService } from './services/FirmwareBuildService';

let mainWindow: BrowserWindow | null = null;
const deviceService = new SerialDeviceService();
const macroExecutor = new WindowsMacroExecutor();
const firmwareFlashService = new FirmwareFlashService(deviceService);
const firmwareBuildService = new FirmwareBuildService(firmwareFlashService);
let configStore: FileConfigStore;

/**
 * Paths explicitly chosen by the user through the native OS file picker (`dialog.showOpenDialog`)
 * during the current session. Combined with paths persisted in `configStore`, this ensures that
 * neither external USB events nor arbitrary renderer strings can launch unapproved executables.
 */
const dialogApprovedExecutablePaths = new Set<string>();

function getSavedExecutablePaths(): Set<string> {
  const allowed = new Set<string>();
  try {
    const { config } = configStore.load();
    for (const macro of config.macros) {
      for (const step of macro.steps) {
        if (step.type === MacroStepType.LAUNCH_APP && step.appPath?.trim()) {
          allowed.add(normalizeWindowsPathForMatch(step.appPath));
        }
      }
    }
  } catch {
    // Ignore store read error
  }
  return allowed;
}

function isExecutablePathAuthorized(appPath?: string): boolean {
  if (!appPath || !appPath.trim()) return false;
  const normalized = normalizeWindowsPathForMatch(appPath);
  if (dialogApprovedExecutablePaths.has(normalized)) return true;
  return getSavedExecutablePaths().has(normalized);
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    title: 'RoundMacroController V2',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Prevent navigation to external URLs or arbitrary popups
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const isDev = process.env.RMC_ELECTRON_DEV === 'true';
  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  // --- DeviceManager IPC ---
  ipcMain.handle('rmc:device:listPorts', async () => {
    return deviceService.listPorts();
  });

  ipcMain.handle('rmc:device:connect', async (_evt, portPath: string) => {
    if (firmwareFlashService.isFlashing()) {
      return { ok: false, error: '펌웨어 설치 진행 중에는 일반 USB 연결을 시작할 수 없습니다.' };
    }
    if (typeof portPath !== 'string' || !portPath.trim()) {
      return { ok: false, error: '유효하지 않은 포트 경로입니다.' };
    }
    return deviceService.connect(portPath);
  });

  ipcMain.handle('rmc:device:disconnect', async () => {
    await deviceService.disconnect();
    return { ok: true };
  });

  ipcMain.handle('rmc:device:testConnection', async () => {
    if (firmwareFlashService.isFlashing()) {
      return { ok: false, error: '펌웨어 설치 중입니다.' };
    }
    return deviceService.testConnection();
  });

  ipcMain.handle('rmc:device:getInfo', async () => {
    return deviceService.getInfo();
  });

  ipcMain.handle('rmc:device:getStatus', async () => {
    return deviceService.getStatus();
  });

  ipcMain.handle('rmc:device:applyConfig', async (_evt, payload: DeviceCompactConfig) => {
    if (firmwareFlashService.isFlashing()) {
      return { ok: false, error: '펌웨어 설치 진행 중에는 기기 설정 전송이 중지됩니다.' };
    }
    return deviceService.applyConfig(payload);
  });

  ipcMain.handle('rmc:device:getDeviceConfig', async () => {
    return deviceService.getDeviceConfig();
  });

  ipcMain.handle('rmc:device:resetDeviceConfig', async () => {
    if (firmwareFlashService.isFlashing()) {
      return { ok: false, error: '펌웨어 설치 진행 중에는 기기 초기화를 실행할 수 없습니다.' };
    }
    return deviceService.resetDeviceConfig();
  });

  // --- ConfigManager IPC ---
  ipcMain.handle('rmc:config:load', async () => {
    return configStore.load();
  });

  ipcMain.handle('rmc:config:save', async (_evt, config: AppConfig) => {
    return configStore.save(config);
  });

  ipcMain.handle('rmc:config:exportToFile', async (_evt, config: AppConfig) => {
    if (!mainWindow) return { ok: false, error: '창이 열려 있지 않습니다.' };
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'RoundMacroController V2 설정 내보내기',
      defaultPath: 'roundmacro-v2-config.json',
      filters: [{ name: 'JSON 설정 파일', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, error: '사용자가 취소했습니다.' };
    }
    fs.writeFileSync(result.filePath, JSON.stringify(config, null, 2), 'utf-8');
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle('rmc:config:importFromFile', async () => {
    if (!mainWindow) return { ok: false, error: '창이 열려 있지 않습니다.' };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'RoundMacroController V2 설정 불러오기',
      properties: ['openFile'],
      filters: [{ name: 'JSON 설정 파일', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: '사용자가 취소했습니다.' };
    }
    try {
      const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
      const parsed = JSON.parse(raw) as AppConfig;
      return { ok: true, config: parsed };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // --- MacroEngine IPC (PC-executed whitelisted key automation & Windows program launch) ---

  /**
   * Native Windows file picker restricted to `.exe` executables.
   */
  ipcMain.handle('rmc:macro:browseExecutable', async () => {
    if (!mainWindow) {
      return { ok: false, error: '애플리케이션 창이 열려 있지 않습니다.' };
    }
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '실행할 Windows 프로그램 선택 (.exe)',
        properties: ['openFile'],
        filters: [{ name: 'Windows 실행 파일 (*.exe)', extensions: ['exe'] }],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true };
      }

      const selectedPath = result.filePaths[0];
      if (!/\.exe$/i.test(selectedPath)) {
        return {
          ok: false,
          error: '기본 지원 대상은 Windows 실행 파일(.exe)입니다. .exe 파일을 선택해 주세요.',
        };
      }

      dialogApprovedExecutablePaths.add(normalizeWindowsPathForMatch(selectedPath));

      return {
        ok: true,
        appPath: selectedPath,
        appName: extractProgramNameFromPath(selectedPath),
        workingDir: path.dirname(selectedPath),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /**
   * Native Windows directory picker for optional working directory.
   */
  ipcMain.handle('rmc:macro:browseDirectory', async () => {
    if (!mainWindow) {
      return { ok: false, error: '애플리케이션 창이 열려 있지 않습니다.' };
    }
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '작업 디렉터리 선택',
        properties: ['openDirectory'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true };
      }

      return { ok: true, dirPath: result.filePaths[0] };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /**
   * Checks executable existence, file type, access permission, and optional working directory.
   */
  ipcMain.handle('rmc:macro:validateProgramPath', async (_evt, appPath: string, workingDir?: string) => {
    return macroExecutor.checkProgramPath(appPath, workingDir);
  });

  /**
   * Executes ONLY a saved macro persisted in configStore (used for hardware MACRO_EVENT triggers).
   * Prevents arbitrary external USB commands from executing unsaved or unverified executables.
   */
  ipcMain.handle('rmc:macro:executeSavedMacro', async (_evt, macroId: string, slotIndex?: number) => {
    const start = Date.now();
    if (typeof macroId !== 'string' || !macroId.trim()) {
      return {
        success: false,
        macroId: String(macroId ?? ''),
        macroName: '알 수 없음',
        executedBy: 'PC_AGENT' as const,
        isSimulated: false,
        stepsExecuted: 0,
        durationMs: Date.now() - start,
        errorMessage: '유효하지 않은 매크로 ID입니다.',
        timestamp: new Date().toISOString(),
      };
    }

    const { config } = configStore.load();
    const activeProfile =
      config.profiles.find((p) => p.id === config.activeProfileId) ?? config.profiles[0];

    let resolvedMacroId = macroId;
    if (typeof slotIndex === 'number' && Number.isInteger(slotIndex) && slotIndex >= 0 && activeProfile) {
      const slotBtn = activeProfile.buttons.find((b) => b.slotIndex === slotIndex);
      if (slotBtn) {
        if (!slotBtn.enabled) {
          return {
            success: false,
            macroId: resolvedMacroId,
            macroName: slotBtn.label,
            executedBy: 'PC_AGENT' as const,
            isSimulated: false,
            stepsExecuted: 0,
            durationMs: Date.now() - start,
            errorMessage: `활성 프로필("${activeProfile.name}")의 슬롯 ${slotIndex}이 비활성화되어 있습니다.`,
            timestamp: new Date().toISOString(),
          };
        }
        if (slotBtn.macroId) {
          resolvedMacroId = slotBtn.macroId;
        }
      }
    }

    const savedMacro = config.macros.find((m) => m.id === resolvedMacroId);
    if (!savedMacro) {
      return {
        success: false,
        macroId: resolvedMacroId,
        macroName: '미등록 매크로',
        executedBy: 'PC_AGENT' as const,
        isSimulated: false,
        stepsExecuted: 0,
        durationMs: Date.now() - start,
        errorMessage:
          '저장된 PC 설정에서 해당 매크로를 찾을 수 없습니다. 새 매크로를 만든 경우 먼저 "PC 설정 저장"을 눌러 주세요.',
        timestamp: new Date().toISOString(),
      };
    }

    return macroExecutor.executeMacro(savedMacro);
  });

  /**
   * Executes a macro triggered from the desktop UI (editor/preview test).
   * Any LAUNCH_APP step MUST reference a path either saved in configStore or explicitly picked via dialog.
   */
  ipcMain.handle('rmc:macro:executeOnPc', async (_evt, macro: MacroDefinition) => {
    const start = Date.now();
    if (!macro || !Array.isArray(macro.steps)) {
      return {
        success: false,
        macroId: '',
        macroName: '알 수 없음',
        executedBy: 'PC_AGENT' as const,
        isSimulated: false,
        stepsExecuted: 0,
        durationMs: Date.now() - start,
        errorMessage: '유효하지 않은 매크로 요청입니다.',
        timestamp: new Date().toISOString(),
      };
    }

    for (const step of macro.steps) {
      if (step.type === MacroStepType.LAUNCH_APP && !isExecutablePathAuthorized(step.appPath)) {
        return {
          success: false,
          macroId: macro.id,
          macroName: macro.name,
          executedBy: 'PC_AGENT' as const,
          isSimulated: false,
          stepsExecuted: 0,
          durationMs: Date.now() - start,
          errorMessage:
            '보안 정책상 저장된 매크로 또는 "파일 찾아보기"로 선택한 실행 파일만 실행할 수 있습니다. 직접 입력한 경로를 테스트하려면 먼저 매크로와 "PC 설정 저장"을 완료해 주세요.',
          timestamp: new Date().toISOString(),
        };
      }
    }

    return macroExecutor.executeMacro(macro);
  });

  /**
   * Tests a single LAUNCH_APP step from the Macro Editor.
   * Requires the executable path to be saved in configStore or selected via native file dialog.
   */
  ipcMain.handle('rmc:macro:testLaunchProgram', async (_evt, request: ProgramLaunchTestRequest) => {
    const start = Date.now();
    const rawPath = typeof request?.appPath === 'string' ? request.appPath.trim() : '';
    const appName = request?.appName?.trim() || extractProgramNameFromPath(rawPath) || '프로그램';

    if (!isExecutablePathAuthorized(rawPath)) {
      return {
        ok: false,
        executedBy: 'PC_AGENT' as const,
        isSimulated: false,
        appName,
        appPath: rawPath,
        durationMs: Date.now() - start,
        errorCode: 'UNAUTHORIZED_UNSAVED_PATH',
        errorMessage:
          '보안 정책상 저장된 매크로 또는 "파일 찾아보기"로 선택한 실행 파일만 실행할 수 있습니다. 경로를 직접 수정한 경우 먼저 매크로 저장 및 "PC 설정 저장"을 눌러 주세요.',
        timestamp: new Date().toISOString(),
      };
    }

    return macroExecutor.launchSingleProgram(request);
  });

  // --- Firmware Management IPC (ESP32-S3 flashing via esptool) ---
  ipcMain.handle('rmc:firmware:detectTools', async () => {
    return firmwareFlashService.detectTools();
  });

  ipcMain.handle('rmc:firmware:browseFirmware', async (_evt, mode: FirmwareInstallMode) => {
    if (!mainWindow) {
      return { ok: false, error: '애플리케이션 창이 열려 있지 않습니다.' };
    }
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title:
          mode === 'INITIAL_INSTALL'
            ? 'ESP32-S3 최초 설치용 펌웨어 패키지 또는 firmware.bin 선택'
            : 'ESP32-S3 업데이트용 펌웨어 패키지 또는 firmware.bin 선택',
        properties: ['openFile'],
        filters: [
          { name: 'ESP32-S3 펌웨어 (.rmcfw.json, .json, .bin)', extensions: ['json', 'bin'] },
          { name: '펌웨어 패키지 매니페스트 (*.json)', extensions: ['json'] },
          { name: '바이너리 이미지 (*.bin)', extensions: ['bin'] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true };
      }

      return firmwareFlashService.buildSelectionFromPickedFile(result.filePaths[0], mode);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('rmc:firmware:browseSingleImage', async (_evt, role: FirmwareImageRole) => {
    if (!mainWindow) {
      return { ok: false, error: '애플리케이션 창이 열려 있지 않습니다.' };
    }
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: `${getRoleLabelKo(role)} 파일 선택`,
        properties: ['openFile'],
        filters: [{ name: 'ESP32-S3 바이너리 (*.bin)', extensions: ['bin'] }],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true };
      }

      const filePath = result.filePaths[0];
      firmwareFlashService.authorizeSelectedFile(filePath, false);
      const inspected = firmwareFlashService.inspectSingleImage({
        role,
        offset: getDefaultOffsetForRole(role),
        fileName: path.basename(filePath),
        filePath,
      });
      return { ok: true, image: inspected };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('rmc:firmware:inspectSelection', async (_evt, selection: FirmwareSelectionState) => {
    return firmwareFlashService.inspectSelection(selection);
  });

  ipcMain.handle('rmc:firmware:startFlash', async (_evt, request: FirmwareFlashRequest) => {
    return firmwareFlashService.startFlash(request, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('rmc:firmware:progress', progress);
      }
    });
  });

  ipcMain.handle('rmc:firmware:cancelFlash', async () => {
    return firmwareFlashService.cancelFlash();
  });

  // --- Firmware Build IPC (PlatformIO CLI build + rmc-v2-firmware-package packaging) ---
  ipcMain.handle('rmc:firmware:detectBuildTools', async () => {
    return firmwareBuildService.detectBuildTools();
  });

  ipcMain.handle('rmc:firmware:startBuild', async (_evt, request: FirmwareBuildRequest) => {
    return firmwareBuildService.startBuild(request, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('rmc:firmware:buildProgress', progress);
      }
    });
  });

  ipcMain.handle('rmc:firmware:cancelBuild', async () => {
    return firmwareBuildService.cancelBuild();
  });

  // Forward sanitized hardware events from ESP32-S3 to renderer
  deviceService.onEvent((event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (firmwareFlashService.isFlashing()) return;

    if (event.type === 'macro_event') {
      const raw = event.payload as { macroId?: unknown; slot?: unknown; testMode?: unknown } | undefined;
      if (raw && typeof raw.macroId === 'string' && raw.macroId.trim().length > 0 && raw.macroId.length <= 128) {
        mainWindow.webContents.send('rmc:device:event', {
          type: 'macro_event',
          payload: {
            macroId: raw.macroId.trim(),
            slot: typeof raw.slot === 'number' && Number.isInteger(raw.slot) ? raw.slot : -1,
            testMode: Boolean(raw.testMode),
          },
        });
      }
      return;
    }

    mainWindow.webContents.send('rmc:device:event', event);
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    configStore = new FileConfigStore(app.getPath('userData'));
    registerIpcHandlers();
    createMainWindow();
  });

  app.on('window-all-closed', async () => {
    await deviceService.disconnect();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
