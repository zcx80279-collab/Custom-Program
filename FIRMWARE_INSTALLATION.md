# RoundMacroController V2 — ESP32-S3 펌웨어 설치 및 업데이트 가이드

대상 하드웨어: **Guition JC3636W518C** (`ESP32-S3R8`, 16MB QIO Flash, 8MB OPI PSRAM, 360×360 원형 터치 디스플레이, Native USB OTG PHY `GPIO 19/20`, `BOOT` `GPIO 0`, Espressif VID `0x303A`)

> **중요 안내**
> - 실제 USB 플래싱(`esptool` 실행 및 COM 포트 제어)은 **Windows Electron 데스크톱 앱**에서 동작합니다. 웹 브라우저 미리보기에서는 펌웨어 설치 시뮬레이션이나 로컬 플래싱을 수행할 수 없습니다.
> - 최초 실물 보드에 설치하기 전, `firmware/include/board_config.h`의 핀 배치(디스플레이 QSPI / 터치 I²C)가 보유한 PCB 리비전과 일치하는지 [HARDWARE.md](./HARDWARE.md)를 기준으로 먼저 확인하세요.

---

## 1. 사전 준비 및 플래싱 도구 필수 요건

### A. 플래싱 도구(`esptool`) 및 실행 환경 요구사항
Windows Electron 앱은 설치 실행 전 아래 우선순위로 ESP32-S3 검증 플래싱 도구를 자동 탐색합니다.
1. 앱 내장 경로: `resources/tools/esptool.exe`
2. 시스템 `PATH` 내 `esptool.exe` 또는 `esptool`
3. PlatformIO 설치 환경: `%USERPROFILE%\.platformio\penv\Scripts\python.exe` + `tool-esptoolpy\esptool.py`
4. 시스템 Python 환경: `py -3 -m esptool` 또는 `python.exe -m esptool`

#### 필수 사전 요건 체크리스트
- **운영체제 및 앱 런타임**: Windows 10/11 (x64) 환경의 **RoundMacroController V2 Windows Electron 앱** (`npm run dist:win`으로 빌드된 설치 버전 또는 `npm run dev:electron`).
- **`esptool` 설치 (아래 중 1가지 필수)**:
  - **방법 1 (권장 — Python CLI)**: Python 3.8 이상 설치(설치 시 `Add python.exe to PATH` 체크) 후 명령 프롬프트에서 실행:
    ```bat
    pip install esptool
    python -m esptool version
    ```
  - **방법 2 (PlatformIO 사용)**: VS Code PlatformIO IDE 설치 후 `firmware/` 프로젝트를 1회 빌드하면 `%USERPROFILE%\.platformio\packages\tool-esptoolpy\esptool.py`가 자동 준비됩니다.
  - **방법 3 (독립 실행 파일)**: Espressif 공식 `esptool.exe`를 Windows `PATH` 또는 앱 설치 폴더의 `resources\tools\esptool.exe`에 배치합니다.
- **USB 드라이버 및 하드웨어 연결**:
  - Windows 10/11 기본 내장 **USB 직렬 장치(`usbser.sys`)** 드라이버로 Espressif Native USB(`VID 0x303A`)가 자동 인식됩니다. 장치 관리자에서 노란색 느낌표가 표시될 경우 Windows Update 또는 Espressif IDF USB 드라이버를 설치하세요.
  - 전원 전용 케이블이 아닌 **데이터 전송 지원 USB-C 케이블**을 사용하고, 무전원 USB 허브 대신 **PC 본체 USB 포트에 직접 연결**하는 것을 권장합니다.
- **COM 포트 점유 해제**:
  - Arduino IDE 시리얼 모니터, PlatformIO Serial Monitor, PuTTY, Tera Term 등 다른 시리얼 프로그램을 모두 종료한 뒤 진행하세요.

