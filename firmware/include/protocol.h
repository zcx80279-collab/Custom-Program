#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

/**
 * Protocol V2 Framing Specification:
 *   $<HEX_CRC16_CCITT>:<JSON_PAYLOAD>\n
 *
 * Commands:
 *   HELLO, GET_INFO, GET_STATUS, SET_CONFIG, GET_CONFIG, RESET_CONFIG,
 *   ACK, ERROR, MACRO_EVENT
 */

#define RMC_PROTOCOL_VERSION  "2.0"
#define RMC_MAX_FRAME_LEN     14336

class ProtocolHandler {
public:
  using MessageCallback = void (*)(const JsonDocument& doc);

  void begin(Stream* serialStream, MessageCallback onMessage);
  void poll();

  static uint16_t crc16Ccitt(const uint8_t* data, size_t length);
  bool sendFrame(const JsonDocument& doc);
  bool sendAck(const char* requestId, const char* statusText = "OK");
  bool sendError(const char* requestId, const char* code, const char* message, bool recoverable = true);
  bool sendMacroEvent(const char* macroId, int slotIndex, bool testMode = false);

private:
  Stream* _stream = nullptr;
  MessageCallback _onMessage = nullptr;
  String _rxBuffer;

  void processLine(const String& line);
};
