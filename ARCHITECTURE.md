# RoundMacroController V2 — Architecture

## 1. 역할 분리 (PC 프로그램 vs ESP32-S3 펌웨어)

| 계층 | 담당 역할 | 저장소 |
| --- | --- | --- |
| **Windows PC 프로그램 (Electron + React)** | 설정 원본 보관, 프로필 CRUD, 매크로 편집·검증, 360×360 미리보기, USB 통신 제어, `PC_AGENT` 매크로 실행, 기기 진단 로그 | `%APPDATA%/RoundMacroControllerV2/config.json` (`.bak` 백업 포함) |
| **ESP32-S3 펌웨어 (PlatformIO)** | 적용된 활성 프로필 비휘발성 저장, 360×360 원형 화면 렌더링, 정전식 터치 좌표 판정, `DEVICE_HID` 단독 실행, `PC_AGENT` 이벤트 전송 | LittleFS `/rmc_config.json` (`/rmc_config.bak` 롤백 포함) |

---

## 2. 6대 핵심 모듈 구조

PC 렌더러(`src/modules/`), Electron 메인(`electron/services/`), 펌웨어(`firmware/src/`)가 동일한 모듈 경계를 공유합니다.

1. **`DeviceManager`**
   - USB 포트 탐색, 지원 기기(Espressif VID `0x303A`) 식별, 연결/해제, 핸드셰이크(`HELLO`/`GET_INFO`/`GET_STATUS`), USB 분리 감지, 자동 재연결, 연결 테스트.
   - Electron 환경에서는 `window.roundMacroAPI.device` IPC를, 브라우저 환경에서는 Web Serial API를 사용합니다.
2. **`MacroEngine`**
   - 단일 키, 키 조합, 순차 실행, 지연 시간(10~10,000ms) 정의 및 화이트리스트 키코드 검증.
   - 실행 방식 구분:
     - `DEVICE_HID`: ESP32-S3가 USB HID 키보드 리포트를 직접 전송 (PC 앱 미실행 상태에서도 동작).
     - `PC_AGENT`: ESP32-S3가 USB CDC로 `MACRO_EVENT`를 전송하고, Windows PC 프로그램이 Win32 `keybd_event` 화이트리스트 실행기로 수행.
     - `HYBRID`: 기기에서 USB HID가 활성화된 경우 기기 단독 실행, 미활성(CDC 전용 펌웨어 등) 시 `PC_AGENT`로 자동 전환하여 충돌 방지.
3. **`ProfileManager`**
   - 프로필 생성, 이름/설명 변경, 복제, 삭제(최소 1개 보호), 전환, 원형 레이아웃 프리셋(4+1 / 6+1 / 8+1) 및 슬롯별 버튼·매크로 매핑 관리.
4. **`ConfigManager`**
   - 스키마 버전(`2.0.0`) 기반 설정 검증, 원자적 파일 저장(`.tmp` → `.bak` 회전 → 교체), JSON 내보내기/가져오기, 기기 초기화 시 PC 원본 보호.
5. **`DisplayManager`**
   - 360×360 원형 좌표계(`center=(180,180)`, `centerR=56`, `ring=[64..170]`) 기하학 계산 및 터치 히트테스트.
   - PC와 펌웨어가 동일한 수학 공식을 공유(`src/shared/geometry.ts` ↔ `firmware/src/touch_manager.cpp`)하여 화면 미리보기와 실제 터치 판정이 일치합니다.
6. **`DiagnosticsManager`**
   - 프로토콜 TX/RX 로그, 마지막 통신 결과 및 응답 시간, 최근 오류 메시지, 진단 리포트 JSON 내보내기.

---

## 3. 보안 설계

- **Electron 프로세스 격리**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- **제한된 IPC 브리지**: `electron/preload.ts`는 `RoundMacroDesktopAPI`에 정의된 명시적 채널만 노출하며, 파일시스템/쉘/시리얼 객체를 렌더러에 노출하지 않습니다.
- **임의 명령 실행 방지**: `src/shared/keycodes.ts`의 정수 HID Usage ID 및 Windows `VK_*` 화이트리스트만 허용합니다. `WindowsMacroExecutor`는 문자열 보간 없이 검증된 정수 코드 목록만 인자로 전달합니다.
- **입력 및 통신 무결성 검증**: 모든 USB 패킷은 CRC-16/CCITT-FALSE 체크섬과 필수 스키마를 검증하며, 설정 파일 불러오기 및 `SET_CONFIG` 적용 전 스키마·키코드·크기 제한(12KB)을 검사합니다.
- **위험 작업 사용자 확인**: `RESET_CONFIG`는 명시적 체크박스 확인 모달(`ResetConfirmModal`)과 페이로드 `data.confirm=true` 검증 없이는 실행되지 않습니다.