도구 설치 후 앱의 **기기 관리 → ESP32-S3 펌웨어 관리 → 도구 다시 확인** 버튼을 눌러 `esptool` 인식 및 버전이 정상 표시되는지 확인합니다.

### B. 펌웨어 파일 빌드 및 패키지 생성
PlatformIO CLI(`pio`)로 원하는 USB 모드 환경을 빌드합니다.

```bash
cd firmware

# 1) 기본 권장: USB CDC(통신) + USB HID(단축키 키보드) 동시 지원
pio run -e jc3636w518c_usb_composite

# 2) 대체 안전 모드: USB CDC 전용 (초기 브링업 및 PC_AGENT 매크로 테스트용)
pio run -e jc3636w518c_cdc_only
```

빌드가 완료되면 `firmware/.pio/build/<환경명>/` 아래에 다음 바이너리가 생성됩니다.
- `bootloader.bin` (`0x0000`)
- `partitions.bin` (`0x8000`)
- `firmware.bin` (`0x10000`)

선택적으로 루트 폴더에서 패키징 스크립트를 실행하면 SHA-256 무결성 해시가 포함된 통합 패키지(`.rmcfw.json`)를 생성할 수 있습니다.

```bash
node firmware/scripts/package_firmware.mjs jc3636w518c_usb_composite
# 생성 경로: firmware/dist/jc3636w518c_usb_composite/jc3636w518c_usb_composite.rmcfw.json
```

---

## 2. 플래시 메모리 구조 (`firmware/partitions_16mb.csv` 기준)

| 영역 | 플래시 오프셋 | 최대 크기 | 파일 | 최초 설치 | 이후 업데이트 |
| --- | --- | --- | --- | --- | --- |
| Bootloader | `0x0000` | 32KB (`0x8000`) | `bootloader.bin` | **필수** | 기록 안 함 |
| Partition Table | `0x8000` | 4KB (`0x1000`) | `partitions.bin` | **필수** | 기록 안 함 |
| NVS | `0x9000` | 20KB (`0x5000`) | - | 유지 | 유지 |
| OTA Boot Data | `0xe000` | 8KB (`0x2000`) | `boot_app0.bin` | 권장 | 기록 안 함 |
| App (`ota_0`) | `0x10000` | 3MB (`0x300000`) | `firmware.bin` | **필수** | **필수 (단독 기록)** |
| LittleFS (`spiffs`) | `0x610000` | ~9.8MB (`0x9E0000`) | - | 파티션 변경 시 초기화 가능 | **보존됨** |

> **참고**: 본 프로그램은 기본 동작으로 전체 플래시 삭제(`erase_flash`)를 수행하지 않습니다.

---

## 3. 펌웨어 파일 무결성 검증 (`Verify File Integrity`)

RoundMacroController V2는 손상된 바이너리나 타 보드용 펌웨어가 ESP32-S3에 기록되는 것을 방지하기 위해 **설치 전 검증**과 **기록 후 검증**을 모두 수행합니다.

### A. 앱 내 자동 무결성 검증 항목
1. **경로 및 확장자 검사**: Windows 기본 파일 선택 창에서 선택한 `.rmcfw.json` / `.bin` 파일(및 패키지/빌드 폴더 내부 이미지)만 허용하며, 상위 경로 이탈(`../`)을 차단합니다.
2. **바이너리 헤더 및 대상 칩(`ESP32-S3`) 검증**:
   - `bootloader.bin`, `firmware.bin`: 첫 바이트 매직 `0xE9` 및 오프셋 12의 칩 식별자 `chip_id === 9` (`ESP32-S3`) 확인. 타 MCU(ESP32 `chip_id=0`, ESP32-C3 등)용 이미지는 `WRONG_MCU` / `INVALID_FIRMWARE`로 거부됩니다.
   - `partitions.bin`: 파티션 테이블 매직 `0xAA50` 확인.
