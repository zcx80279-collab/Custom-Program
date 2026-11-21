# RoundMacroController V2 — Hardware Reference (Guition JC3636W518C)

## 1. 대상 보드 기본 사양

| 항목 | 사양 |
| --- | --- |
| 제조사 / 모델 | Guition / **JC3636W518C** |
| MCU | ESP32-S3R8 (Dual-Core LX7, 240MHz) |
| Flash / PSRAM | 16MB QIO Flash / 8MB OPI PSRAM |
| 디스플레이 | 1.8"(1.85") 원형 IPS LCD, **360×360** |
| 전원 및 데이터 | USB-C (5V 전원 및 Native USB 통신) |

---

## 2. 참조 핀 배치 및 드라이버 (실물 보드 검증 필수)

> **중요 경고 (`RMC_HARDWARE_VERIFIED = 0`)**:
> 아래 핀 번호 및 드라이버 구성은 공개된 Guition JC3636W518 / JC3636W518C 제조사 예제 및 오픈소스 커뮤니티 회로 자료(Arduino_GFX, ESPHome)를 참조하여 `firmware/include/board_config.h`에 분리 정의한 값입니다.
> 본 개발 환경에는 실물 보드가 연결되어 있지 않으므로, **실제 보유 보드의 PCB 리비전 및 회로도 PDF와 반드시 대조 검증한 뒤** `RMC_HARDWARE_VERIFIED`를 `1`로 변경해야 합니다.

### A. 디스플레이 컨트롤러 — ST77916 (QSPI)

| 신호명 | 매크로 (`board_config.h`) | 참조 GPIO | 검증 상태 |
| --- | --- | --- | --- |
| CS | `PIN_TFT_CS` | GPIO 10 | 문서 참조 / **실물 미검증** |
| SCK / CLK | `PIN_TFT_SCK` | GPIO 9 | 문서 참조 / **실물 미검증** |
| QSPI D0 | `PIN_TFT_D0` | GPIO 11 | 문서 참조 / **실물 미검증** |
| QSPI D1 | `PIN_TFT_D1` | GPIO 12 | 문서 참조 / **실물 미검증** |
| QSPI D2 | `PIN_TFT_D2` | GPIO 13 | 문서 참조 / **실물 미검증** |
| QSPI D3 | `PIN_TFT_D3` | GPIO 14 | 문서 참조 / **실물 미검증** |
| RESET | `PIN_TFT_RST` | GPIO 47 | 문서 참조 / **실물 미검증** |
| BACKLIGHT | `PIN_TFT_BL` | GPIO 15 | 문서 참조 / **실물 미검증** |

### B. 정전식 터치 컨트롤러 — CST816S (I²C)

| 신호명 | 매크로 (`board_config.h`) | 참조 값 | 검증 상태 |
| --- | --- | --- | --- |
| I²C 주소 | `TOUCH_I2C_ADDR` | `0x15` | 문서 참조 / **실물 미검증** |
| SDA | `PIN_TOUCH_SDA` | GPIO 7 | 문서 참조 / **실물 미검증** |
| SCL | `PIN_TOUCH_SCL` | GPIO 8 | 문서 참조 / **실물 미검증** |
| INT | `PIN_TOUCH_INT` | GPIO 41 | 문서 참조 / **실물 미검증** |
| RST | `PIN_TOUCH_RST` | GPIO 40 | 문서 참조 / **실물 미검증** |

### C. USB 인터페이스 — ESP32-S3 Native USB OTG PHY

| 신호명 | 매크로 | GPIO | 비고 |
| --- | --- | --- | --- |
| USB D- | `PIN_USB_DN` | GPIO 19 | 외부 CH340/CP2102 브리지 없음 |
| USB D+ | `PIN_USB_DP` | GPIO 20 | 외부 CH340/CP2102 브리지 없음 |
| BOOT 버튼 | `PIN_BOOT_BTN` | GPIO 0 | ROM 부트로더 진입용 |

