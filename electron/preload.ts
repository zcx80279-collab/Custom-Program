import { contextBridge, ipcRenderer } from 'electron';
import {
  AppConfig,
  DeviceCompactConfig,
  MacroDefinition,
  ProgramLaunchTestRequest,
  RoundMacroDesktopAPI,
} from '../src/shared/types';
import type {
  FirmwareFlashProgressEvent,
  FirmwareFlashRequest,
  FirmwareImageRole,
  FirmwareInstallMode,
  FirmwareSelectionState,
} from '../src/shared/firmware';

/**
 * Restricted preload bridge.
 * Renderer has ZERO access to Node.js APIs, filesystem, child_process, or serialport.
 */
const api: RoundMacroDesktopAPI = {
  runtime: 'electron-windows',
  platform: process.platform,
  appVersion: '2.1.0',
  device: {
    listPorts: () => ipcRenderer.invoke('rmc:device:listPorts'),
    connect: (portPath: string) => ipcRenderer.invoke('rmc:device:connect', portPath),
    disconnect: () => ipcRenderer.invoke('rmc:device:disconnect'),
    testConnection: () => ipcRenderer.invoke('rmc:device:testConnection'),
    getInfo: () => ipcRenderer.invoke('rmc:device:getInfo'),
    getStatus: () => ipcRenderer.invoke('rmc:device:getStatus'),
    applyConfig: (payload: DeviceCompactConfig) =>
      ipcRenderer.invoke('rmc:device:applyConfig', payload),
    getDeviceConfig: () => ipcRenderer.invoke('rmc:device:getDeviceConfig'),
    resetDeviceConfig: () => ipcRenderer.invoke('rmc:device:resetDeviceConfig'),
    onConnectionEvent: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { type: 'disconnected' | 'reconnected' | 'error' | 'macro_event'; payload?: unknown }
      ) => {
        callback(data);
      };
      ipcRenderer.on('rmc:device:event', listener);
      return () => {
        ipcRenderer.removeListener('rmc:device:event', listener);
      };
    },
  },
  config: {
    load: () => ipcRenderer.invoke('rmc:config:load'),
    save: (config: AppConfig) => ipcRenderer.invoke('rmc:config:save', config),
    exportToFile: (config: AppConfig) => ipcRenderer.invoke('rmc:config:exportToFile', config),
    importFromFile: () => ipcRenderer.invoke('rmc:config:importFromFile'),
  },
  macro: {
    executeOnPc: (macro: MacroDefinition) =>
      ipcRenderer.invoke('rmc:macro:executeOnPc', macro),
    executeSavedMacro: (macroId: string, slotIndex?: number) =>
      ipcRenderer.invoke('rmc:macro:executeSavedMacro', macroId, slotIndex),
    browseExecutable: () => ipcRenderer.invoke('rmc:macro:browseExecutable'),
    browseDirectory: () => ipcRenderer.invoke('rmc:macro:browseDirectory'),
    validateProgramPath: (appPath: string, workingDir?: string) =>
      ipcRenderer.invoke('rmc:macro:validateProgramPath', appPath, workingDir),
    testLaunchProgram: (request: ProgramLaunchTestRequest) =>
      ipcRenderer.invoke('rmc:macro:testLaunchProgram', request),
  },
  firmware: {
    detectTools: () => ipcRenderer.invoke('rmc:firmware:detectTools'),
    browseFirmware: (mode: FirmwareInstallMode) =>
      ipcRenderer.invoke('rmc:firmware:browseFirmware', mode),
    browseSingleImage: (role: FirmwareImageRole) =>
      ipcRenderer.invoke('rmc:firmware:browseSingleImage', role),
    inspectSelection: (selection: FirmwareSelectionState) =>
      ipcRenderer.invoke('rmc:firmware:inspectSelection', selection),
    startFlash: (request: FirmwareFlashRequest) =>
      ipcRenderer.invoke('rmc:firmware:startFlash', request),
    cancelFlash: () => ipcRenderer.invoke('rmc:firmware:cancelFlash'),
    onProgress: (callback: (event: FirmwareFlashProgressEvent) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: FirmwareFlashProgressEvent
      ) => {
        callback(data);
      };
      ipcRenderer.on('rmc:firmware:progress', listener);
      return () => {
        ipcRenderer.removeListener('rmc:firmware:progress', listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld('roundMacroAPI', api);
