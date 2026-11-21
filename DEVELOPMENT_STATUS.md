# RoundMacroController V2 — Development Status

구현 완료 항목과 실제 실행/빌드 검증 항목, 그리고 실물 Windows/ESP32-S3 하드웨어 검증이 필요한 항목을 구분하여 기록합니다.

---

## 1. 구현 완료 및 검증 현황표

| 단계 | 영역 | 소스 구현 상태 | 현재 환경 빌드/실행 검증 | 실물 하드웨어/Windows 검증 |
| --- | --- | --- | --- | --- |
| 0단계 | 프로젝트 구조 및 6대 모듈 분리 | **완료** | TypeScript + Vite 빌드 검증 | N/A |
| 1단계 | 프로토콜 V2 (CRC-16, 9개 명령, 스트림 재조립) | **완료** | TypeScript 정적 검사 완료 | **미검증** (실물 USB 왕복 테스트 필요) |
| 1단계 | PC USB 연결 관리 (Electron `serialport` + Web Serial) | **완료** | 렌더러 빌드 완료 / Electron 소스는 외부 Windows 빌드 대상 | **미검증** (실물 COM 포트 열거·분리·재연결 테스트 필요) |
| 2단계 | 매크로 편집기, 화이트리스트 키코드, 유효성 검증 | **완료** | 브라우저 프리뷰 UI/드라이런 검증 가능 | **미검증** (실제 Windows OS 키 입력 주입 테스트 필요) |
| 2단계 | USB HID + PC 실행 이중 구조 (`DEVICE_HID`/`PC_AGENT`/`HYBRID`) | **완료** | 코드 구조 구현 완료 | **미검증** (TinyUSB CDC+HID Windows 동시 인식 실물 확인 필요) |
| 3단계 | 프로필 관리 (생성/이름변경/삭제/복제/전환/버튼매핑) | **완료** | 브라우저 프리뷰 및 로컬 저장 검증 가능 | Windows `%APPDATA%` 파일 저장 실기 확인 필요 |
| 4단계 | 기기 초기화 확인 모달, LittleFS 원자적 저장 및 롤백 | **완료** | UI 확인 흐름 구현 완료 | **미검증** (실물 전원 재인가 후 LittleFS 유지/초기화 테스트 필요) |
| 5단계 | 6대 필수 화면 및 360×360 원형 화면 미리보기 | **완료** | Vite 프로덕션 빌드 검증 | Windows 데스크톱 고DPI 해상도 실기 확인 필요 |
| 6단계 | ESP32-S3 PlatformIO 펌웨어 (ST77916 / CST816S / LittleFS / TinyUSB) | **완료** | PlatformIO 미설치 환경으로 컴파일 미실행 | **미검증** (로컬 PlatformIO 빌드 및 JC3636W518C 보드 실물 테스트 필요) |
| 6.5단계 | Windows 프로그램 실행 매크로 (`LAUNCH_APP`, 파일 선택, `spawn` 보안 실행) | **완료** | TypeScript + Vite 빌드 및 브라우저 미리보기 UI/저장 검증 | **미검증** (Windows Electron `.exe` 선택·실행 및 ESP32-S3 터치 연동 실기 테스트 필요) |
| 6.6단계 | ESP32-S3 USB 펌웨어 설치 및 업데이트 (`esptool` 연동, 최초/업데이트 구분) | **완료** | TypeScript + Vite 빌드, 매니페스트/바이너리 검증 로직 검증 | **미검증** (Windows Electron + `esptool` + 실물 JC3636W518C 플래싱·재부팅·버전 확인 필요) |

---

## 2. 아직 구현하지 않았거나 제한된 항목

- **네이티브 C++ Win32 `SendInput` N-API 애드온**: 현재 `WindowsMacroExecutor`는 외부 네이티브 컴파일러 의존성을 줄이기 위해 화이트리스트 숫자 VK 코드만 받는 PowerShell `user32.dll` P/Invoke 방식을 구현했습니다. 초저지연(<10ms) 반복 실행이 필요해지면 후속 단계에서 네이티브 Win32 N-API 모듈로 교체할 수 있습니다.
- **USB HID Consumer Control(미디어 키) 전용 리포트**: 표준 Boot Keyboard 키(A–Z, 0–9, F1–F12, 탐색, 조합키)는 HID Usage ID로 매핑되어 있으나, 볼륨/음소거 키는 `USBHIDConsumerControl` 확장 전까지 `PC_AGENT` 모드로 실행하도록 안내·경고 처리했습니다.
- **원형 화면 호(Arc) 채우기 최적화**: 펌웨어 `DisplayManager`는 초기 브링업 안정성을 위해 원형 패드 기반 렌더링을 적용했습니다. 실물 ST77916 프레임 버퍼 성능 확인 후 LVGL 또는 안티앨리어싱 섹터 렌더링으로 고도화할 예정입니다.
- **Windows 프로그램 실행 대상 확장자**: 6.5단계에서는 보안과 호환성을 위해 `.exe` 실행 파일을 기본 지원 대상으로 제한합니다(`.bat`/`.cmd`/`.lnk`/UWP 앱은 임의 쉘 해석 위험을 피하기 위해 기본 미지원).
- **HYBRID 모드와 프로그램 실행 혼합**: `LAUNCH_APP`가 포함된 매크로는 기기 HID와 PC 실행 간 순서 보장이 불가능하므로 `HYBRID`/`DEVICE_HID`를 차단하고 `PC_AGENT`에서 전체 시퀀스를 순차 실행합니다.
- **실행 PC 내 `esptool` 준비 필요**: 6.6단계 Windows USB 플래싱은 `esptool.exe`, PlatformIO `tool-esptoolpy`, 또는 Python `esptool` 중 하나를 탐지하여 실행합니다. 도구 미설치 환경에서는 가짜 설치를 수행하지 않고 설치 안내를 표시합니다.

---

## 3. 실물 하드웨어에서 반드시 검증할 체크리스트

1. `cd firmware && pio run -e jc3636w518c_cdc_only` 및 `jc3636w518c_usb_composite` 컴파일 성공 여부.
2. Guition JC3636W518C 실제 PCB에서 ST77916 QSPI 핀(9~15, 47) 및 CST816S I²C 핀(7, 8, 40, 41, 주소 `0x15`) 동작 여부.
3. Windows 10/11에서 TinyUSB CDC+HID 복합 장치 동시 인식 여부.
4. `SET_CONFIG` 적용 → 보드 전원 차단/재인가 → 설정 유지 여부 및 `RESET_CONFIG` 후 PC 원본 유지/재전송 여부.
5. `electron/` Windows 빌드(`npm run dist:win`) 및 NSIS 설치 프로그램 정상 설치/제거 여부.
6. Windows Electron 환경에서 `.exe` 파일 찾아보기, 프로그램 실행 테스트, 파일 삭제/이동 후 오류 처리(앱 비종료), 프로필 전환 후 ESP32-S3 터치 연동 실행 여부.
7. Windows Electron 환경에서 펌웨어 최초 설치(`0x0000`/`0x8000`/`0xe000`/`0x10000`) 및 업데이트(`0x10000`), BOOT+RESET 수동 다운로드 모드, 설치 후 자동 재연결·버전 확인 및 LittleFS 설정 보존 여부.
