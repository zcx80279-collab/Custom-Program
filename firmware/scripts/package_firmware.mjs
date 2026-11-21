#!/usr/bin/env node
/**
 * Packages PlatformIO ESP32-S3 build artifacts into a verified RoundMacroController V2
 * firmware package directory + `.rmcfw.json` manifest with SHA-256 checksums.
 *
 * Usage:
 *   node firmware/scripts/package_firmware.mjs jc3636w518c_usb_composite
 *   node firmware/scripts/package_firmware.mjs jc3636w518c_cdc_only
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const firmwareRoot = path.resolve(__dirname, '..');

const envName = process.argv[2] || 'jc3636w518c_usb_composite';
const isComposite = envName === 'jc3636w518c_usb_composite';
const buildDir = path.join(firmwareRoot, '.pio', 'build', envName);

if (!fs.existsSync(buildDir)) {
  console.error(`[ERROR] PlatformIO build output directory not found: ${buildDir}`);
  console.error(`Run: cd firmware && pio run -e ${envName}`);
  process.exit(1);
}

const outDir = path.join(firmwareRoot, 'dist', envName);
fs.mkdirSync(outDir, { recursive: true });

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

const candidateBootApp0 = [
  path.join(buildDir, 'boot_app0.bin'),
  path.join(
    os.homedir(),
    '.platformio',
    'packages',
    'framework-arduinoespressif32',
    'tools',
    'partitions',
    'boot_app0.bin'
  ),
].find((p) => fs.existsSync(p));

const requiredFiles = [
  { role: 'bootloader', offset: '0x0000', src: path.join(buildDir, 'bootloader.bin'), fileName: 'bootloader.bin' },
  { role: 'partitions', offset: '0x8000', src: path.join(buildDir, 'partitions.bin'), fileName: 'partitions.bin' },
  ...(candidateBootApp0
    ? [{ role: 'boot_app0', offset: '0xe000', src: candidateBootApp0, fileName: 'boot_app0.bin' }]
    : []),
  { role: 'app', offset: '0x10000', src: path.join(buildDir, 'firmware.bin'), fileName: 'firmware.bin' },
];

const manifestImages = [];
for (const item of requiredFiles) {
  if (!fs.existsSync(item.src)) {
    console.error(`[ERROR] Required firmware artifact missing: ${item.src}`);
    process.exit(1);
  }
  const dest = path.join(outDir, item.fileName);
  fs.copyFileSync(item.src, dest);
  manifestImages.push({
    role: item.role,
    offset: item.offset,
    path: item.fileName,
    sha256: sha256(dest),
  });
}

const manifest = {
  packageFormat: 'rmc-v2-firmware-package',
  schemaVersion: '1.0.0',
  boardModel: 'Guition JC3636W518C',
  mcu: 'esp32s3',
  flashSize: '16MB',
  flashMode: 'qio',
  flashFreq: '80m',
  firmwareVersion: isComposite ? '2.0.0-rc1' : '2.0.0-rc1-cdc',
  environment: envName,
  usbMode: isComposite ? 'TINYUSB_CDC_HID' : 'HW_CDC_ONLY',
  createdAt: new Date().toISOString(),
  images: manifestImages,
};

const manifestPath = path.join(outDir, `${envName}.rmcfw.json`);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
console.log(`[OK] Firmware package created: ${manifestPath}`);
