import { TaskRunner } from "../core/task-runner.js";

export class StatusBar {
  private taskRunner: TaskRunner;
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastLine: string = "";
  private enabled: boolean = true;

  constructor(taskRunner: TaskRunner) {
    this.taskRunner = taskRunner;
  }

  start(): void {
    this.interval = setInterval(() => this.render(), 1000);
    // Also render on task events
    this.taskRunner.on("task", () => {
      setTimeout(() => this.render(), 100);
    });
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.clear();
  }

  disable(): void {
    this.enabled = false;
    this.clear();
  }

  enable(): void {
    this.enabled = true;
  }

  private render(): void {
    if (!this.enabled) return;

    const running = this.taskRunner.getRunning();
    const pending = this.taskRunner.getPending();
    const recentCompleted = this.taskRunner.getCompleted().slice(-3);

    // Build status segments
    const segments: string[] = [];

    // Running tasks/agents
    for (const task of running) {
      const elapsed = task.startedAt
        ? `${Math.floor((Date.now() - task.startedAt.getTime()) / 1000)}s`
        : "...";
      segments.push(`◉ ${task.name} (${elapsed})`);
    }

    // Pending count
    if (pending.length > 0) {
      segments.push(`○ ${pending.length} queued`);
    }

    // Recent completions (last 3, only show for 10 seconds)
    for (const task of recentCompleted) {
      if (task.completedAt && Date.now() - task.completedAt.getTime() < 10000) {
        const icon = task.status === "completed" ? "✓" : "✗";
        segments.push(`${icon} ${task.name}`);
      }
    }

    const line = segments.length > 0
      ? `⚡ ${segments.join(" │ ")}`
      : "";

    // Only update if changed
    if (line === this.lastLine) return;
    this.lastLine = line;

    if (line) {
      // Save cursor, move to bottom, write, restore cursor
      const cols = process.stdout.columns || 80;
      const rows = process.stdout.rows || 24;
      const truncated = line.length > cols - 2 ? line.slice(0, cols - 5) + "..." : line;

      process.stdout.write(
        `\x1B[s` +                           // Save cursor
        `\x1B[${rows};1H` +                  // Move to last row
        `\x1B[2K` +                          // Clear line
        `\x1B[7m ${truncated} \x1B[0m` +     // Inverse video (highlight bar)
        `\x1B[u`                             // Restore cursor
      );
    } else {
      this.clear();
    }
  }

  private clear(): void {
    const rows = process.stdout.rows || 24;
    process.stdout.write(
      `\x1B[s` +
      `\x1B[${rows};1H` +
      `\x1B[2K` +
      `\x1B[u`
    );
    this.lastLine = "";
  }
}
