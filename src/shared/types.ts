export const CONFIG_SCHEMA_VERSION = '2.1.0';
export const PROTOCOL_VERSION = '2.0';
export const DISPLAY_WIDTH = 360;
export const DISPLAY_HEIGHT = 360;
export const DISPLAY_RADIUS = 180;

import type {
  BrowseFirmwareResult,
  BrowseSingleFirmwareImageResult,
  FirmwareBuildProgressEvent,
  FirmwareBuildRequest,
  FirmwareBuildResult,
  FirmwareBuildToolStatus,
  FirmwareFlashProgressEvent,
  FirmwareFlashRequest,
  FirmwareFlashResult,
  FirmwareImageRole,
  FirmwareInstallMode,
  FirmwareSelectionState,
  FirmwareToolStatus,
  FirmwareValidationReport,
} from './firmware';

export enum MacroExecutionMode {
  /** Executed directly by ESP32-S3 over USB HID Keyboard (requires TinyUSB Composite HID+CDC) */
  DEVICE_HID = 'DEVICE_HID',
  /** ESP32-S3 emits MACRO_EVENT over USB CDC; Windows PC app executes whitelisted SendInput / program launch */
  PC_AGENT = 'PC_AGENT',
  /** Prefer ESP32-S3 USB HID if available; fall back to PC_AGENT over USB CDC (key/delay macros only) */
  HYBRID = 'HYBRID',
}

export enum MacroStepType {
  KEY_TAP = 'KEY_TAP',
  KEY_COMBO = 'KEY_COMBO',
  DELAY = 'DELAY',
  LAUNCH_APP = 'LAUNCH_APP',
}

export enum LayoutPreset {
  RADIAL_4_CENTER = 'RADIAL_4_CENTER',
  RADIAL_6_CENTER = 'RADIAL_6_CENTER',
  RADIAL_8_CENTER = 'RADIAL_8_CENTER',
}

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  SCANNING = 'SCANNING',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR',
}

export enum ProtocolCommand {
  HELLO = 'HELLO',
  GET_INFO = 'GET_INFO',
  GET_STATUS = 'GET_STATUS',
  SET_CONFIG = 'SET_CONFIG',
  GET_CONFIG = 'GET_CONFIG',
  RESET_CONFIG = 'RESET_CONFIG',
  ACK = 'ACK',
  ERROR = 'ERROR',
  /** Device-to-PC notification when a PC_AGENT macro button is pressed on the touchscreen */
  MACRO_EVENT = 'MACRO_EVENT',
}

export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  TX = 'TX',
  RX = 'RX',
}

export type ModifierKey = 'CTRL' | 'SHIFT' | 'ALT' | 'WIN';

export interface MacroStep {
  id: string;
  type: MacroStepType;
  /** Whitelisted canonical key code (e.g., 'KeyC', 'Enter', 'F5') */
  key?: string;
  /** Modifiers for KEY_COMBO */
  modifiers?: ModifierKey[];
  /** Delay duration in milliseconds (10 - 10000ms) */
  delayMs?: number;
  /** Optional post-step execution delay in milliseconds (0 - 5000ms) */
  delayAfterMs?: number;
  /** Display name of Windows program (for LAUNCH_APP) */
  appName?: string;
  /** Full Windows executable (.exe) path (for LAUNCH_APP, stored on PC only) */
  appPath?: string;
  /** Separated argument array passed with shell: false (for LAUNCH_APP) */
  appArgs?: string[];
  /** Optional working directory path (for LAUNCH_APP) */
  workingDir?: string;
}

export interface MacroDefinition {
  id: string;
  name: string;
  description: string;
  executionMode: MacroExecutionMode;
  category?: string;
  steps: MacroStep[];
  createdAt: string;
  updatedAt: string;
}

export interface CircularButtonConfig {
  /** Slot index 0 = center, 1..N = outer radial sectors clockwise from top */
  slotIndex: number;
  id: string;
  label: string;
  shortLabel: string;
  accentColor: string;
  macroId: string | null;
  enabled: boolean;
}

export enum SlotTransitionMode {
  CIRCULAR = 'CIRCULAR',
  STOP_AT_ENDS = 'STOP_AT_ENDS',
}

export interface MacroSlotPage {
  slotIndex: number; // 1, 2, 3
  name: string;
  buttons: CircularButtonConfig[];
}

export interface ProfileDefinition {
  id: string;
  name: string;
  description: string;
  layout: LayoutPreset;
  backgroundColor: string;
  /** 3 macro slot pages (1, 2, 3) */
  macroSlots: MacroSlotPage[];
  /** Currently active macro slot index (1, 2, or 3) */
  activeMacroSlotIndex: number;
  /** Active button array accessor for backward compatibility */
  buttons: CircularButtonConfig[];
  createdAt: string;
  updatedAt: string;
}

