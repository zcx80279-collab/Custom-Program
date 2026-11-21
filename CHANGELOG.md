# Changelog

All notable changes to **RoundMacroController V2** are documented in this file.

## [2.2.0] - 2026-11-21

### Added — Stage 6.6: ESP32-S3 USB Firmware Installation & Update
- **Shared Firmware Partition & Manifest Schema (`src/shared/firmware.ts`, `src/shared/types.ts`)**:
  - Added Guition JC3636W518C flash layout constants derived from `firmware/partitions_16mb.csv` (`bootloader` @ `0x0000`, `partitions` @ `0x8000`, `boot_app0` @ `0xe000`, `app0` @ `0x10000`, `spiffs/LittleFS` @ `0x610000`).
  - Defined `.rmcfw.json` firmware package manifest validation and image composition checks separating Initial Install (`bootloader + partitions + app`) from Firmware Update (`app` only).
- **Electron Main Process Flashing Backend (`electron/services/FirmwareFlashService.ts`, `electron/main.ts`, `electron/preload.ts`)**:
  - Added non-shell `esptool` probing (`esptool.exe`, `esptool`, PlatformIO `tool-esptoolpy`, `python -m esptool`).
  - Implemented native Windows file dialogs for `.rmcfw.json` packages and `.bin` images with path confinement, ESP32-S3 image magic (`0xE9`, `chip_id=9`) & partition table magic (`0xAA50`) verification, size limit checks, and SHA-256 checksum validation.
  - Executed `esptool write_flash` via `child_process.spawn(..., { shell: false })` without `erase_flash`, parsing real flashing progress/logs and streaming them over `rmc:firmware:progress`.
  - Added post-flash USB COM port re-discovery (`0x303A` VID) and Protocol V2 `HELLO`/`GET_INFO`/`GET_STATUS` version & LittleFS config preservation check.
- **Device Management Firmware UI & Traffic Guards (`src/components/FirmwareManagementSection.tsx`, `src/components/DevicePanel.tsx`, `src/modules/DeviceManager.ts`, `src/App.tsx`)**:
  - Added Firmware Management section inside Device Management supporting Initial Install vs Update modes, BOOT+RESET download mode guide, COM port re-scan, user confirmation, real progress/logs, failure recovery guidance, and user-confirmed post-flash PC config re-apply when LittleFS is uninitialized.
  - Locked normal USB reconnect loops, `MACRO_EVENT` execution, and `SET_CONFIG`/`RESET_CONFIG` while flashing is active.
  - Added `firmware/scripts/package_firmware.mjs` to bundle PlatformIO artifacts with SHA-256 checksums.

## [2.1.0] - 2026-11-21

### Added — Stage 6.5: Windows Program Launch Macro (`LAUNCH_APP`)
- **Macro Data Model & Backward Compatibility (`src/shared/types.ts`, `src/shared/programLaunch.ts`, `src/modules/ConfigManager.ts`)**:
  - Added `MacroStepType.LAUNCH_APP` with optional fields `appName`, `appPath`, `appArgs` (separated argument array), and `workingDir`.
  - Bumped config schema version to `2.1.0` while preserving full `2.0.0` compatibility and automatic load normalization in both browser and Electron `FileConfigStore`.
  - Updated `compileDeviceCompactConfig` (`src/shared/protocol.ts`) so `LAUNCH_APP` macros always compile to `mode: "PC_AGENT"` with `steps: []`, keeping Windows file paths strictly on PC and never storing them on ESP32-S3.
- **Secure Electron Main Process Execution (`electron/services/WindowsMacroExecutor.ts`, `electron/main.ts`, `electron/preload.ts`)**:
  - Added native Windows `.exe` file picker (`browseExecutable`) and working directory picker (`browseDirectory`) over scoped preload IPC.
  - Implemented `child_process.spawn(exePath, args, { shell: false, detached: true })` with `.exe` validation, filesystem existence/access verification, working directory validation, and crash-safe `'error'`/`'spawn'` event handling.
  - Enforced saved-macro-only execution (`executeSavedMacro`) for hardware `MACRO_EVENT` triggers and saved/dialog-approved path checks for editor testing so arbitrary external commands cannot launch executables.
  - Upgraded `WindowsMacroExecutor.executeMacro` to execute mixed sequences (`LAUNCH_APP`, `DELAY`, `KEY_TAP`, `KEY_COMBO`) strictly in order.
