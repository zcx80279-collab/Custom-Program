import {
  AppConfig,
  DeviceCompactConfig,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  LayoutPreset,
  LogLevel,
  ProfileDefinition,
} from '../shared/types';
import {
  buildLayoutGeometry,
  ButtonSlotGeometry,
  hitTestCircularDisplay,
} from '../shared/geometry';
import { compileDeviceCompactConfig } from '../shared/protocol';
import { DiagnosticsManager } from './DiagnosticsManager';

const MAX_DEVICE_CONFIG_BYTES = 12288; // 12KB safe payload budget for ESP32-S3 CDC frame & LittleFS

export class DisplayManager {
  constructor(private readonly diagnostics: DiagnosticsManager) {}

  public getResolution(): { width: number; height: number } {
    return { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT };
  }

  public getGeometryForLayout(layout: LayoutPreset): ButtonSlotGeometry[] {
    return buildLayoutGeometry(layout);
  }

  public hitTest(x: number, y: number, profile: ProfileDefinition): number | null {
    return hitTestCircularDisplay(x, y, profile.layout);
  }

  public compileForDevice(config: AppConfig): {
    ok: boolean;
    payload?: DeviceCompactConfig;
    byteSize: number;
    error?: string;
  } {
    const payload = compileDeviceCompactConfig(config);
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    const byteSize = encoded.byteLength;

    if (byteSize > MAX_DEVICE_CONFIG_BYTES) {
      const error = `기기 전송 설정 크기(${byteSize} bytes)가 최대 허용치(${MAX_DEVICE_CONFIG_BYTES} bytes)를 초과했습니다.`;
      this.diagnostics.log(LogLevel.ERROR, 'DisplayManager', error);
      return { ok: false, byteSize, error };
    }

    return { ok: true, payload, byteSize };
  }
}