3. **파티션 크기 한도 검사**:
   - `bootloader.bin` ≤ 32KB (`0x8000`), `partitions.bin` ≤ 4KB (`0x1000`), `boot_app0.bin` ≤ 8KB (`0x2000`), `firmware.bin` ≤ 3MB (`0x300000`).
4. **SHA-256 체크섬 대조**: `.rmcfw.json` 패키지에 기록된 각 파일의 `sha256` 값과 실제 디스크 파일의 SHA-256 해시가 1바이트라도 다르면 플래싱을 차단합니다.
5. **플래시 기록 후 검증**: `esptool write_flash` 완료 시 장치 플래시에서 계산된 `Hash of data verified` 응답을 확인합니다.

### B. Windows PowerShell에서 수동 SHA-256 확인 방법
배포받은 파일이나 직접 빌드한 바이너리를 수동으로 대조하려면 PowerShell에서 해시를 확인하고 `<환경명>.rmcfw.json`의 `sha256` 필드와 비교하세요.

```powershell
Get-FileHash -Algorithm SHA256 .\firmware\dist\jc3636w518c_usb_composite\*.bin
```

---

## 4. 플래싱 도구 사용 방법 (Desktop GUI / `esptool` CLI)

### A. RoundMacroController V2 데스크톱 앱 GUI 사용 (권장)
1. **기기 관리 → ESP32-S3 펌웨어 관리** 패널 상단에서 `esptool` 도구 인식 상태(`도구 다시 확인`)를 확인합니다.
2. **USB 장치 검색**을 눌러 `Espressif ESP32-S3 (VID 0x303A)` COM 포트를 선택합니다.
3. 설치 모드(`INITIAL_INSTALL` 또는 `UPDATE`), 리셋 방식(`default_reset` 또는 `no_reset`), 전송 속도(`460800 bps` 기본 / 안정성 우선 시 `115200 bps`)를 지정합니다.
4. **펌웨어 선택**으로 `.rmcfw.json` 패키지 또는 `firmware.bin`을 불러온 뒤 모든 이미지의 검증 통과 여부를 확인합니다.
5. 확인 체크박스 선택 후 실행 버튼을 누르면 앱이 일반 시리얼 통신을 일시 중지하고 `esptool` 진행률(%)과 실시간 로그를 표시합니다. (취소 필요 시 작업 중 취소 가능)

### B. 명령줄(`esptool` CLI) 직접 실행 (고급/수동 복구용)
앱 GUI 외에 터미널에서 직접 플래싱해야 하는 경우 아래 검증된 `JC3636W518C` 옵션을 사용합니다 (`COMx`를 실제 포트로 변경):

```bat
:: 1) 최초 설치 (4개 이미지 전체 기록, 다운로드 모드 진입 후 실행)
python -m esptool --chip esp32s3 --port COMx --baud 460800 --before no_reset --after hard_reset write_flash -z --flash_mode qio --flash_freq 80m --flash_size 16MB 0x0000 bootloader.bin 0x8000 partitions.bin 0xe000 boot_app0.bin 0x10000 firmware.bin

:: 2) 기존 펌웨어 업데이트 (앱 영역만 기록하여 0x610000 LittleFS 설정 보존)
python -m esptool --chip esp32s3 --port COMx --baud 460800 --before default_reset --after hard_reset write_flash -z --flash_mode qio --flash_freq 80m --flash_size 16MB 0x10000 firmware.bin
```

---

## 5. ESP32-S3 USB 다운로드 모드 진입 방법

Guition JC3636W518C는 외부 USB-UART 변환 칩 없이 ESP32-S3 Native USB PHY(`GPIO 19/20`)를 사용합니다.
- **최초 설치(빈 보드 / 비정상 펌웨어 상태)** 또는 **TinyUSB 복합 모드에서 자동 리셋이 동작하지 않는 경우** 반드시 아래 수동 다운로드 모드 절차를 따르세요.

