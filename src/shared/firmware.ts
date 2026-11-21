export type FirmwareInstallMode = 'INITIAL_INSTALL' | 'UPDATE';

export type FirmwareImageRole = 'bootloader' | 'partitions' | 'boot_app0' | 'app';

export type FirmwareResetMethod = 'default_reset' | 'no_reset';

export const JC3636W518C_TARGET = {
  boardModel: 'Guition JC3636W518C',
  mcu: 'esp32s3',
  flashSize: '16MB',
  flashMode: 'qio',
  flashFreq: '80m',
  espressifVid: '303A',
  /** Verified from firmware/partitions_16mb.csv */
  offsets: {
    bootloader: '0x0000',
    partitions: '0x8000',
    boot_app0: '0xe000',
    app: '0x10000',
    spiffsLittleFs: '0x610000',
  },
  /** Size limits derived from firmware/partitions_16mb.csv */
  maxSizes: {
    bootloader: 0x8000, // 32KB (0x0000 .. 0x8000)
    partitions: 0x1000, // 4KB (0x8000 .. 0x9000)
    boot_app0: 0x2000, // 8KB (0xe000 .. 0x10000)
    app: 0x300000, // 3MB (app0 @ 0x10000, size 0x300000)
  },
} as const;

export interface FirmwareImageEntry {
  role: FirmwareImageRole;
  offset: string;
  fileName: string;
  filePath: string;
  sizeBytes?: number;
  sha256?: string;
  expectedSha256?: string;
  valid?: boolean;
  headerNote?: string;
  error?: string;
}

export interface FirmwarePackageManifest {
  packageFormat: 'rmc-v2-firmware-package';
  schemaVersion: string;
  boardModel: string;
  mcu: string;
  flashSize: string;
  flashMode: string;
  flashFreq?: string;
  firmwareVersion: string;
  environment?: string;
  usbMode?: 'TINYUSB_CDC_HID' | 'HW_CDC_ONLY';
  createdAt?: string;
  images: Array<{
    role: FirmwareImageRole;
    offset: string;
    path: string;
    sha256?: string;
  }>;
}

export interface FirmwareSelectionState {
  sourceType: 'MANIFEST' | 'BIN_IMAGES';
  installMode: FirmwareInstallMode;
  manifestPath?: string;
  firmwareVersion?: string;
  boardModel?: string;
  usbMode?: 'TINYUSB_CDC_HID' | 'HW_CDC_ONLY';
  images: FirmwareImageEntry[];
}

export interface FirmwareValidationReport {
  valid: boolean;
  installMode: FirmwareInstallMode;
  preservesLittleFs: boolean;
  preservesPcConfig: boolean;
  errors: string[];
  warnings: string[];
  images: FirmwareImageEntry[];
  firmwareVersion?: string;
  boardModel?: string;
  usbMode?: 'TINYUSB_CDC_HID' | 'HW_CDC_ONLY';
}

export interface FirmwareToolStatus {
  available: boolean;
  runtime: 'electron-windows' | 'electron-non-windows' | 'browser-preview';
  toolKind?: 'esptool_exe' | 'platformio_python' | 'python_esptool' | 'none';
  toolDisplayName: string;
  toolVersion?: string;
  error?: string;
  installGuidance: string[];
}

export interface FirmwareFlashRequest {
  portPath: string;
  installMode: FirmwareInstallMode;
  resetMethod: FirmwareResetMethod;
  baudRate?: number;
  selection: FirmwareSelectionState;
  userConfirmed: boolean;
  expectedBoardModel?: string;
  previousFirmwareVersion?: string;
}

export type FirmwareFlashStage =
  | 'IDLE'
  | 'VALIDATING'
  | 'PREPARING_PORT'
  | 'CONNECTING_BOOTLOADER'
  | 'FLASHING'
  | 'VERIFYING'
  | 'REBOOTING'
  | 'RECONNECTING'
  | 'COMPLETED'
  | 'FAILED';

export interface FirmwareFlashProgressEvent {
  stage: FirmwareFlashStage;
  percent: number;
  message: string;
  logLine?: string;
  timestamp: string;
}

export interface FirmwareFlashResult {
  ok: boolean;
  stage: FirmwareFlashStage;
  portUsed: string;
  reconnectedPortPath?: string;
  previousFirmwareVersion?: string;
  newFirmwareVersion?: string;
  newUsbMode?: string;
  deviceHasStoredConfig?: boolean;
  deviceReconnected: boolean;
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
  recoverySteps?: string[];
  logs: string[];
  timestamp: string;
}

export interface BrowseFirmwareResult {
  ok: boolean;
  canceled?: boolean;
  selection?: FirmwareSelectionState;
  report?: FirmwareValidationReport;
  error?: string;
}

export interface BrowseSingleFirmwareImageResult {
  ok: boolean;
  canceled?: boolean;
  image?: FirmwareImageEntry;
  error?: string;
}

const VALID_ROLES = new Set<FirmwareImageRole>(['bootloader', 'partitions', 'boot_app0', 'app']);

