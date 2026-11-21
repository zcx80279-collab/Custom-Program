import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, CONFIG_SCHEMA_VERSION } from '../../src/shared/types';
import { createDefaultConfig } from '../../src/shared/defaults';
import { normalizeLoadedConfig } from '../../src/shared/programLaunch';

/**
 * Atomic PC configuration file store with automatic backup rollback.
 * Primary file: <userData>/config.json
 * Backup file:  <userData>/config.bak.json
 */
export class FileConfigStore {
  private readonly primaryPath: string;
  private readonly backupPath: string;
  private readonly tempPath: string;

  constructor(baseDir: string) {
    this.primaryPath = path.join(baseDir, 'config.json');
    this.backupPath = path.join(baseDir, 'config.bak.json');
    this.tempPath = path.join(baseDir, 'config.tmp.json');
  }

  public load(): { ok: boolean; config: AppConfig; error?: string } {
    for (const candidate of [this.primaryPath, this.backupPath]) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const raw = fs.readFileSync(candidate, 'utf-8');
        const parsed = JSON.parse(raw) as AppConfig;
        if (parsed && typeof parsed.schemaVersion === 'string' && Array.isArray(parsed.profiles)) {
          return { ok: true, config: normalizeLoadedConfig(parsed) };
        }
      } catch {
        // Fallback to backup or default
      }
    }

    const fallback = createDefaultConfig();
    return { ok: true, config: fallback };
  }

  public save(config: AppConfig): { ok: boolean; error?: string } {
    try {
      if (!config || !Array.isArray(config.profiles) || config.profiles.length === 0) {
        return { ok: false, error: '저장할 설정 구조가 올바르지 않습니다.' };
      }

      const normalized: AppConfig = {
        ...config,
        schemaVersion: CONFIG_SCHEMA_VERSION,
        lastModifiedAt: new Date().toISOString(),
      };

      const serialized = JSON.stringify(normalized, null, 2);

      // Write to temp file first, back up previous primary, then atomic rename
      fs.writeFileSync(this.tempPath, serialized, 'utf-8');
      if (fs.existsSync(this.primaryPath)) {
        fs.copyFileSync(this.primaryPath, this.backupPath);
      }
      fs.renameSync(this.tempPath, this.primaryPath);

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