export interface PresetButtonMapping {
  /** Outer button slot index 1..6 */
  slotIndex: number;
  label: string;
  shortLabel: string;
  accentColor: string;
  macroId: string | null;
  enabled: boolean;
}

export interface ShortcutPreset {
  id: string;
  name: string;
  /** Explicit target application / environment where shortcuts apply */
  targetApp: string;
  description: string;
  isBuiltIn: boolean;
  buttons: PresetButtonMapping[];
  createdAt: string;
  updatedAt: string;
}

export interface ExportedPresetPackage {
  format: 'roundmacro-preset-v1';
  exportedAt: string;
  preset: ShortcutPreset;
  macros: MacroDefinition[];
}

export interface AppConfig {
  schemaVersion: string;
  activeProfileId: string;
  profiles: ProfileDefinition[];
  macros: MacroDefinition[];
  shortcutPresets?: ShortcutPreset[];
  activePresetId?: string | null;
  preferences: {
    autoReconnect: boolean;
    reconnectIntervalMs: number;
    preferredPortPath: string | null;
    hidPreferredWhenAvailable: boolean;
    macroTestMode: boolean;
    slotTransitionMode: SlotTransitionMode;
  };
  lastModifiedAt: string;
  lastAppliedToDeviceAt: string | null;
}

/** Compact payload transferred to ESP32-S3 LittleFS/NVS storage */
export interface DeviceCompactConfig {
  schemaVersion: string;
  profileId: string;
  profileName: string;
  layout: LayoutPreset;
  backgroundColor: string;
  testMode?: boolean;
  buttons: Array<{
    slot: number;
    label: string;
    color: string;
    enabled: boolean;
    macroId: string | null;
    mode: MacroExecutionMode;
    steps: Array<{
      t: 'TAP' | 'COMBO' | 'DELAY';
      hid?: number;
      mod?: number;
      ms?: number;
    }>;
  }>;
}

export interface UsbPortCandidate {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
  friendlyName?: string;
  isSupportedTarget: boolean;
  transportType: 'ELECTRON_SERIAL' | 'WEB_SERIAL';
}

export interface DeviceInfo {
  deviceName: string;
  boardModel: string;
  mcu: string;
  firmwareVersion: string;
  protocolVersion: string;
  serialNumber: string;
  displayResolution: string;
  usbMode: 'TINYUSB_CDC_HID' | 'HW_CDC_ONLY' | 'UNKNOWN';
  hidSupported: boolean;
  storageType: string;
  hardwareVerified: boolean;
}

export interface DeviceStatus {
  uptimeMs: number;
  activeProfileId: string;
  configSchemaVersion: string;
  hasStoredConfig: boolean;
  displayReady: boolean;
  touchReady: boolean;
  hidReady: boolean;
  freeHeapBytes: number;
  freePsramBytes: number;
  lastErrorCode: string | null;
  testMode?: boolean;
}

export interface ProtocolErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface ProtocolMessage<T = Record<string, unknown>> {
  version: string;
  requestId: string;
  command: ProtocolCommand;
  timestampMs: number;
  data?: T;
  error?: ProtocolErrorPayload;
}

export interface MacroStepTrace {
  stepIndex: number;
  type: MacroStepType;
  label: string;
  simulatedDelayMs: number;
  actualExecuted?: boolean;
  pid?: number;
}

export interface LaunchedProgramInfo {
  appName: string;
  appPath: string;
  pid?: number;
}

export interface MacroExecutionResult {
  success: boolean;
  macroId: string;
  macroName: string;
  executedBy: 'DEVICE_HID' | 'PC_AGENT' | 'TEST_MODE' | 'DRY_RUN_PREVIEW' | 'BROWSER_UNSUPPORTED';
  isTestMode?: boolean;
  isSimulated?: boolean;
  stepsExecuted: number;
  durationMs: number;
  stepTraces?: MacroStepTrace[];
  launchedPrograms?: LaunchedProgramInfo[];
  errorMessage?: string;
  timestamp: string;
}

export interface BrowseExecutableResult {
  ok: boolean;
  canceled?: boolean;
  appPath?: string;
  appName?: string;
  workingDir?: string;
  error?: string;
}

export interface BrowseDirectoryResult {
  ok: boolean;
  canceled?: boolean;
  dirPath?: string;
  error?: string;
}