### 방법 A. 보드에 `BOOT` 및 `RESET(RST)` 버튼이 모두 있는 경우
1. 보드의 **`BOOT` (GPIO 0)** 버튼을 누른 상태를 유지합니다.
2. `BOOT`를 누른 채로 **`RESET(RST)`** 버튼을 1회 짧게 눌렀다 뗍니다.
3. 약 1초 후 **`BOOT`** 버튼에서 손을 뗍니다.
4. Windows PC에서 새 COM 포트가 인식됩니다. RoundMacroController V2 앱에서 **USB 장치 검색**을 눌러 새로 잡힌 포트를 선택합니다.

### 방법 B. `BOOT` 버튼만 있거나 `RESET` 버튼을 누르기 어려운 경우
1. 보드에서 USB-C 케이블을 분리합니다.
2. **`BOOT` (GPIO 0)** 버튼을 누른 상태를 유지하면서 PC 본체 USB 포트에 USB-C 케이블을 연결합니다.
3. 연결음(Windows 장치 인식)이 들린 뒤 약 1초 후 **`BOOT`** 버튼에서 손을 뗍니다.
4. **USB 장치 검색**을 눌러 다운로드용 COM 포트를 선택합니다.

> **포트 번호 변경 주의**: ESP32-S3 ROM 부트로더(다운로드 모드)에서 할당되는 `COMx` 번호와 정상 펌웨어 실행 중(TinyUSB CDC) 할당되는 `COMy` 번호가 Windows에서 다르게 잡힐 수 있습니다. 항상 **USB 장치 검색**으로 현재 포트를 확인하세요.

---

## 6. 최초 펌웨어 설치 절차 (`INITIAL_INSTALL`)

보드가 새 제품이거나, 기존 펌웨어가 없거나, Protocol V2 USB 통신이 응답하지 않을 때 사용합니다.
단일 `firmware.bin`만으로는 초기 보드를 부팅할 수 없으므로 부트로더와 파티션 테이블이 반드시 함께 기록되어야 합니다.

1. **수동 다운로드 모드 진입**
   - 위 **5장(ESP32-S3 USB 다운로드 모드 진입 방법)**을 따라 보드를 ROM 다운로드 모드로 전환하고 데이터 전송용 USB-C 케이블로 PC에 연결합니다.
2. **펌웨어 관리 화면 열기**
   - Windows Electron 앱 상단/좌측 **기기 관리** 탭으로 이동한 뒤 **ESP32-S3 펌웨어 관리** 패널을 엽니다.
3. **포트 검색 및 선택**
   - **USB 장치 검색** 버튼을 클릭하고, 감지된 `Espressif ESP32-S3 (VID 0x303A)` COM 포트를 선택합니다.
4. **설치 모드 및 리셋 방식 설정**
   - 설치 모드를 **최초 설치 (`INITIAL_INSTALL`)**로 선택합니다.
   - 리셋 방식이 **수동 BOOT/RESET 모드 (`no_reset`)**로 설정되었는지 확인합니다. (수동 다운로드 모드 진입 상태에서는 `no_reset`을 권장합니다.)
   - 통신 속도는 기본 `460800 bps`를 권장합니다(케이블 품질 문제 시 `115200 bps`로 낮춤).
5. **펌웨어 패키지 또는 이미지 선택**
   - **펌웨어 선택** 버튼을 클릭하고 Windows 기본 파일 선택 창에서 다음 중 하나를 선택합니다.
     - 권장: `jc3636w518c_usb_composite.rmcfw.json` (SHA-256 포함 패키지)
     - 또는: `firmware/.pio/build/<환경명>/firmware.bin` (같은 폴더의 `bootloader.bin`, `partitions.bin`, `boot_app0.bin`을 자동 탐색하며, 누락 시 개별 선택 버튼으로 추가 가능)
