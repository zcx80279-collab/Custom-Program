#include "device_manager.h"
#include "board_config.h"
#include "protocol.h"
#include <esp_system.h>
#include <esp_chip_info.h>

#ifndef RMC_FIRMWARE_VERSION
#define RMC_FIRMWARE_VERSION "2.0.0-dev"
#endif

void DeviceManager::begin() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[24];
  snprintf(buf, sizeof(buf), "RMC2-%04X%08X",
           static_cast<uint16_t>(mac >> 32),
           static_cast<uint32_t>(mac & 0xFFFFFFFF));
  _serialNumber = buf;
}

void DeviceManager::populateInfo(JsonObject dataOut, bool hidReady) const {
  dataOut["deviceName"] = RMC_DEVICE_NAME;
  dataOut["boardModel"] = RMC_BOARD_MODEL;
  dataOut["mcu"] = RMC_MCU_NAME;
  dataOut["firmwareVersion"] = RMC_FIRMWARE_VERSION;
  dataOut["protocolVersion"] = RMC_PROTOCOL_VERSION;
  dataOut["serialNumber"] = _serialNumber;
  dataOut["displayResolution"] = "360x360";
#if RMC_ENABLE_USB_HID
  dataOut["usbMode"] = "TINYUSB_CDC_HID";
#else
  dataOut["usbMode"] = "HW_CDC_ONLY";
#endif
  dataOut["hidSupported"] = hidReady;
  dataOut["storageType"] = "LittleFS";
  dataOut["hardwareVerified"] = (RMC_HARDWARE_VERIFIED == 1);
}

void DeviceManager::populateStatus(
    JsonObject dataOut,
    const ConfigManager& configMgr,
    const DisplayManager& displayMgr,
    const TouchManager& touchMgr,
    const MacroEngine& macroEng,
    const DiagnosticsManager& diagMgr) const {
  const auto& cfg = configMgr.getCurrent();
  dataOut["uptimeMs"] = millis();
  dataOut["activeProfileId"] = cfg.profileId;
  dataOut["configSchemaVersion"] = cfg.schemaVersion;
  dataOut["hasStoredConfig"] = configMgr.hasStoredConfig();
  dataOut["displayReady"] = displayMgr.isReady();
  dataOut["touchReady"] = touchMgr.isReady();
  dataOut["hidReady"] = macroEng.isHidReady();
  dataOut["testMode"] = macroEng.isTestMode();
  dataOut["freeHeapBytes"] = ESP.getFreeHeap();
  dataOut["freePsramBytes"] = ESP.getFreePsram();
  if (diagMgr.hasError()) {
    dataOut["lastErrorCode"] = diagMgr.getLastErrorCode();
  } else {
    dataOut["lastErrorCode"] = nullptr;
  }
}
