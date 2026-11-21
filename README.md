# RoundMacroController V2

ESP32-S3 기반 360×360 원형 터치 디스플레이(**Guition JC3636W518C**)를 Windows PC용 독립형 USB 매크로 컨트롤러로 사용하는 통합 프로젝트입니다.

> **프로젝트 격리 원칙**: 기존 보관용 RoundMacroController 프로젝트와 완전히 분리된 V2 신규 프로젝트입니다.
> **제외 범위**: Android/iOS, 모바일·태블릿, Bluetooth, Wi-Fi, 배터리 무선 운용, 클라우드 동기화, 자동 업데이트, CyberRabbit OS 연동 기능은 포함하지 않습니다.

---

## 1. 프로젝트 구조

```text
.
├── src/                        # React + TypeScript + Vite 렌더러 및 공통 도메인 모듈
│   ├── shared/                 # PC·Electron·펌웨어 공통 스키마, 키코드 테이블, 360×360 기하학, 프로토콜 V2
│   ├── modules/                # 6대 핵심 모듈 (Device, Macro, Profile, Config, Display, Diagnostics)
│   ├── components/             # 6개 필수 화면 컴포넌트 및 초기화 확인 모달
│   └── App.tsx                 # 데스크톱 워크벤치 통합 진입점
├── electron/                   # Windows 설치형 Electron 메인/프리로드 및 네이티브 USB/Win32 서비스
│   ├── main.ts                 # contextIsolation=true, sandbox=true 메인 프로세스
│   ├── preload.ts              # 제한된 contextBridge IPC 인터페이스
│   ├── services/               # SerialDeviceService, WindowsMacroExecutor, FileConfigStore
│   ├── tsconfig.json
│   └── package.electron.json   # 외부 Windows 빌드 환경용 패키지 명세
├── electron-builder.yml        # Windows x64 NSIS 설치 프로그램 패키징 설정
├── firmware/                   # ESP32-S3 PlatformIO 펌웨어 프로젝트
│   ├── platformio.ini          # TinyUSB CDC+HID 복합 / HW CDC 전용 2종 빌드 환경
│   ├── partitions_16mb.csv     # 16MB Flash + LittleFS 파티션 테이블
│   ├── include/                # board_config.h 및 6대 펌웨어 모듈 헤더
│   └── src/                    # main.cpp 및 6대 펌웨어 모듈 구현체
├── README.md
├── ARCHITECTURE.md
├── HARDWARE.md
├── PROTOCOL.md
├── DEVELOPMENT_STATUS.md
└── CHANGELOG.md
```

---

## 2. 실행 및 빌드 방법

### A. 웹/프리뷰 개발 실행 (Google AI Studio / 브라우저)
```bash
npm install
npm run dev
```
- `http://localhost:3000`에서 UI 및 로컬 PC 설정 관리/프로필/매크로/360×360 미리보기 동작을 확인할 수 있습니다.
- Chromium 기반 브라우저에서는 Web Serial API(`navigator.serial`)를 통해 실제 ESP32-S3 USB CDC 장치 연결도 시도할 수 있습니다.
- 실제 기기가 연결되지 않은 상태에서는 가상 기기를 연결됨으로 표시하지 않습니다.

### B. Windows 데스크톱(Electron) 빌드 및 설치 파일 생성
1. **로컬 Windows PC에서 빌드 (Windows 10/11 x64, Node.js 20 LTS 이상)**:
```bash
npm install
npm run dist:win
```
- 실행 순서: Vite 렌더러 빌드(`dist/`) → Electron TypeScript 컴파일(`dist-electron/`) → `electron-builder` NSIS x64 패키징(`--publish never`)
- 생성물: `release/RoundMacroController V2 Setup 2.2.0.exe`

2. **GitHub Actions 수동 빌드**:
- GitHub 저장소 **Actions → Build Windows Installer → Run workflow**를 수동 실행합니다.
- 완료 후 해당 실행의 **Artifacts**에서 `RoundMacroController-V2-Windows-x64-Installer`(`.exe`)를 다운로드할 수 있습니다. (자동 릴리스 및 자동 업데이트는 비활성화되어 있습니다.)

### C. ESP32-S3 펌웨어 빌드, 패키징 및 USB 설치 (PlatformIO + Electron)
1. VS Code PlatformIO IDE 또는 `pio` CLI를 설치합니다. (`esptool` 포함)
2. **필수**: `firmware/include/board_config.h`의 핀 번호를 실제 보유한 Guition JC3636W518C 보드 리비전과 대조 확인합니다.
3. 펌웨어 바이너리(`bootloader.bin`, `partitions.bin`, `firmware.bin`)를 빌드하고, 필요 시 검증용 패키지(`.rmcfw.json`)를 생성합니다.
```bash
cd firmware
# 1) USB CDC + USB HID 복합 모드 (기본)
pio run -e jc3636w518c_usb_composite

# 2) USB CDC 전용 안전 모드 (초기 브링업 및 PC 실행 방식 테스트용)
pio run -e jc3636w518c_cdc_only

# (선택) SHA-256 무결성 검증이 포함된 통합 펌웨어 패키지 생성
cd ..
node firmware/scripts/package_firmware.mjs jc3636w518c_usb_composite
```
4. Windows Electron 앱의 **기기 관리 → ESP32-S3 펌웨어 관리**에서 생성된 `.rmcfw.json` 또는 `firmware/.pio/build/<env>/firmware.bin`을 선택하여 최초 설치 또는 업데이트를 진행할 수 있습니다. (PlatformIO CLI에서 직접 업로드할 경우 `pio run -e <env> -t upload` 사용)

---

## 3. 문서 안내

- [ARCHITECTURE.md](./ARCHITECTURE.md): 시스템 구조, 6대 모듈 책임, 보안 및 이중 매크로 실행 설계
- [HARDWARE.md](./HARDWARE.md): Guition JC3636W518C 핀 배치, 드라이버 구성, 실물 검증 필수 항목
- [PROTOCOL.md](./PROTOCOL.md): PC–ESP32-S3 간 프로토콜 V2 프레임 규격, CRC-16 검증, 명령 정의
- [DEVELOPMENT_STATUS.md](./DEVELOPMENT_STATUS.md): 구현 완료 / 빌드 검증 / 실물 하드웨어 미검증 항목 구분표
- [CHANGELOG.md](./CHANGELOG.md): 버전 변경 이력
