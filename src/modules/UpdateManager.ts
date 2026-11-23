export interface ReleaseInfo {
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  release?: ReleaseInfo;
  error?: string;
}

export class UpdateManager {
  private currentVersion = '2.2.0';
  private defaultOwner = 'zcx80279';
  private defaultRepo = 'RoundMacroController-V2';

  constructor(currentVersion = '2.2.0') {
    this.currentVersion = currentVersion;
  }

  public getCurrentVersion(): string {
    return this.currentVersion;
  }

  /**
   * Compare two semantic version strings (e.g., '2.2.0' vs '2.3.1' or 'v2.3.0')
   * Returns true if v2 > v1
   */
  public isNewerVersion(current: string, latest: string): boolean {
    const cleanCurrent = current.replace(/^v/i, '').trim();
    const cleanLatest = latest.replace(/^v/i, '').trim();

    const currParts = cleanCurrent.split('.').map((p) => parseInt(p, 10) || 0);
    const latestParts = cleanLatest.split('.').map((p) => parseInt(p, 10) || 0);

    for (let i = 0; i < Math.max(currParts.length, latestParts.length); i++) {
      const c = currParts[i] || 0;
      const l = latestParts[i] || 0;
      if (l > c) return true;
      if (l < c) return false;
    }
    return false;
  }

  /**
   * Check GitHub Releases API for the latest version
   */
  public async checkForUpdates(owner = this.defaultOwner, repo = this.defaultRepo): Promise<UpdateCheckResult> {
    try {
      const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
      const res = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!res.ok) {
        if (res.status === 404) {
          return {
            hasUpdate: false,
            currentVersion: this.currentVersion,
            latestVersion: this.currentVersion,
            error: 'GitHub 릴리스 정보를 찾을 수 없습니다 (아직 릴리스가 등록되지 않았을 수 있습니다).',
          };
        }
        if (res.status === 403) {
          return {
            hasUpdate: false,
            currentVersion: this.currentVersion,
            latestVersion: this.currentVersion,
            error: 'GitHub API 요청 한도(Rate Limit)를 초과했습니다. 잠시 후 다시 시도해 주세요.',
          };
        }
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      const tagName = String(data.tag_name ?? data.name ?? 'v2.2.0');
      const latestVersion = tagName.replace(/^v/i, '').trim();
      const hasUpdate = this.isNewerVersion(this.currentVersion, latestVersion);

      const releaseInfo: ReleaseInfo = {
        tagName,
        name: String(data.name ?? tagName),
        body: String(data.body ?? '새로운 릴리스 노트가 제공되지 않았습니다.'),
        htmlUrl: String(data.html_url ?? `https://github.com/${owner}/${repo}/releases/latest`),
        publishedAt: String(data.published_at ?? new Date().toISOString()),
      };

      return {
        hasUpdate,
        currentVersion: this.currentVersion,
        latestVersion,
        release: releaseInfo,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '알 수 없는 네트워크 오류';
      return {
        hasUpdate: false,
        currentVersion: this.currentVersion,
        latestVersion: this.currentVersion,
        error: `업데이트 확인 실패: ${message}`,
      };
    }
  }
}