---

## 3. USB CDC + USB HID 동시 사용 검토 및 검증 지침

Guition JC3636W518C는 외부 UART 브리지 없이 ESP32-S3 내장 USB PHY(GPIO 19/20)를 사용하므로, **TinyUSB OTG 복합 장치(Composite Device)**로 `USB CDC (COM 포트)`와 `USB HID Keyboard`를 단일 케이블에서 동시 열거할 수 있는 하드웨어 구조를 갖추고 있습니다.

다만 실제 Windows 10/11 환경과 Arduino-ESP32 코어 버전에 따라 아래 항목을 실물에서 반드시 확인해야 합니다.

1. **`jc3636w518c_usb_composite` (`ARDUINO_USB_MODE=0`, `RMC_ENABLE_USB_HID=1`)**:
   - Windows 장치 관리자에서 `USB 직렬 장치 (COMx)`와 `HID 키보드 장치`가 동시에 정상 인식되는지 확인.
   - TinyUSB 모드에서 재플래싱 시 자동 리셋이 실패하면 `BOOT(GPIO 0)` 버튼을 누른 상태에서 USB를 연결하거나 `RESET` 후 업로드해야 합니다.
2. **`jc3636w518c_cdc_only` (`ARDUINO_USB_MODE=1`, `RMC_ENABLE_USB_HID=0`)**:
   - 초기 통신/화면/터치 검증용 안전 빌드입니다. 이 모드에서는 `HYBRID` 및 `PC_AGENT` 매크로가 USB CDC `MACRO_EVENT`를 통해 Windows PC 프로그램에서 실행됩니다.

---

## 4. 실물 검증 시 확인 필요 자료

- 보유한 Guition JC3636W518C PCB 리비전의 공식 회로도 PDF (특히 `TFT_RST`, `TFT_BL` 극성, `TOUCH_INT`/`TOUCH_RST` 핀 일치 여부)
- ST77916 패널 초기화 시퀀스 및 색상 반전(`IPS` 플래그), 회전 방향(0/90/180/270°) 실물 육안 확인
- CST816S 터치 좌표 X/Y 축 방향 및 원형 화면 중심점 `(180, 180)` 정렬 오차 확인

---

## 5. 플래시 메모리 맵 및 USB 다운로드 모드 (`partitions_16mb.csv` 기준)

| 영역 | 오프셋 | 크기 | 이미지 파일 | 비고 |
| --- | --- | --- | --- | --- |
| Bootloader | `0x0000` | max 32KB | `bootloader.bin` | ESP32-S3 2차 부트로더 (최초 설치 필수) |
| Partition Table | `0x8000` | max 4KB | `partitions.bin` | `partitions_16mb.csv` 컴파일 결과 (최초 설치 필수) |
| NVS | `0x9000` | `0x5000` | - | 시스템 NVS |
| OTA Data (`boot_app0`) | `0xe000` | `0x2000` | `boot_app0.bin` | `ota_0` 부팅 포인터 |
| Application (`app0`) | `0x10000` | `0x300000` (3MB) | `firmware.bin` | 업데이트 시 이 영역만 기록 |
| LittleFS (`spiffs`) | `0x610000` | `0x9E0000` (~9.8MB) | - | 기기 내부 설정(`/rmc_config.json`) 저장소 — 기본 업데이트 시 보존 |

- **수동 다운로드 모드 진입 방법**: `BOOT (GPIO 0)` 버튼을 누른 상태에서 `RESET` 버튼을 1회 눌렀다 떼고, 1초 뒤 `BOOT` 버튼을 놓습니다 (또는 `BOOT`를 누른 채 USB-C 케이블 연결).
- 다운로드 모드 진입 시 Windows에서 기존 실행 COM 포트와 다른 번호로 열거될 수 있으므로 포트 재검색 후 플래싱해야 합니다.