export interface ProgramPathCheckResult {
  ok: boolean;
  exists: boolean;
  isFile: boolean;
  isExe: boolean;
  accessible: boolean;
  workingDirValid: boolean;
  error?: string;
}

export interface ProgramLaunchTestRequest {
  macroId?: string;
  appName?: string;
  appPath: string;
  appArgs?: string[];
  workingDir?: string;
}

export interface ProgramLaunchTestResult {
  ok: boolean;
  executedBy: 'PC_AGENT' | 'TEST_MODE' | 'BROWSER_UNSUPPORTED';
  isSimulated: boolean;
  appName: string;
  appPath: string;
  pid?: number;
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
  timestamp: string;
}

export interface DiagnosticLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source:
    | 'DeviceManager'
    | 'MacroEngine'
    | 'ProfileManager'
    | 'PresetManager'
    | 'ConfigManager'
    | 'DisplayManager'
    | 'DiagnosticsManager'
    | 'FirmwareManager'
    | 'Protocol';
  message: string;
  details?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface LastCommResult {
  command: ProtocolCommand | null;
  requestId: string | null;
  success: boolean | null;
  latencyMs: number | null;
  timestamp: string | null;
  summary: string;
}

/**
 * Restricted IPC bridge exposed via Electron preload (`contextBridge.exposeInMainWorld`).
 * Renderer NEVER accesses Node.js, fs, serialport, or child_process directly.
 */
export interface RoundMacroDesktopAPI {
  runtime: 'electron-windows';
  platform: string;
  appVersion: string;
  device: {
    listPorts: () => Promise<UsbPortCandidate[]>;
    connect: (portPath: string) => Promise<{ ok: boolean; info?: DeviceInfo; error?: string }>;
    disconnect: () => Promise<{ ok: boolean }>;
    testConnection: () => Promise<{ ok: boolean; latencyMs?: number; error?: string }>;
    getInfo: () => Promise<{ ok: boolean; info?: DeviceInfo; error?: string }>;
    getStatus: () => Promise<{ ok: boolean; status?: DeviceStatus; error?: string }>;
    applyConfig: (payload: DeviceCompactConfig) => Promise<{ ok: boolean; error?: string }>;
    getDeviceConfig: () => Promise<{ ok: boolean; config?: DeviceCompactConfig; error?: string }>;
    resetDeviceConfig: () => Promise<{ ok: boolean; error?: string }>;
    onConnectionEvent: (callback: (event: { type: 'disconnected' | 'reconnected' | 'error' | 'macro_event'; payload?: unknown }) => void) => () => void;
  };
  config: {
    load: () => Promise<{ ok: boolean; config?: AppConfig; error?: string }>;
    save: (config: AppConfig) => Promise<{ ok: boolean; error?: string }>;
    exportToFile: (config: AppConfig) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
    importFromFile: () => Promise<{ ok: boolean; config?: AppConfig; error?: string }>;
  };
  macro: {
    executeOnPc: (macro: MacroDefinition) => Promise<MacroExecutionResult>;
    executeSavedMacro: (macroId: string, slotIndex?: number) => Promise<MacroExecutionResult>;
    browseExecutable: () => Promise<BrowseExecutableResult>;
    browseDirectory: () => Promise<BrowseDirectoryResult>;
    validateProgramPath: (appPath: string, workingDir?: string) => Promise<ProgramPathCheckResult>;
    testLaunchProgram: (request: ProgramLaunchTestRequest) => Promise<ProgramLaunchTestResult>;
  };
  firmware: {
    detectTools: () => Promise<FirmwareToolStatus>;
    detectBuildTools: () => Promise<FirmwareBuildToolStatus>;
    browseFirmware: (mode: FirmwareInstallMode) => Promise<BrowseFirmwareResult>;
    browseSingleImage: (role: FirmwareImageRole) => Promise<BrowseSingleFirmwareImageResult>;
    inspectSelection: (selection: FirmwareSelectionState) => Promise<FirmwareValidationReport>;
    startFlash: (request: FirmwareFlashRequest) => Promise<FirmwareFlashResult>;
    cancelFlash: () => Promise<{ ok: boolean; error?: string }>;
    onProgress: (callback: (event: FirmwareFlashProgressEvent) => void) => () => void;
    startBuild: (request: FirmwareBuildRequest) => Promise<FirmwareBuildResult>;
    cancelBuild: () => Promise<{ ok: boolean; error?: string }>;
    onBuildProgress: (callback: (event: FirmwareBuildProgressEvent) => void) => () => void;
  };
}

declare global {
  interface Window {
    roundMacroAPI?: RoundMacroDesktopAPI;
  }
}