export function getDefaultOffsetForRole(role: FirmwareImageRole): string {
  return JC3636W518C_TARGET.offsets[role];
}

export function getRoleLabelKo(role: FirmwareImageRole): string {
  switch (role) {
    case 'bootloader':
      return '부트로더 (bootloader.bin)';
    case 'partitions':
      return '파티션 테이블 (partitions.bin)';
    case 'boot_app0':
      return 'OTA 부트 데이터 (boot_app0.bin)';
    case 'app':
      return '애플리케이션 펌웨어 (firmware.bin)';
  }
}

/**
 * Validates a firmware package manifest structure before resolving any files on disk.
 */
export function validateFirmwareManifestObject(raw: unknown): {
  ok: boolean;
  manifest?: FirmwarePackageManifest;
  error?: string;
} {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: '펌웨어 패키지 매니페스트가 올바른 JSON 객체가 아닙니다.' };
  }

  const m = raw as Partial<FirmwarePackageManifest>;
  if (m.packageFormat !== 'rmc-v2-firmware-package') {
    return {
      ok: false,
      error: '지원되지 않는 패키지 형식입니다 (packageFormat: "rmc-v2-firmware-package" 필요).',
    };
  }

  if (m.mcu && m.mcu.toLowerCase() !== 'esp32s3') {
    return {
      ok: false,
      error: `대상 MCU가 일치하지 않습니다 (예상: esp32s3, 입력: ${String(m.mcu)}).`,
    };
  }

  if (m.boardModel && !m.boardModel.includes('JC3636W518C')) {
    return {
      ok: false,
      error: `지원하지 않는 기기용 펌웨어 패키지입니다 (${m.boardModel}). Guition JC3636W518C 전용 펌웨어를 선택하세요.`,
    };
  }

  if (!Array.isArray(m.images) || m.images.length === 0) {
    return { ok: false, error: '펌웨어 패키지에 이미지 목록(images)이 비어 있습니다.' };
  }

  for (const img of m.images) {
    if (!img || !VALID_ROLES.has(img.role)) {
      return { ok: false, error: `알 수 없는 펌웨어 이미지 역할(${String(img?.role)})입니다.` };
    }
    if (typeof img.path !== 'string' || !img.path.trim()) {
      return { ok: false, error: `${img.role} 이미지 경로가 비어 있습니다.` };
    }
    if (typeof img.offset !== 'string' || !/^0x[0-9a-fA-F]+$/.test(img.offset.trim())) {
      return { ok: false, error: `${img.role} 플래시 오프셋(${String(img.offset)})이 올바른 16진수 주소가 아닙니다.` };
    }
    if (img.sha256 !== undefined && !/^[0-9a-fA-F]{64}$/.test(img.sha256)) {
      return { ok: false, error: `${img.role} SHA-256 해시 형식이 올바르지 않습니다.` };
    }
  }

  const hasApp = m.images.some((i) => i.role === 'app');
  if (!hasApp) {
    return { ok: false, error: '펌웨어 패키지에 애플리케이션 이미지(role: "app")가 포함되어 있지 않습니다.' };
  }

  return { ok: true, manifest: m as FirmwarePackageManifest };
}

/**
 * Validates required image roles for Initial Install vs Firmware Update.
 */
export function validateSelectionImageComposition(
  selection: FirmwareSelectionState
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const hasApp = selection.images.some((i) => i.role === 'app');
  const hasBootloader = selection.images.some((i) => i.role === 'bootloader');
  const hasPartitions = selection.images.some((i) => i.role === 'partitions');
  const hasBootApp0 = selection.images.some((i) => i.role === 'boot_app0');

  if (!hasApp) {
    errors.push('애플리케이션 펌웨어(firmware.bin @ 0x10000)가 선택되지 않았습니다.');
  }

  if (selection.installMode === 'INITIAL_INSTALL') {
    if (!hasBootloader) {
      errors.push(
        '최초 설치 모드에서는 부트로더(bootloader.bin @ 0x0000)가 반드시 필요합니다. 단일 firmware.bin만으로는 초기 보드를 부팅할 수 없습니다.'
      );
    }
    if (!hasPartitions) {
      errors.push(
        '최초 설치 모드에서는 파티션 테이블(partitions.bin @ 0x8000)이 반드시 필요합니다.'
      );
    }
    if (!hasBootApp0) {
      warnings.push(
        'boot_app0.bin(@ 0xe000)이 선택되지 않았습니다. OTA 파티션 환경에서는 boot_app0.bin 포함을 권장합니다.'
      );
    }
  } else {
    if (!hasBootloader && !hasPartitions) {
      warnings.push(
        '기존 펌웨어 업데이트 모드: 앱 영역(0x10000)만 기록하므로 0x610000 LittleFS 기기 설정 파티션이 보존됩니다.'
      );
    } else {
      warnings.push(
        '부트로더 또는 파티션 테이블도 함께 선택되었습니다. 파티션 오프셋(0x610000)이 동일하면 설정이 유지되지만, 변경 시 기기 설정을 재적용해야 할 수 있습니다.'
      );
    }
  }

  return { errors, warnings };
}
