#include "diagnostics_manager.h"

void DiagnosticsManager::begin() {
  _lastErrorCode = "";
  _lastErrorDetail = "";
}

void DiagnosticsManager::recordError(const char* code, const char* detail) {
  _lastErrorCode = code ? code : "ERR_UNKNOWN";
  _lastErrorDetail = detail ? detail : "";
}

void DiagnosticsManager::clearError() {
  _lastErrorCode = "";
  _lastErrorDetail = "";
}