6. **무결성 확인 및 설치 실행**
   - 이미지 목록에서 `bootloader.bin (0x0000)`, `partitions.bin (0x8000)`, `firmware.bin (0x10000)` 및 ESP32-S3 헤더(`0xE9, chip_id=9`) 검증 통과 상태를 확인합니다.
   - 주의사항 확인 체크박스를 체크한 뒤 **펌웨어 설치 시작**을 클릭합니다.
   - 설치 중에는 일반 USB 통신·매크로 실행·설정 전송이 자동으로 일시 중지됩니다.
7. **재부팅 및 첫 연결 확인**
   - `esptool`이 `Hard resetting`을 완료하면 앱이 약 2.2초 대기 후 COM 포트를 자동 재검색해 `HELLO` / `GET_INFO` 핸드셰이크를 시도합니다.
   - 만약 수동 `no_reset` 모드로 인해 보드가 바로 재부팅되지 않았다면 보드의 **RESET 버튼**을 1회 누르거나 USB 케이블을 재연결한 뒤 **USB 장치 검색 → USB 연결**을 누릅니다.
8. **PC 설정 적용**
   - 연결 확인 후 기기 내부 LittleFS(`/rmc_config.json`)가 비어 있으면 앱에 **기기 설정 적용** 안내가 표시됩니다. 확인 후 적용하여 현재 프로필·버튼 배치·매크로를 기기에 동기화하세요.

---

## 7. 기존 펌웨어 업데이트 절차 (`UPDATE`)

이미 RoundMacroController V2 펌웨어가 설치되어 정상 통신 중인 보드를 새 버전으로 업데이트할 때 사용합니다.
PC에 저장된 프로필·매크로 설정 및 기기 내부 LittleFS(`0x610000`) 설정은 업데이트 과정에서 삭제되지 않습니다.

1. **기기 연결 및 현재 버전 확인**
   - 보드를 USB로 연결하고 **기기 관리**에서 **USB 장치 검색 → USB 연결**을 진행하여 현재 펌웨어 버전과 USB 모드(`TINYUSB_CDC_HID` / `HW_CDC_ONLY`)를 확인합니다.
2. **업데이트 모드 선택**
   - **ESP32-S3 펌웨어 관리**에서 설치 모드를 **기존 펌웨어 업데이트 (`UPDATE`)**로 선택합니다.
   - 리셋 방식은 기본값인 **자동 리셋 (`default_reset`)**을 선택합니다.
3. **새 펌웨어 선택 및 호환성 검증**
   - **펌웨어 선택**에서 새 버전의 `.rmcfw.json` 패키지 또는 `firmware.bin`을 선택합니다.
   - 업데이트 모드에서는 앱 이미지(`firmware.bin @ 0x10000`)만 기록 대상으로 구성되며 `0x610000` LittleFS 파티션 보존 여부를 화면에서 확인할 수 있습니다.
4. **사용자 확인 및 업데이트 실행**
   - 현재 버전과 새 버전 정보, 경고 문구를 확인한 뒤 확인 체크박스를 체크하고 **펌웨어 업데이트 시작**을 클릭합니다.
   - 앱이 기존 Protocol V2 시리얼 연결을 안전하게 해제한 뒤 `esptool`을 실행하고 진행률(%)과 실시간 로그를 표시합니다.
5. **자동 재연결 및 버전·설정 확인**
   - 플래싱 완료 후 보드가 재부팅되면 앱이 Espressif VID(`0x303A`) COM 포트를 다시 검색해 재연결하고 새 `firmwareVersion`을 검증합니다.
   - 기기 내부 설정 유무(`hasStoredConfig`)를 확인하여 설정이 유지되었는지 검사하고, 필요 시 사용자 확인을 거쳐 PC 설정을 재적용할 수 있습니다.

---

## 8. 설치 실패 시 오류별 복구 방법

설치가 실패하면 프로그램이 임의로 자동 재시도를 반복하지 않고 정확한 오류 코드와 복구 단계를 표시합니다. 오류 내용을 확인한 뒤 아래 절차에 따라 복구하세요.