- **Macro Editor & Preview Integration (`src/components/MacroEditorPanel.tsx`, `src/components/ButtonSlotInspector.tsx`, `src/modules/MacroEngine.ts`, `src/App.tsx`)**:
  - Integrated "Windows 프로그램 실행" step editor (program name, executable path, native browse button, optional arguments, optional working directory, and per-step launch test) without altering existing shortcut UI or circular layout.
  - Enforced `PC_AGENT` mode for macros containing `LAUNCH_APP` (rejecting unsupported `DEVICE_HID` / `HYBRID` combinations clearly).
  - Clearly distinguished real Electron execution, Test Mode simulation (`실제 미실행`), and Browser Preview unsupported state (`BROWSER_UNSUPPORTED`) without faking execution success.
  - Updated hardware `MACRO_EVENT` handling in `App.tsx` to resolve against the active profile's slot and surface execution success/failure toasts.

## [2.0.0] - 2026-11-21

### Added — Integrated Stages 0 through 6
- **Stage 0 (Foundation & Module Architecture)**:
  - Created standalone V2 architecture with 6 separated domain modules: `DeviceManager`, `MacroEngine`, `ProfileManager`, `ConfigManager`, `DisplayManager`, `DiagnosticsManager`.
  - Added Electron Windows desktop main/preload/IPC build configuration (`electron/`, `electron-builder.yml`) with strict `contextIsolation` and `sandbox` security boundaries.
- **Stage 1 (Hardware & USB Protocol V2)**:
  - Designed and implemented shared Protocol V2 (`$<CRC16>:<JSON>\n`) with CRC-16/CCITT-FALSE verification, stream reassembly, and commands `HELLO`, `GET_INFO`, `GET_STATUS`, `SET_CONFIG`, `GET_CONFIG`, `RESET_CONFIG`, `ACK`, `ERROR`, `MACRO_EVENT`.
  - Implemented Node `serialport` backend (`SerialDeviceService`) and Chromium Web Serial real transport in `DeviceManager` without faking connected devices.
- **Stage 2 (Macro Engine)**:
  - Built macro editor supporting single key, key combinations, multi-step sequences, delays (10–10,000ms), and whitelisted HID/VK keycodes.
  - Separated `DEVICE_HID`, `PC_AGENT`, and `HYBRID` execution paths to avoid conflicts between USB HID and PC-side execution.
- **Stage 3 (Profile & Config Management)**:
  - Implemented profile CRUD (create, rename, duplicate, delete, switch), 4+1 / 6+1 / 8+1 circular layout presets, versioned schema (`2.0.0`), atomic PC storage with backup rollback, and JSON import/export.
- **Stage 4 (Device Reset & Recovery)**:
  - Added mandatory confirmation modal (`ResetConfirmModal`) for `RESET_CONFIG` preserving firmware and PC source config, with optional immediate resend.
- **Stage 5 (Desktop UI Workbench)**:
  - Implemented all 6 required views centered around the interactive 1:1 360×360 circular preview (`CircularDisplayPreview`).
- **Stage 6 (ESP32-S3 PlatformIO Firmware)**:
  - Created PlatformIO firmware targeting Guition JC3636W518C (ESP32-S3R8, 16MB Flash, 8MB PSRAM) with ST77916 QSPI display, CST816S touch, LittleFS atomic config storage, TinyUSB CDC+HID composite mode, and CDC-only fallback mode.
- **Documentation**:
  - Authored `README.md`, `ARCHITECTURE.md`, `HARDWARE.md`, `PROTOCOL.md`, `DEVELOPMENT_STATUS.md`, and `CHANGELOG.md`.
