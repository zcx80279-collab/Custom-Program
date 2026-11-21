#pragma once

#include <Arduino.h>

class DiagnosticsManager {
public:
  void begin();
  void recordError(const char* code, const char* detail);
  void clearError();
  const char* getLastErrorCode() const { return _lastErrorCode.c_str(); }
  bool hasError() const { return _lastErrorCode.length() > 0; }

private:
  String _lastErrorCode;
  String _lastErrorDetail;
};