| 오류 코드 | 원인 | 복구 절차 |
| --- | --- | --- |
| `TOOL_NOT_FOUND` | PC에 `esptool` / PlatformIO가 설치되지 않음 | `pip install esptool` 실행 또는 VS Code PlatformIO 설치 후 **도구 다시 확인** 클릭 |
| `BOOTLOADER_CONNECT_FAILED` | 자동 리셋 실패 또는 보드가 다운로드 모드에 진입하지 못함 | **5장** 절차대로 `BOOT + RESET` 수동 다운로드 모드 진입 → **USB 장치 검색**으로 포트 재선택 → 리셋 방식을 **`no_reset`**으로 변경 후 재시도 |
| `PORT_ACCESS_DENIED` | 다른 프로그램이 COM 포트를 점유 중임 | Arduino IDE, PlatformIO 시리얼 모니터, PuTTY 등 모든 시리얼 프로그램 종료 후 재시도 (필요 시 USB 재연결) |
| `USB_DISCONNECTED_DURING_FLASH` | 플래싱 도중 케이블 접촉 불량 또는 전원 부족으로 연결 끊김 | 충전 전용이 아닌 데이터 지원 USB-C 케이블로 PC 본체 포트에 직결 → `BOOT + RESET` 수동 진입 → **최초 설치 (`INITIAL_INSTALL`)** 모드로 다시 기록 (속도 `115200 bps` 권장) |
| `INVALID_FIRMWARE` / `WRONG_MCU` | 손상된 파일, SHA-256 불일치, ESP32-S3가 아닌 타 칩(`chip_id ≠ 9`)용 바이너리 | PlatformIO에서 `jc3636w518c_*` 환경으로 다시 빌드하거나 패키지를 재생성한 뒤 유효한 파일 선택 |
| `UNSUPPORTED_USB_VID` / `PORT_NOT_FOUND` | Espressif USB 장치(`0x303A`)가 아니거나 포트가 분리됨 | 올바른 ESP32-S3 COM 포트인지 확인하고 **USB 장치 검색** 후 재선택 |
| 플래싱 성공 후 재연결 타임아웃 | 보드가 부트로더 상태에 머물러 있거나 포트 재열거 지연 | 보드 **RESET 버튼 1회 클릭** 또는 USB 재연결 → **USB 장치 검색** → **USB 연결** 클릭 |

### 완전 복구(벽돌 상태 의심 시) 체크리스트
플래시 도중 전원이 꺼져 보드 화면이 켜지지 않거나 정상 COM 포트가 잡히지 않아도 ESP32-S3 내부 ROM 부트로더는 지워지지 않으므로 하드웨어 복구가 가능합니다.
1. USB-C 케이블을 PC 본체 후면(또는 직접 연결 USB 포트)에 연결할 준비를 합니다. (무전원 USB 허브 제거)
2. 보드의 **`BOOT` (GPIO 0)** 버튼을 누른 채 USB-C 케이블을 연결하고 1초 뒤 놓습니다.
3. 앱에서 **USB 장치 검색**으로 새 COM 포트를 확인합니다. (Windows 장치 관리자 `포트(COM & LPT)`에서 `USB 직렬 장치` 확인 가능)
4. 설치 모드를 **최초 설치 (`INITIAL_INSTALL`)**, 리셋 방식을 **수동 BOOT/RESET 모드 (`no_reset`)**, 속도를 **`115200 bps`**로 설정합니다.
5. `bootloader.bin`, `partitions.bin`, `firmware.bin`(및 `boot_app0.bin`)이 모두 검증된 패키지(`.rmcfw.json`) 또는 빌드 폴더를 선택해 다시 설치합니다.
6. 설치 완료 후 보드의 **RESET**을 눌러 정상 부팅을 확인하고, **기기 관리 → 기기에 설정 적용**으로 PC의 프로필·매크로를 복원합니다. (PC 설정 파일은 AppData에 보관되어 있으므로 영향을 받지 않습니다.)
