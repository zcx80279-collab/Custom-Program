import {
  ConnectionState,
  DeviceCompactConfig,
  DeviceInfo,
  DeviceStatus,
  LogLevel,
  ProtocolCommand,
  ProtocolMessage,
  UsbPortCandidate,
} from '../shared/types';
import {
  buildProtocolMessage,
  encodeProtocolFrame,
  ProtocolStreamParser,
} from '../shared/protocol';
import { DiagnosticsManager } from './DiagnosticsManager';

// Espressif ESP32-S3 Native USB VID (0x303A)
export const SUPPORTED_ESPRESSIF_VID = 0x303a;

interface WebSerialPortLike {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  getInfo: () => { usbVendorId?: number; usbProductId?: number };
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

interface NavigatorWithSerial extends Navigator {
  serial?: {
    getPorts: () => Promise<WebSerialPortLike[]>;
    requestPort: (options?: { filters?: Array<{ usbVendorId?: number }> }) => Promise<WebSerialPortLike>;
    addEventListener: (type: string, listener: EventListener) => void;
    removeEventListener: (type: string, listener: EventListener) => void;
  };
}

export interface DeviceSnapshot {
  connectionState: ConnectionState;
  runtimeTransport: 'ELECTRON_IPC' | 'WEB_SERIAL' | 'UNAVAILABLE';
  ports: UsbPortCandidate[];
  selectedPortPath: string | null;
  deviceInfo: DeviceInfo | null;
  deviceStatus: DeviceStatus | null;
  autoReconnect: boolean;
  isFlashing: boolean;
  lastError: string | null;
}

type PendingRequest = {
  command: ProtocolCommand;
  startedAt: number;
  resolve: (msg: ProtocolMessage) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

export class DeviceManager {
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private ports: UsbPortCandidate[] = [];
  private selectedPortPath: string | null = null;
  private deviceInfo: DeviceInfo | null = null;
  private deviceStatus: DeviceStatus | null = null;
  private autoReconnect = true;
  private isFlashing = false;
  private lastError: string | null = null;

  private listeners = new Set<() => void>();
  private macroEventListeners = new Set<(macroId: string, slot: number, testMode?: boolean) => void>();

  // Web Serial real transport state (when running in Chromium outside Electron)
  private webPort: WebSerialPortLike | null = null;
  private webReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private webWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private webParser = new ProtocolStreamParser();
  private pendingRequests = new Map<string, PendingRequest>();
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private electronUnsub: (() => void) | null = null;

  constructor(private readonly diagnostics: DiagnosticsManager) {
    this.setupTransportEventListeners();
  }

  public getRuntimeTransport(): DeviceSnapshot['runtimeTransport'] {
    if (window.roundMacroAPI) return 'ELECTRON_IPC';
    if (typeof navigator !== 'undefined' && (navigator as NavigatorWithSerial).serial) {
      return 'WEB_SERIAL';
    }
    return 'UNAVAILABLE';
  }

  public getSnapshot(): DeviceSnapshot {
    return {
      connectionState: this.connectionState,
      runtimeTransport: this.getRuntimeTransport(),
      ports: this.ports,
      selectedPortPath: this.selectedPortPath,
      deviceInfo: this.deviceInfo,
      deviceStatus: this.deviceStatus,
      autoReconnect: this.autoReconnect,
      isFlashing: this.isFlashing,
      lastError: this.lastError,
    };
  }

  public setFlashingState(active: boolean): void {
    this.isFlashing = active;
    if (active) {
      this.stopReconnectLoop();
      this.connectionState = ConnectionState.DISCONNECTED;
      this.deviceInfo = null;
      this.deviceStatus = null;
      this.lastError = null;
    }
    this.emit();
  }

  public async syncPostFlashConnection(reconnectedPortPath?: string): Promise<void> {
    this.isFlashing = false;
    await this.scanPorts();
    if (reconnectedPortPath && window.roundMacroAPI) {
      const infoRes = await window.roundMacroAPI.device.getInfo();
      if (infoRes.ok && infoRes.info) {
        this.selectedPortPath = reconnectedPortPath;
        this.deviceInfo = infoRes.info;
        this.connectionState = ConnectionState.CONNECTED;
        this.lastError = null;
        await this.refreshStatus();
        this.emit();
      }
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public onDeviceMacroTrigger(
    listener: (macroId: string, slot: number, testMode?: boolean) => void
  ): () => void {
    this.macroEventListeners.add(listener);
    return () => this.macroEventListeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  public setAutoReconnect(enabled: boolean): void {
    this.autoReconnect = enabled;
    if (!enabled) {
      this.stopReconnectLoop();
    }
    this.emit();
  }

  private setupTransportEventListeners(): void {
    if (window.roundMacroAPI) {
      this.electronUnsub = window.roundMacroAPI.device.onConnectionEvent((evt) => {
        if (evt.type === 'disconnected') {
          this.handleUnexpectedDisconnect('USB 연결이 해제되었습니다 (Electron Serial).');
        } else if (evt.type === 'error') {
          this.lastError = String(evt.payload ?? '알 수 없는 USB 통신 오류');
          this.connectionState = ConnectionState.ERROR;
          this.diagnostics.log(LogLevel.ERROR, 'DeviceManager', this.lastError);
          this.emit();
        } else if (evt.type === 'macro_event' && evt.payload && typeof evt.payload === 'object') {
          const p = evt.payload as { macroId?: string; slot?: number; testMode?: boolean };
          if (p.macroId) {
            this.macroEventListeners.forEach((fn) => fn(p.macroId!, p.slot ?? -1, p.testMode));
          }
        }
      });
      return;
    }

    const serial = (navigator as NavigatorWithSerial).serial;
    if (serial) {
      serial.addEventListener('disconnect', () => {
        if (this.connectionState === ConnectionState.CONNECTED) {
          this.handleUnexpectedDisconnect('USB 장치가 물리적으로 분리되었습니다.');
        }
      });
    }
  }

  public dispose(): void {
    this.stopReconnectLoop();
    this.electronUnsub?.();
  }

  public async scanPorts(): Promise<UsbPortCandidate[]> {
    this.connectionState =
      this.connectionState === ConnectionState.CONNECTED
        ? ConnectionState.CONNECTED
        : ConnectionState.SCANNING;
    this.lastError = null;
    this.emit();

    const transport = this.getRuntimeTransport();

    if (transport === 'ELECTRON_IPC' && window.roundMacroAPI) {
      try {
        const list = await window.roundMacroAPI.device.listPorts();
        this.ports = list;
        if (this.connectionState === ConnectionState.SCANNING) {
          this.connectionState = ConnectionState.DISCONNECTED;
        }
        this.diagnostics.log(
          LogLevel.INFO,
          'DeviceManager',
          `USB 포트 검색 완료: ${list.length}개 감지 (지원 대상: ${list.filter((p) => p.isSupportedTarget).length}개)`
        );
        this.emit();
        return list;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.lastError = msg;
        this.connectionState = ConnectionState.ERROR;
        this.diagnostics.log(LogLevel.ERROR, 'DeviceManager', 'USB 포트 검색 실패', msg);
        this.emit();
        return [];
      }
    }

    if (transport === 'WEB_SERIAL') {
      try {
        const serial = (navigator as NavigatorWithSerial).serial!;
        const granted = await serial.getPorts();
        this.ports = granted.map((p, idx) => {
          const info = p.getInfo();
          const vidHex = info.usbVendorId ? info.usbVendorId.toString(16).toUpperCase().padStart(4, '0') : undefined;
          const pidHex = info.usbProductId ? info.usbProductId.toString(16).toUpperCase().padStart(4, '0') : undefined;
          return {
            path: `webserial-${idx}-${vidHex ?? '0000'}:${pidHex ?? '0000'}`,
            vendorId: vidHex,
            productId: pidHex,
            friendlyName:
              info.usbVendorId === SUPPORTED_ESPRESSIF_VID
                ? `ESP32-S3 Native USB (VID:${vidHex} PID:${pidHex})`
                : `USB Serial 장치 #${idx + 1}`,
            isSupportedTarget: info.usbVendorId === SUPPORTED_ESPRESSIF_VID,
            transportType: 'WEB_SERIAL',
          };
        });
        if (this.connectionState === ConnectionState.SCANNING) {
          this.connectionState = ConnectionState.DISCONNECTED;
        }
        this.diagnostics.log(
          LogLevel.INFO,
          'DeviceManager',
          `허용된 Web Serial 장치 ${this.ports.length}개 확인됨 (새 장치 추가는 'USB 포트 선택 및 연결' 사용)`
        );
        this.emit();
        return this.ports;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.lastError = msg;
        this.connectionState = ConnectionState.DISCONNECTED;
        this.diagnostics.log(LogLevel.WARN, 'DeviceManager', 'Web Serial 포트 조회 실패', msg);
        this.emit();
        return [];
      }
    }

    // Unavailable transport (e.g., non-Chromium iframe without Electron)
    this.ports = [];
    this.connectionState = ConnectionState.DISCONNECTED;
    this.diagnostics.log(
      LogLevel.WARN,
      'DeviceManager',
      '현재 브라우저 환경에서는 직접 USB 시리얼 접근이 제한됩니다. Windows Electron 앱으로 실행하거나 Chromium Web Serial 권한이 필요합니다.'
    );
    this.emit();
    return [];
  }

  public async connect(portPath?: string): Promise<{ ok: boolean; error?: string }> {
    if (this.isFlashing) {
      return { ok: false, error: '펌웨어 설치 진행 중에는 일반 USB 연결을 시작할 수 없습니다.' };
    }
    const transport = this.getRuntimeTransport();
    this.stopReconnectLoop();
    this.lastError = null;
    this.connectionState = ConnectionState.CONNECTING;
    this.emit();

    // 1. Electron Desktop USB Serial
    if (transport === 'ELECTRON_IPC' && window.roundMacroAPI) {
      const targetPort = portPath ?? this.selectedPortPath ?? this.ports.find((p) => p.isSupportedTarget)?.path;
      if (!targetPort) {
        this.connectionState = ConnectionState.DISCONNECTED;
        this.lastError = '연결할 USB 포트를 먼저 선택해 주세요.';
        this.emit();
        return { ok: false, error: this.lastError };
      }

      const start = performance.now();
      const res = await window.roundMacroAPI.device.connect(targetPort);
      const latencyMs = Math.round(performance.now() - start);
      if (!res.ok || !res.info) {
        this.connectionState = ConnectionState.ERROR;
        this.lastError = res.error ?? '기기 핸드셰이크(HELLO/GET_INFO)에 실패했습니다.';
        this.diagnostics.recordCommResult({
          command: ProtocolCommand.HELLO,
          requestId: 'electron-connect',
          success: false,
          latencyMs,
          summary: this.lastError,
        });
        this.emit();
        return { ok: false, error: this.lastError };
      }

      this.selectedPortPath = targetPort;
      this.deviceInfo = res.info;
      this.connectionState = ConnectionState.CONNECTED;
      this.diagnostics.recordCommResult({
        command: ProtocolCommand.GET_INFO,
        requestId: 'electron-connect',
        success: true,
        latencyMs,
        summary: `${res.info.deviceName} (${res.info.firmwareVersion}) 연결 완료`,
      });
      this.diagnostics.log(
        LogLevel.INFO,
        'DeviceManager',
        `실제 기기 연결 성공: ${res.info.deviceName} [${targetPort}]`
      );
      await this.refreshStatus();
      this.emit();
      return { ok: true };
    }

    // 2. Real Chromium Web Serial API
    if (transport === 'WEB_SERIAL') {
      try {
        const serial = (navigator as NavigatorWithSerial).serial!;
        const selectedPort = await serial.requestPort({
          filters: [{ usbVendorId: SUPPORTED_ESPRESSIF_VID }],
        });
        await selectedPort.open({ baudRate: 115200 });
        this.webPort = selectedPort;
        const info = selectedPort.getInfo();
        const vidHex = info.usbVendorId?.toString(16).toUpperCase().padStart(4, '0') ?? '----';
        const pidHex = info.usbProductId?.toString(16).toUpperCase().padStart(4, '0') ?? '----';
        this.selectedPortPath = `WebSerial(VID:${vidHex},PID:${pidHex})`;
        this.startWebSerialReadLoop();

        // Execute mandatory Protocol V2 handshake (HELLO -> GET_INFO -> GET_STATUS)
        await this.sendWebSerialRequest(ProtocolCommand.HELLO, { client: 'RoundMacroControllerV2-Web' });
        const infoResp = await this.sendWebSerialRequest(ProtocolCommand.GET_INFO);
        this.deviceInfo = (infoResp.data as unknown as DeviceInfo) ?? null;

        this.connectionState = ConnectionState.CONNECTED;
        this.diagnostics.log(
          LogLevel.INFO,
          'DeviceManager',
          `Web Serial 실제 기기 연결 성공: ${this.deviceInfo?.deviceName ?? 'ESP32-S3'}`
        );
        await this.refreshStatus();
        this.emit();
        return { ok: true };
      } catch (err) {
        await this.closeWebSerialQuietly();
        const msg = err instanceof Error ? err.message : String(err);
        this.connectionState = ConnectionState.DISCONNECTED;
        this.lastError = `USB 연결 실패: ${msg}`;
        this.diagnostics.log(LogLevel.ERROR, 'DeviceManager', this.lastError);
        this.emit();
        return { ok: false, error: this.lastError };
      }
    }

    this.connectionState = ConnectionState.DISCONNECTED;
    this.lastError =
      '현재 실행 환경(브라우저/샌드박스)에서는 USB 포트를 열 수 없습니다. Windows Electron 빌드 환경에서 실제 USB 기기와 연결해 주세요.';
    this.diagnostics.log(LogLevel.WARN, 'DeviceManager', this.lastError);
    this.emit();
    return { ok: false, error: this.lastError };
  }

  public async disconnect(): Promise<void> {
    this.stopReconnectLoop();
    if (window.roundMacroAPI) {
      await window.roundMacroAPI.device.disconnect();
    } else {
      await this.closeWebSerialQuietly();
    }
    this.connectionState = ConnectionState.DISCONNECTED;
    this.deviceInfo = null;
    this.deviceStatus = null;
    this.diagnostics.log(LogLevel.INFO, 'DeviceManager', 'USB 기기 연결을 해제했습니다.');
    this.emit();
  }

  public async testConnection(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    if (this.connectionState !== ConnectionState.CONNECTED) {
      return { ok: false, error: '연결된 실제 USB 기기가 없습니다.' };
    }

    if (window.roundMacroAPI) {
      const res = await window.roundMacroAPI.device.testConnection();
      this.diagnostics.recordCommResult({
        command: ProtocolCommand.HELLO,
        requestId: 'conn-test',
        success: res.ok,
        latencyMs: res.latencyMs ?? 0,
        summary: res.ok
          ? `연결 테스트 성공 (왕복 ${res.latencyMs ?? 0}ms)`
          : `연결 테스트 실패: ${res.error ?? '응답 없음'}`,
      });
      return res;
    }

    try {
      const start = performance.now();
      await this.sendWebSerialRequest(ProtocolCommand.HELLO, { ping: true });
      const latencyMs = Math.round(performance.now() - start);
      return { ok: true, latencyMs };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, error };
    }
  }

  public async refreshStatus(): Promise<{ ok: boolean; status?: DeviceStatus; error?: string }> {
    if (this.connectionState !== ConnectionState.CONNECTED) {
      return { ok: false, error: '연결된 기기가 없습니다.' };
    }

    if (window.roundMacroAPI) {
      const res = await window.roundMacroAPI.device.getStatus();
      if (res.ok && res.status) {
        this.deviceStatus = res.status;
        this.emit();
      }
      return res;
    }

    try {
      const resp = await this.sendWebSerialRequest(ProtocolCommand.GET_STATUS);
      this.deviceStatus = (resp.data as unknown as DeviceStatus) ?? null;
      this.emit();
      return { ok: true, status: this.deviceStatus ?? undefined };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, error };
    }
  }

  public async applyConfigToDevice(payload: DeviceCompactConfig): Promise<{ ok: boolean; error?: string }> {
    if (this.isFlashing) {
      const error = '펌웨어 설치 진행 중에는 기기 설정 전송이 중지됩니다.';
      this.diagnostics.log(LogLevel.WARN, 'DeviceManager', error);
      return { ok: false, error };
    }
    if (this.connectionState !== ConnectionState.CONNECTED) {
      const error = '실제 USB 기기가 연결되어 있지 않아 설정을 전송할 수 없습니다.';
      this.diagnostics.log(LogLevel.WARN, 'DeviceManager', error);
      return { ok: false, error };
    }

    if (window.roundMacroAPI) {
      const start = performance.now();
      const res = await window.roundMacroAPI.device.applyConfig(payload);
      const latencyMs = Math.round(performance.now() - start);
      this.diagnostics.recordCommResult({
        command: ProtocolCommand.SET_CONFIG,
        requestId: 'apply-cfg',
        success: res.ok,
        latencyMs,
        summary: res.ok
          ? `프로필 "${payload.profileName}" 기기 적용 완료`
          : `기기 설정 적용 실패: ${res.error ?? '오류'}`,
      });
      if (res.ok) await this.refreshStatus();
      return res;
    }

    try {
      await this.sendWebSerialRequest(ProtocolCommand.SET_CONFIG, { config: payload });
      await this.refreshStatus();
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, error };
    }
  }

  public async resetDeviceConfig(): Promise<{ ok: boolean; error?: string }> {
    if (this.isFlashing) {
      return { ok: false, error: '펌웨어 설치 진행 중에는 기기 설정 초기화를 실행할 수 없습니다.' };
    }
    if (this.connectionState !== ConnectionState.CONNECTED) {
      const error = '실제 USB 기기가 연결되어 있지 않아 기기 설정을 초기화할 수 없습니다.';
      this.diagnostics.log(LogLevel.WARN, 'DeviceManager', error);
      return { ok: false, error };
    }

    if (window.roundMacroAPI) {
      const start = performance.now();
      const res = await window.roundMacroAPI.device.resetDeviceConfig();
      const latencyMs = Math.round(performance.now() - start);
      this.diagnostics.recordCommResult({
        command: ProtocolCommand.RESET_CONFIG,
        requestId: 'reset-cfg',
        success: res.ok,
        latencyMs,
        summary: res.ok
          ? '기기 저장 설정 초기화 완료 (PC 설정 원본 유지됨)'
          : `기기 설정 초기화 실패: ${res.error ?? '오류'}`,
      });
      if (res.ok) await this.refreshStatus();
      return res;
    }

    try {
      await this.sendWebSerialRequest(ProtocolCommand.RESET_CONFIG, { confirm: true });
      await this.refreshStatus();
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, error };
    }
  }

  private handleUnexpectedDisconnect(reason: string): void {
    if (this.isFlashing) {
      return;
    }
    this.connectionState = this.autoReconnect
      ? ConnectionState.RECONNECTING
      : ConnectionState.DISCONNECTED;
    this.deviceInfo = null;
    this.deviceStatus = null;
    this.lastError = reason;
    this.diagnostics.log(LogLevel.WARN, 'DeviceManager', reason);
    this.emit();

    if (this.autoReconnect && this.selectedPortPath && window.roundMacroAPI) {
      this.startReconnectLoop();
    }
  }

  private startReconnectLoop(): void {
    this.stopReconnectLoop();
    this.reconnectTimer = setInterval(async () => {
      if (!this.autoReconnect || !this.selectedPortPath || this.connectionState === ConnectionState.CONNECTED) {
        this.stopReconnectLoop();
        return;
      }
      this.diagnostics.log(LogLevel.INFO, 'DeviceManager', `자동 재연결 시도 중: ${this.selectedPortPath}`);
      const res = await this.connect(this.selectedPortPath);
      if (res.ok) {
        this.stopReconnectLoop();
      }
    }, 3000);
  }

  private stopReconnectLoop(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startWebSerialReadLoop(): void {
    if (!this.webPort?.readable) return;
    const decoder = new TextDecoder();
    this.webReader = this.webPort.readable.getReader();

    (async () => {
      try {
        while (this.webReader) {
          const { value, done } = await this.webReader.read();
          if (done) break;
          if (value) {
            const text = decoder.decode(value, { stream: true });
            const frames = this.webParser.pushChunk(text);
            for (const frame of frames) {
              if (!frame.ok || !frame.message) {
                this.diagnostics.log(
                  LogLevel.WARN,
                  'Protocol',
                  `손상된 USB 프레임 폐기: ${frame.errorMessage}`,
                  frame.rawLine.slice(0, 120)
                );
                continue;
              }
              this.handleIncomingWebSerialMessage(frame.message);
            }
          }
        }
      } catch (err) {
        if (this.connectionState === ConnectionState.CONNECTED) {
          this.handleUnexpectedDisconnect(
            `USB 수신 스트림 중단: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    })();
  }

  private handleIncomingWebSerialMessage(msg: ProtocolMessage): void {
    const rawPreview = JSON.stringify(msg);
    this.diagnostics.log(LogLevel.RX, 'Protocol', `RX ${msg.command} [${msg.requestId}] 수신 완료`, rawPreview.slice(0, 450));

    if (msg.command === ProtocolCommand.MACRO_EVENT) {
      const data = msg.data as { macroId?: string; slot?: number; testMode?: boolean } | undefined;
      if (data?.macroId) {
        this.macroEventListeners.forEach((fn) => fn(data.macroId!, data.slot ?? -1, data.testMode));
      }
      return;
    }

    const pending = this.pendingRequests.get(msg.requestId);
    if (!pending) return;

    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(msg.requestId);
    const latencyMs = Math.round(performance.now() - pending.startedAt);

    if (msg.command === ProtocolCommand.ERROR) {
      const errMsg = msg.error?.message ?? '장치에서 ERROR 응답을 반환했습니다.';
      this.diagnostics.recordCommResult({
        command: pending.command,
        requestId: msg.requestId,
        success: false,
        latencyMs,
        summary: `${pending.command} 오류: ${errMsg}`,
      });
      pending.reject(new Error(errMsg));
      return;
    }

    this.diagnostics.recordCommResult({
      command: pending.command,
      requestId: msg.requestId,
      success: true,
      latencyMs,
      summary: `${pending.command} 성공 (${latencyMs}ms)`,
    });
    pending.resolve(msg);
  }

  private async sendWebSerialRequest(
    command: ProtocolCommand,
    data?: Record<string, unknown>,
    timeoutMs = 3000
  ): Promise<ProtocolMessage> {
    if (!this.webPort?.writable) {
      throw new Error('USB 쓰기 스트림이 열려 있지 않습니다.');
    }

    const msg = buildProtocolMessage(command, data);
    const frame = encodeProtocolFrame(msg);
    const encoded = new TextEncoder().encode(frame);
    const payloadStr = JSON.stringify(msg);

    if (!this.webWriter) {
      this.webWriter = this.webPort.writable.getWriter();
    }

    this.diagnostics.log(
      LogLevel.TX,
      'Protocol',
      `TX ${command} [${msg.requestId}] 패킷 전송 (길이: ${encoded.length} bytes)`,
      payloadStr.slice(0, 500)
    );

    return new Promise<ProtocolMessage>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(msg.requestId);
        const timeoutSummary = `[TIMEOUT] ${command} 명령 응답 시간 초과 (${timeoutMs}ms) — 마지막 전송 패킷 상세: requestId=${msg.requestId}, payloadSize=${payloadStr.length} bytes`;
        this.diagnostics.log(
          LogLevel.ERROR,
          'Protocol',
          timeoutSummary,
          payloadStr
        );
        const err = new Error(`${command} 응답 시간 초과 (${timeoutMs}ms)`);
        this.diagnostics.recordCommResult({
          command,
          requestId: msg.requestId,
          success: false,
          latencyMs: timeoutMs,
          summary: err.message,
        });
        reject(err);
      }, timeoutMs);

      this.pendingRequests.set(msg.requestId, {
        command,
        startedAt: performance.now(),
        resolve,
        reject,
        timeoutId,
      });

      this.webWriter!.write(encoded).catch((writeErr) => {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(msg.requestId);
        const writeErrMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
        this.diagnostics.log(LogLevel.ERROR, 'Protocol', `TX Write Error [${msg.requestId}]: ${writeErrMsg}`);
        reject(writeErr instanceof Error ? writeErr : new Error(String(writeErr)));
      });
    });
  }

  private async closeWebSerialQuietly(): Promise<void> {
    this.pendingRequests.forEach((p) => {
      clearTimeout(p.timeoutId);
      p.reject(new Error('연결이 종료되었습니다.'));
    });
    this.pendingRequests.clear();

    try {
      await this.webReader?.cancel();
      this.webReader?.releaseLock();
    } catch {
      // ignore
    }
    try {
      this.webWriter?.releaseLock();
    } catch {
      // ignore
    }
    try {
      await this.webPort?.close();
    } catch {
      // ignore
    }
    this.webReader = null;
    this.webWriter = null;
    this.webPort = null;
    this.webParser.reset();
  }
}
