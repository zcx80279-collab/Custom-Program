#include "protocol.h"

void ProtocolHandler::begin(Stream* serialStream, MessageCallback onMessage) {
  _stream = serialStream;
  _onMessage = onMessage;
  _rxBuffer.reserve(2048);
}

uint16_t ProtocolHandler::crc16Ccitt(const uint8_t* data, size_t length) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < length; ++i) {
    crc ^= static_cast<uint16_t>(data[i]) << 8;
    for (int bit = 0; bit < 8; ++bit) {
      if (crc & 0x8000) {
        crc = static_cast<uint16_t>((crc << 1) ^ 0x1021);
      } else {
        crc = static_cast<uint16_t>(crc << 1);
      }
    }
  }
  return crc;
}

void ProtocolHandler::poll() {
  if (!_stream) return;

  while (_stream->available() > 0) {
    char c = static_cast<char>(_stream->read());
    if (c == '\r') continue;

    if (c == '\n') {
      if (_rxBuffer.length() > 0) {
        processLine(_rxBuffer);
        _rxBuffer = "";
      }
      continue;
    }

    if (_rxBuffer.length() >= RMC_MAX_FRAME_LEN) {
      // Drop oversized corrupted packet safely and notify host
      _rxBuffer = "";
      sendError("unknown", "FRAME_OVERFLOW", "Frame exceeded RMC_MAX_FRAME_LEN", true);
      continue;
    }
    _rxBuffer += c;
  }
}

void ProtocolHandler::processLine(const String& line) {
  int sentinelIdx = line.indexOf('$');
  if (sentinelIdx < 0) {
    return; // Ignore non-protocol noise
  }

  String body = line.substring(sentinelIdx + 1);
  if (body.length() < 6 || body.charAt(4) != ':') {
    sendError("unknown", "INVALID_FRAME", "Malformed CRC header", true);
    return;
  }

  String rxCrcHex = body.substring(0, 4);
  rxCrcHex.toUpperCase();
  String jsonStr = body.substring(5);

  uint16_t computed = crc16Ccitt(reinterpret_cast<const uint8_t*>(jsonStr.c_str()), jsonStr.length());
  char expectedHex[5];
  snprintf(expectedHex, sizeof(expectedHex), "%04X", computed);

  if (rxCrcHex != expectedHex) {
    sendError("unknown", "CRC_MISMATCH", "Frame CRC-16/CCITT verification failed", true);
    return;
  }

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, jsonStr);
  if (err) {
    sendError("unknown", "INVALID_JSON", err.c_str(), true);
    return;
  }

  if (!doc["version"].is<const char*>() ||
      !doc["requestId"].is<const char*>() ||
      !doc["command"].is<const char*>()) {
    sendError("unknown", "INVALID_SCHEMA", "Missing version, requestId, or command", true);
    return;
  }

  if (_onMessage) {
    _onMessage(doc);
  }
}

bool ProtocolHandler::sendFrame(const JsonDocument& doc) {
  if (!_stream) return false;

  String json;
  serializeJson(doc, json);

  uint16_t crc = crc16Ccitt(reinterpret_cast<const uint8_t*>(json.c_str()), json.length());
  char header[8];
  snprintf(header, sizeof(header), "$%04X:", crc);

  _stream->print(header);
  _stream->print(json);
  _stream->print('\n');
  _stream->flush();
  return true;
}

bool ProtocolHandler::sendAck(const char* requestId, const char* statusText) {
  JsonDocument doc;
  doc["version"] = RMC_PROTOCOL_VERSION;
  doc["requestId"] = requestId;
  doc["command"] = "ACK";
  doc["timestampMs"] = millis();
  doc["data"]["status"] = statusText;
  return sendFrame(doc);
}

bool ProtocolHandler::sendError(const char* requestId, const char* code, const char* message, bool recoverable) {
  JsonDocument doc;
  doc["version"] = RMC_PROTOCOL_VERSION;
  doc["requestId"] = requestId;
  doc["command"] = "ERROR";
  doc["timestampMs"] = millis();
  doc["error"]["code"] = code;
  doc["error"]["message"] = message;
  doc["error"]["recoverable"] = recoverable;
  return sendFrame(doc);
}

bool ProtocolHandler::sendMacroEvent(const char* macroId, int slotIndex, bool testMode) {
  JsonDocument doc;
  doc["version"] = RMC_PROTOCOL_VERSION;
  doc["requestId"] = String("evt-") + String(millis());
  doc["command"] = "MACRO_EVENT";
  doc["timestampMs"] = millis();
  doc["data"]["macroId"] = macroId;
  doc["data"]["slot"] = slotIndex;
  doc["data"]["testMode"] = testMode;
  return sendFrame(doc);
}
