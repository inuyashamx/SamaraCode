import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

export interface AuditEntry {
  timestamp: string;
  type: "tool_call" | "tool_result" | "agent_spawn" | "agent_result" | "plan_created" | "plan_approved" | "error" | "tool_created";
  actor: string; // "orchestrator" | agent name
  action: string;
  details: any;
  success?: boolean;
}

export class AuditLog {
  private logDir: string;
  private sessionId: string;
  private entries: AuditEntry[] = [];

  constructor(logDir: string = path.join(os.homedir(), ".samaracode", "audit")) {
    this.logDir = path.resolve(logDir);
    this.sessionId = `session_${Date.now()}`;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true });
  }

  async log(entry: Omit<AuditEntry, "timestamp">): Promise<void> {
    const full: AuditEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(full);

    // Append to session log file
    const logFile = path.join(this.logDir, `${this.sessionId}.jsonl`);
    await fs.appendFile(logFile, JSON.stringify(full) + "\n");
  }

  getEntries(): AuditEntry[] {
    return [...this.entries];
  }

  getSessionId(): string {
    return this.sessionId;
  }

  // Get summary of current session for display
  getSummary(): string {
    const toolCalls = this.entries.filter((e) => e.type === "tool_call").length;
    const agents = this.entries.filter((e) => e.type === "agent_spawn").length;
    const errors = this.entries.filter((e) => e.type === "error").length;
    const toolsCreated = this.entries.filter((e) => e.type === "tool_created").length;

    return `Session ${this.sessionId}: ${toolCalls} tool calls, ${agents} agents spawned, ${toolsCreated} tools created, ${errors} errors`;
  }

  // List past sessions
  async listSessions(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.logDir);
      return files.filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(".jsonl", ""));
    } catch {
      return [];
    }
  }

  // Read a past session
  async readSession(sessionId: string): Promise<AuditEntry[]> {
    const logFile = path.join(this.logDir, `${sessionId}.jsonl`);
    const content = await fs.readFile(logFile, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((l) => l)
      .map((l) => JSON.parse(l));
  }
}
