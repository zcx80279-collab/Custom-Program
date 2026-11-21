import {
  DiagnosticLogEntry,
  LastCommResult,
  LogLevel,
  ProtocolCommand,
} from '../shared/types';

const MAX_LOG_ENTRIES = 300;

export class DiagnosticsManager {
  private logs: DiagnosticLogEntry[] = [];
  private lastComm: LastCommResult = {
    command: null,
    requestId: null,
    success: null,
    latencyMs: null,
    timestamp: null,
    summary: '아직 USB 통신 이력이 없습니다.',
  };
  private lastError: string | null = null;
  private listeners = new Set<() => void>();

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  public log(
    level: LogLevel,
    source: DiagnosticLogEntry['source'],
    message: string,
    details?: string
  ): void {
    const entry: DiagnosticLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      details,
    };
    this.logs = [entry, ...this.logs].slice(0, MAX_LOG_ENTRIES);
    if (level === LogLevel.ERROR) {
      this.lastError = details ? `${message} (${details})` : message;
    }
    this.emit();
  }

  public recordCommResult(result: {
    command: ProtocolCommand;
    requestId: string;
    success: boolean;
    latencyMs: number;
    summary: string;
  }): void {
    this.lastComm = {
      ...result,
      timestamp: new Date().toISOString(),
    };
    if (!result.success) {
      this.lastError = result.summary;
    }
    this.emit();
  }

  public clearError(): void {
    this.lastError = null;
    this.emit();
  }

  public clearLogs(): void {
    this.logs = [];
    this.emit();
  }

  public getLogs(): DiagnosticLogEntry[] {
    return this.logs;
  }

  public getLastComm(): LastCommResult {
    return this.lastComm;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public exportDiagnosticReport(extraContext: Record<string, unknown>): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        lastComm: this.lastComm,
        lastError: this.lastError,
        context: extraContext,
        logs: this.logs,
      },
      null,
      2
    );
  }
}
