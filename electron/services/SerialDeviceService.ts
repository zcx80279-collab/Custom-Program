import { SerialPort } from 'serialport';
import {
  DeviceCompactConfig,
  DeviceInfo,
  DeviceStatus,
  ProtocolCommand,
  ProtocolMessage,
  UsbPortCandidate,
} from '../../src/shared/types';
import {
  buildProtocolMessage,
  encodeProtocolFrame,
  ProtocolStreamParser,
} from '../../src/shared/protocol';

const ESPRESSIF_VID_HEX = '303A';
const DEFAULT_BAUD_RATE = 115200;

type DeviceEvent = {
  type: 'disconnected' | 'reconnected' | 'error' | 'macro_event';
  payload?: unknown;
};

type PendingCall = {
  resolve: (msg: ProtocolMessage) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

export class SerialDeviceService {
  private port: SerialPort | null = null;
  private parser = new ProtocolStreamParser();
  private pending = new Map<string, PendingCall>();
  private eventListeners = new Set<(event: DeviceEvent) => void>();

  public onEvent(listener: (event: DeviceEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emit(event: DeviceEvent): void {
    this.eventListeners.forEach((fn) => fn(event));
  }

  public async listPorts(): Promise<UsbPortCandidate[]> {
    const listed = await SerialPort.list();
    return listed.map((p) => {
      const vid = p.vendorId?.toUpperCase();
      const pid = p.productId?.toUpperCase();
      return {
        path: p.path,
        manufacturer: p.manufacturer,
        serialNumber: p.serialNumber,
        vendorId: vid,
        productId: pid,
        friendlyName: (p as { friendlyName?: string }).friendlyName ?? p.manufacturer ?? p.path,
        isSupportedTarget: vid === ESPRESSIF_VID_HEX,
        transportType: 'ELECTRON_SERIAL',
      };
    });
  }

  public async connect(portPath: string): Promise<{ ok: boolean; info?: DeviceInfo; error?: string }> {
    await this.disconnect();

    try {
      const serial = new SerialPort({
        path: portPath,
        baudRate: DEFAULT_BAUD_RATE,
        autoOpen: false,
      });

      await new Promise<void>((resolve, reject) => {
        serial.open((err) => (err ? reject(err) : resolve()));
      });

      this.port = serial;
      this.parser.reset();

      serial.on('data', (buf: Buffer) => {
        const frames = this.parser.pushChunk(buf.toString('utf8'));
        for (const frame of frames) {
          if (!frame.ok || !frame.message) continue;
          this.handleMessage(frame.message);
        }
      });

      serial.on('close', () => {
        this.rejectAllPending('USB 연결이 종료되었습니다.');
        this.port = null;
        this.emit({ type: 'disconnected' });
      });

      serial.on('error', (err) => {
        this.emit({ type: 'error', payload: err.message });
      });

      // Mandatory Protocol V2 Handshake
      await this.sendRequest(ProtocolCommand.HELLO, { client: 'RoundMacroControllerV2-Windows' });
      const infoRes = await this.sendRequest(ProtocolCommand.GET_INFO);
      const info = infoRes.data as unknown as DeviceInfo;

      return { ok: true, info };
    } catch (err) {
      await this.disconnect();
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async disconnect(): Promise<void> {
    this.rejectAllPending('연결을 해제했습니다.');
    if (this.port && this.port.isOpen) {
      await new Promise<void>((resolve) => {
        this.port!.close(() => resolve());
      });
    }
    this.port = null;
    this.parser.reset();
  }

  /**
   * Triggers ESP32-S3 TinyUSB CDC bootloader entry via the standard 1200bps touch sequence
   * (open at 1200 baud -> pulse DTR high -> DTR low -> close).
   * Safe against immediate USB disconnect when the MCU reboots into ROM download mode.
   */
  public async triggerBootloader1200bps(portPath: string): Promise<{ ok: boolean; error?: string }> {
    await this.disconnect();

    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const serial = new SerialPort({
      path: portPath,
      baudRate: 1200,
      autoOpen: false,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        serial.open((err) => (err ? reject(err) : resolve()));
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const safeSet = (opts: { dtr?: boolean; rts?: boolean }) =>
      new Promise<void>((resolve) => {
        if (!serial.isOpen) {
          resolve();
          return;
        }
        serial.set(opts, () => resolve());
      });

    try {
      await safeSet({ dtr: true, rts: false });
      await wait(60);
      await safeSet({ dtr: false, rts: false });
      await wait(120);
    } finally {
      if (serial.isOpen) {
        await new Promise<void>((resolve) => {
          serial.close(() => resolve());
        });
      }
    }

    return { ok: true };
  }

  public async testConnection(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    try {
      const start = Date.now();
      await this.sendRequest(ProtocolCommand.HELLO, { ping: true }, 2500);
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async getInfo(): Promise<{ ok: boolean; info?: DeviceInfo; error?: string }> {
    try {
      const msg = await this.sendRequest(ProtocolCommand.GET_INFO);
      return { ok: true, info: msg.data as unknown as DeviceInfo };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async getStatus(): Promise<{ ok: boolean; status?: DeviceStatus; error?: string }> {
    try {
      const msg = await this.sendRequest(ProtocolCommand.GET_STATUS);
      return { ok: true, status: msg.data as unknown as DeviceStatus };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async applyConfig(payload: DeviceCompactConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.sendRequest(ProtocolCommand.SET_CONFIG, { config: payload }, 5000);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async getDeviceConfig(): Promise<{ ok: boolean; config?: DeviceCompactConfig; error?: string }> {
    try {
      const msg = await this.sendRequest(ProtocolCommand.GET_CONFIG, undefined, 4000);
      return { ok: true, config: (msg.data as { config?: DeviceCompactConfig })?.config };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async resetDeviceConfig(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.sendRequest(ProtocolCommand.RESET_CONFIG, { confirm: true }, 4000);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private handleMessage(msg: ProtocolMessage): void {
    if (msg.command === ProtocolCommand.MACRO_EVENT) {
      this.emit({ type: 'macro_event', payload: msg.data });
      return;
    }

    const call = this.pending.get(msg.requestId);
    if (!call) return;

    clearTimeout(call.timer);
    this.pending.delete(msg.requestId);

    if (msg.command === ProtocolCommand.ERROR) {
      call.reject(new Error(msg.error?.message ?? '장치 오류 응답'));
    } else {
      call.resolve(msg);
    }
  }

  private sendRequest(
    command: ProtocolCommand,
    data?: Record<string, unknown>,
    timeoutMs = 3000
  ): Promise<ProtocolMessage> {
    if (!this.port || !this.port.isOpen) {
      return Promise.reject(new Error('열려 있는 USB 시리얼 포트가 없습니다.'));
    }

    const msg = buildProtocolMessage(command, data);
    const frame = encodeProtocolFrame(msg);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(msg.requestId);
        reject(new Error(`${command} 명령 응답 시간 초과 (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pending.set(msg.requestId, { resolve, reject, timer });

      this.port!.write(frame, 'utf8', (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(msg.requestId);
          reject(err);
        }
      });
    });
  }

  private rejectAllPending(reason: string): void {
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    });
    this.pending.clear();
  }
}
