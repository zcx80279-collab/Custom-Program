# RoundMacroController V2 — USB Communication Protocol (v2.0)

PC 애플리케이션(`src/shared/protocol.ts`, `electron/services/SerialDeviceService.ts`)과 ESP32-S3 펌웨어(`firmware/src/protocol.cpp`)가 공통으로 사용하는 USB CDC 직렬 통신 프로토콜입니다.

---

## 1. 전송 계층 및 프레이밍

- **물리 계층**: USB CDC Virtual COM Port (`115200 bps`, 8N1, UTF-8)
- **프레임 형식**:
  ```text
  $<CRC16_HEX>:<JSON_PAYLOAD>\n
  ```
- **예시**:
  ```text
  $8F3A:{"version":"2.0","requestId":"rmc-m1x9a2-0f1c2b","command":"HELLO","timestampMs":1763726400000,"data":{"client":"RoundMacroControllerV2-Windows"}}\n
  ```
- **무결성 및 손상/분할 수신 처리**:
  - 시작 문자 `$` 이전의 부트 로그나 노이즈 바이트는 자동 폐기됩니다.
  - 체크섬은 `JSON_PAYLOAD` UTF-8 바이트에 대한 **CRC-16/CCITT-FALSE** (`poly=0x1021`, `init=0xFFFF`) 4자리 대문자 16진수입니다.
  - USB 패킷이 여러 청크로 분할 도착하면 `\n` 수신 시까지 버퍼에 누적 조립합니다.
  - 버퍼 상한(`14336 bytes` 펌웨어 / `32768 bytes` PC) 초과 시 손상 프레임을 폐기하고 `FRAME_OVERFLOW` 오류를 반환합니다.
  - CRC 불일치 또는 JSON 파싱 실패 시 실행을 거부하고 `ERROR` 프레임을 응답합니다.

---

## 2. 공통 메시지 스키마

```json
{
  "version": "2.0",
  "requestId": "rmc-unique-id",
  "command": "HELLO | GET_INFO | GET_STATUS | SET_CONFIG | GET_CONFIG | RESET_CONFIG | ACK | ERROR | MACRO_EVENT",
  "timestampMs": 1763726400000,
  "data": {},
  "error": {
    "code": "ERR_CODE",
    "message": "Human readable explanation",
    "recoverable": true
  }
}
```

---

## 3. 지원 명령 정의

| 명령 | 방향 | 설명 | 응답 |
| --- | --- | --- | --- |
| `HELLO` | PC → 기기 | 연결 확인 및 왕복 지연 시간 측정 | `ACK` (`data.status = "HELLO_OK"`) |
| `GET_INFO` | PC → 기기 | 기기명, 보드 모델, MCU, 펌웨어/프로토콜 버전, USB 모드, HID 지원 여부 조회 | `ACK` (`data: DeviceInfo`) |
| `GET_STATUS` | PC → 기기 | 가동 시간, 활성 프로필 ID, 저장 여부, 디스플레이/터치/HID 준비 상태, 가용 메모리 조회 | `ACK` (`data: DeviceStatus`) |
| `SET_CONFIG` | PC → 기기 | 활성 프로필 및 버튼/매크로 경량 설정(`data.config`) 전송 및 LittleFS 원자적 저장 | `ACK` (`CONFIG_APPLIED`) 또는 `ERROR` |
| `GET_CONFIG` | PC → 기기 | 기기 LittleFS에 현재 저장된 설정 원본 조회 | `ACK` (`data.config`) |
| `RESET_CONFIG` | PC → 기기 | 기기 저장 설정만 초기화 (`data.confirm: true` 필수, 펌웨어 및 PC 원본 미삭제) | `ACK` (`CONFIG_RESET`) 또는 `ERROR` |
| `ACK` | 기기 → PC | 요청 성공 응답 (동일 `requestId` 포함) | - |
| `ERROR` | 기기 → PC | 검증 실패, CRC 불일치, 저장 실패 등 오류 응답 | - |
| `MACRO_EVENT` | 기기 → PC | 터치 입력 시 `PC_AGENT` 또는 폴백 `HYBRID` 매크로 실행 요청 (`data.macroId`, `data.slot`) | 비동기 단방향 이벤트 |

---

## 4. `SET_CONFIG` 경량 설정 페이로드 구조

```json
{
  "schemaVersion": "2.0.0",
  "profileId": "profile-default",
  "profileName": "기본 작업 프로필",
  "layout": "RADIAL_6_CENTER",
  "backgroundColor": "#0F172A",
  "buttons": [
    {
      "slot": 0,
      "label": "RUN",
      "color": "#2563EB",
      "enabled": true,
      "macroId": "macro-save-build",
      "mode": "HYBRID",
      "steps": [
        { "t": "COMBO", "hid": 22, "mod": 1 },
        { "t": "DELAY", "ms": 250 },
        { "t": "TAP", "hid": 62, "mod": 0 }
      ]
    }
  ]
}
```
- `hid`: USB HID Usage Page `0x07` 표준 Usage ID (`src/shared/keycodes.ts` 참조)
- `mod`: HID Modifier 비트마스크 (`Ctrl=0x01`, `Shift=0x02`, `Alt=0x04`, `Win=0x08`)

---

## 5. Windows 프로그램 실행 매크로(`LAUNCH_APP`) 처리 (6.5단계)

- 기존 프로토콜 V2 명령(`SET_CONFIG`, `MACRO_EVENT`)을 확장 없이 그대로 재사용합니다.
- `LAUNCH_APP` 동작이 1개 이상 포함된 매크로는 `compileDeviceCompactConfig()` 단계에서 다음 규칙으로 컴파일됩니다.
  - `mode`: 항상 `"PC_AGENT"`로 고정
  - `steps`: 빈 배열 `[]`
  - **Windows 실행 파일 경로(`appPath`), 실행 인수(`appArgs`), 작업 디렉터리(`workingDir`)는 ESP32-S3로 전송하거나 LittleFS에 저장하지 않습니다.**
- 사용자가 ESP32-S3 원형 화면 버튼을 터치하면 기기는 기존과 동일하게 `MACRO_EVENT` (`data.macroId`, `data.slot`, `data.testMode`)만 USB CDC로 송신합니다.
- Windows PC 프로그램(Electron 메인 프로세스)은 수신된 `slot`과 `macroId`를 **PC에 저장된 활성 프로필 및 매크로 설정**에서 대조 확인한 뒤 `child_process.spawn(exePath, args, { shell: false })`로 안전하게 실행합니다.

