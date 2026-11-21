import {
  AppConfig,
  DeviceCompactConfig,
  MacroExecutionMode,
  MacroStepType,
  PROTOCOL_VERSION,
  ProtocolCommand,
  ProtocolErrorPayload,
  ProtocolMessage,
} from './types';
import { getKeySpec, modifiersToHidMask } from './keycodes';
import { macroHasLaunchApp } from './programLaunch';

/**
 * Framing specification (Protocol V2):
 *   $<HEX_CRC16_CCITT>:<JSON_PAYLOAD>\n
 *
 * Example:
 *   $4A9F:{"version":"2.0","requestId":"req-1","command":"HELLO","timestampMs":1700000000}\n
 *
 * - Start sentinel '$' discards leading garbage / boot ROM text from ESP32-S3.
 * - CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) verifies payload integrity.
 * - Newline '\n' terminates each frame; partial chunks are buffered across USB CDC reads.
 */

export const MAX_FRAME_BYTES = 16384;

export function crc16Ccitt(input: string): number {
  let crc = 0xffff;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc;
}

export function formatCrc16Hex(crc: number): string {
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function createRequestId(prefix = 'rmc'): string {
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function buildProtocolMessage<T = Record<string, unknown>>(
  command: ProtocolCommand,
  data?: T,
  requestId?: string,
  error?: ProtocolErrorPayload
): ProtocolMessage<T> {
  return {
    version: PROTOCOL_VERSION,
    requestId: requestId ?? createRequestId(),
    command,
    timestampMs: Date.now(),
    ...(data !== undefined ? { data } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

export function encodeProtocolFrame<T = Record<string, unknown>>(message: ProtocolMessage<T>): string {
  const json = JSON.stringify(message);
  const crc = formatCrc16Hex(crc16Ccitt(json));
  return `$${crc}:${json}\n`;
}

export interface ParsedFrameResult {
  ok: boolean;
  message?: ProtocolMessage;
  rawLine: string;
  errorCode?: 'MISSING_SENTINEL' | 'INVALID_CRC_FORMAT' | 'CRC_MISMATCH' | 'INVALID_JSON' | 'INVALID_SCHEMA';
  errorMessage?: string;
}

export function decodeProtocolFrame(rawLine: string): ParsedFrameResult {
  const trimmed = rawLine.trim();
  const sentinelIdx = trimmed.indexOf('$');
  if (sentinelIdx === -1) {
    return {
      ok: false,
      rawLine: trimmed,
      errorCode: 'MISSING_SENTINEL',
      errorMessage: '프레임 시작 문자($)를 찾을 수 없습니다.',
    };
  }

  const body = trimmed.slice(sentinelIdx + 1);
  if (body.length < 6 || body[4] !== ':') {
    return {
      ok: false,
      rawLine: trimmed,
      errorCode: 'INVALID_CRC_FORMAT',
      errorMessage: 'CRC16 헤더 형식이 올바르지 않습니다.',
    };
  }

  const receivedCrcHex = body.slice(0, 4).toUpperCase();
  const jsonStr = body.slice(5);
  const expectedCrcHex = formatCrc16Hex(crc16Ccitt(jsonStr));

  if (receivedCrcHex !== expectedCrcHex) {
    return {
      ok: false,
      rawLine: trimmed,
      errorCode: 'CRC_MISMATCH',
      errorMessage: `체크섬 불일치 (수신: ${receivedCrcHex}, 계산: ${expectedCrcHex})`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return {
      ok: false,
      rawLine: trimmed,
      errorCode: 'INVALID_JSON',
      errorMessage: 'JSON 구문 분석에 실패했습니다.',
    };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as ProtocolMessage).version !== 'string' ||
    typeof (parsed as ProtocolMessage).requestId !== 'string' ||
    typeof (parsed as ProtocolMessage).command !== 'string'
  ) {
    return {
      ok: false,
      rawLine: trimmed,
      errorCode: 'INVALID_SCHEMA',
      errorMessage: '필수 프로토콜 필드(version, requestId, command)가 누락되었습니다.',
    };
  }

  return {
    ok: true,
    rawLine: trimmed,
    message: parsed as ProtocolMessage,
  };
}

/**
 * Stateful USB CDC stream parser that safely handles fragmented packets,
 * concatenated packets, and line-buffer overflow protection.
 */
export class ProtocolStreamParser {
  private buffer = '';

  public pushChunk(chunk: string): ParsedFrameResult[] {
    const results: ParsedFrameResult[] = [];
    this.buffer += chunk;

    if (this.buffer.length > MAX_FRAME_BYTES * 2) {
      // Prevent unbounded memory growth on corrupted stream
      const lastSentinel = this.buffer.lastIndexOf('$');
      this.buffer = lastSentinel >= 0 ? this.buffer.slice(lastSentinel) : '';
    }

    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.trim().length > 0) {
        results.push(decodeProtocolFrame(line));
      }
      newlineIndex = this.buffer.indexOf('\n');
    }

    return results;
  }

  public reset(): void {
    this.buffer = '';
  }
}

/**
 * Compiles the active profile + bound macros into a compact deterministic payload
 * suitable for ESP32-S3 LittleFS/NVS storage and fast rendering/execution.
 */
export function compileDeviceCompactConfig(config: AppConfig): DeviceCompactConfig {
  const activeProfile =
    config.profiles.find((p) => p.id === config.activeProfileId) ?? config.profiles[0];

  const macroMap = new Map(config.macros.map((m) => [m.id, m]));

  return {
    schemaVersion: config.schemaVersion,
    profileId: activeProfile.id,
    profileName: activeProfile.name,
    layout: activeProfile.layout,
    backgroundColor: activeProfile.backgroundColor,
    testMode: Boolean(config.preferences?.macroTestMode),
    buttons: activeProfile.buttons.map((btn) => {
      const macro = btn.macroId ? macroMap.get(btn.macroId) : undefined;
      const containsLaunchApp = macro ? macroHasLaunchApp(macro) : false;

      // Windows program launch macros MUST run exclusively on PC_AGENT.
      // Never transmit Windows paths, arguments, or working directories to ESP32-S3.
      const compiledMode = !macro
        ? MacroExecutionMode.DEVICE_HID
        : containsLaunchApp
          ? MacroExecutionMode.PC_AGENT
          : macro.executionMode;

      const compiledSteps =
        macro && !containsLaunchApp
          ? macro.steps
              .filter((step) => step.type !== MacroStepType.LAUNCH_APP)
              .map((step) => {
                if (step.type === MacroStepType.DELAY) {
                  return {
                    t: 'DELAY' as const,
                    ms: Math.min(10000, Math.max(10, step.delayMs ?? 50)),
                  };
                }
                const spec = getKeySpec(step.key);
                if (step.type === MacroStepType.KEY_COMBO) {
                  return {
                    t: 'COMBO' as const,
                    hid: spec?.hidUsageId ?? 0,
                    mod: modifiersToHidMask(step.modifiers),
                  };
                }
                return {
                  t: 'TAP' as const,
                  hid: spec?.hidUsageId ?? 0,
                  mod: 0,
                };
              })
          : [];

      return {
        slot: btn.slotIndex,
        label: btn.shortLabel || btn.label,
        color: btn.accentColor,
        enabled: btn.enabled,
        macroId: macro ? macro.id : null,
        mode: compiledMode,
        steps: compiledSteps,
      };
    }),
  };
}
