#pragma once

/**
 * ============================================================================
 * Guition JC3636W518C Hardware Pin Configuration (ESP32-S3R8)
 * ============================================================================
 *
 * CRITICAL VERIFICATION NOTICE:
 * The pin definitions below are derived from public Guition JC3636W518 /
 * JC3636W518C reference schematics and open-source Arduino_GFX / ESPHome
 * configurations, NOT yet verified by physical hardware probing in this
 * AI Studio environment.
 *
 * Before flashing to a production unit, verify each pin against your physical
 * board silkscreen / manufacturer schematic PDF and set RMC_HARDWARE_VERIFIED=1.
 */

#ifndef RMC_HARDWARE_VERIFIED
#define RMC_HARDWARE_VERIFIED 0
#endif

#define RMC_BOARD_MODEL       "Guition JC3636W518C"
#define RMC_MCU_NAME          "ESP32-S3R8 (16MB Flash / 8MB OPI PSRAM)"
#define RMC_DEVICE_NAME       "RoundMacroController V2"
#define RMC_DISPLAY_WIDTH     360
#define RMC_DISPLAY_HEIGHT    360
#define RMC_DISPLAY_RADIUS    180

// ---------------------------------------------------------------------------
// Display Controller: ST77916 via QSPI (Documented Reference - Verify on Board)
// ---------------------------------------------------------------------------
#ifndef PIN_TFT_CS
#define PIN_TFT_CS            10
#endif
#ifndef PIN_TFT_SCK
#define PIN_TFT_SCK           9
#endif
#ifndef PIN_TFT_D0
#define PIN_TFT_D0            11
#endif
#ifndef PIN_TFT_D1
#define PIN_TFT_D1            12
#endif
#ifndef PIN_TFT_D2
#define PIN_TFT_D2            13
#endif
#ifndef PIN_TFT_D3
#define PIN_TFT_D3            14
#endif
#ifndef PIN_TFT_RST
#define PIN_TFT_RST           47
#endif
#ifndef PIN_TFT_BL
#define PIN_TFT_BL            15
#endif

// ---------------------------------------------------------------------------
// Capacitive Touch Controller: CST816S via I2C (Documented Reference - Verify)
// ---------------------------------------------------------------------------
#ifndef TOUCH_I2C_ADDR
#define TOUCH_I2C_ADDR        0x15
#endif
#ifndef PIN_TOUCH_SDA
#define PIN_TOUCH_SDA         7
#endif
#ifndef PIN_TOUCH_SCL
#define PIN_TOUCH_SCL         8
#endif
#ifndef PIN_TOUCH_INT
#define PIN_TOUCH_INT         41
#endif
#ifndef PIN_TOUCH_RST
#define PIN_TOUCH_RST         40
#endif

// ---------------------------------------------------------------------------
// Native ESP32-S3 USB OTG PHY (NO external CH340/CP2102 bridge)
// Do NOT reassign GPIO 19 or GPIO 20 to peripherals.
// ---------------------------------------------------------------------------
#define PIN_USB_DN            19
#define PIN_USB_DP            20
#define PIN_BOOT_BTN          0
