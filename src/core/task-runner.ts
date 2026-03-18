import { EventEmitter } from "events";
import { ChildProcess, spawn } from "child_process";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type TaskType = "agent" | "background" | "process";

export interface Task {
  id: string;
  name: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: any;
  error?: string;
  progress?: string;
  parentId?: string;
  // Model info
  model?: string;
  provider?: string;
  // For long-running processes
  process?: ChildProcess;
  outputLines?: string[];
}

export interface TaskEvent {
  taskId: string;
  type: "started" | "progress" | "completed" | "failed" | "url_detected";
  data?: any;
}

export class TaskRunner extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private running: number = 0;
  private maxConcurrent: number;
  private queue: Array<{ task: Task; fn: () => Promise<any> }> = [];

  constructor(maxConcurrent: number = 5) {
    super();
    this.maxConcurrent = maxConcurrent;
  }

  // Submit a task to run in the background
  submit(
    name: string,
    description: string,
    fn: (updateProgress: (msg: string) => void) => Promise<any>,
    parentId?: string,
    type: TaskType = "agent"
  ): string {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const task: Task = {
      id,
      name,
      description,
      type,
      status: "pending",
      createdAt: new Date(),
      parentId,
    };

    this.tasks.set(id, task);

    const wrappedFn = async () => {
      task.status = "running";
      task.startedAt = new Date();
      this.running++;
      this.emit("task", { taskId: id, type: "started" } as TaskEvent);

      const updateProgress = (msg: string) => {
        task.progress = msg;
        this.emit("task", { taskId: id, type: "progress", data: msg } as TaskEvent);
      };

      try {
        const result = await fn(updateProgress);
        task.status = "completed";
        task.result = result;
        task.completedAt = new Date();
        this.emit("task", { taskId: id, type: "completed", data: result } as TaskEvent);
        return result;
      } catch (err: any) {
        task.status = "failed";
        task.error = err.message;
        task.completedAt = new Date();
        this.emit("task", { taskId: id, type: "failed", data: err.message } as TaskEvent);
        throw err;
      } finally {
        this.running--;
        this.processQueue();
      }
    };

    if (this.running < this.maxConcurrent) {
      wrappedFn().catch(() => {}); // Error is captured in task
    } else {
      this.queue.push({ task, fn: wrappedFn });
    }

    return id;
  }

  private processQueue(): void {
    while (this.queue.length > 0 && this.running < this.maxConcurrent) {
      const next = this.queue.shift()!;
      next.fn().catch(() => {});
    }
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getAll(): Task[] {
    return Array.from(this.tasks.values());
  }

  getRunning(): Task[] {
    return this.getAll().filter((t) => t.status === "running");
  }

  getPending(): Task[] {
    return this.getAll().filter((t) => t.status === "pending");
  }

  getCompleted(): Task[] {
    return this.getAll().filter((t) => t.status === "completed" || t.status === "failed");
  }

  // Spawn a long-running process (dev servers, watchers, etc.)
  spawnProcess(name: string, command: string, cwd?: string): string {
    const id = `proc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const isWindows = process.platform === "win32";

    const task: Task = {
      id,
      name,
      description: `Process: ${command}`,
      type: "process",
      status: "running",
      createdAt: new Date(),
      startedAt: new Date(),
      outputLines: [],
    };

    const shell = isWindows ? "cmd.exe" : "/bin/bash";
    const shellArgs = isWindows ? ["/c", command] : ["-c", command];

    const proc = spawn(shell, shellArgs, {
      cwd: cwd || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    task.process = proc;
    this.tasks.set(id, task);
    this.emit("task", { taskId: id, type: "started" } as TaskEvent);

    let urlEmitted = false;
    const addOutput = (data: Buffer) => {
      const lines = data.toString().split("\n").filter((l) => l.trim());
      for (const line of lines) {
        task.outputLines!.push(line);
        // Keep last 200 lines
        if (task.outputLines!.length > 200) task.outputLines!.shift();
        task.progress = line;
        this.emit("task", { taskId: id, type: "progress", data: line } as TaskEvent);

        // Auto-detect dev server URLs and emit preview event
        if (!urlEmitted) {
          // Strip ANSI escape codes before matching
          const clean = line.replace(/\x1b\[[0-9;]*m/g, "");
          const urlMatch = clean.match(/https?:\/\/localhost[:\d]*/);
          if (urlMatch) {
            urlEmitted = true;
            const originalUrl = urlMatch[0];
            this.emit("task", { taskId: id, type: "url_detected", data: { url: originalUrl + "/", name: name } } as TaskEvent);
          }
        }
      }
    };

    proc.stdout?.on("data", addOutput);
    proc.stderr?.on("data", addOutput);

    proc.on("close", (code) => {
      task.status = code === 0 || task.status === "cancelled" ? "completed" : "failed";
      task.completedAt = new Date();
      task.error = code !== 0 && task.status !== "completed" ? `Exit code: ${code}` : undefined;
      this.emit("task", { taskId: id, type: task.status === "completed" ? "completed" : "failed", data: task.error } as TaskEvent);
    });

    proc.on("error", (err) => {
      task.status = "failed";
      task.error = err.message;
      task.completedAt = new Date();
      this.emit("task", { taskId: id, type: "failed", data: err.message } as TaskEvent);
    });

    return id;
  }

  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    if (task.status === "pending") {
      task.status = "cancelled";
      this.queue = this.queue.filter((q) => q.task.id !== id);
      return true;
    }

    // Kill running processes
    if (task.status === "running" && task.process) {
      task.status = "cancelled";
      task.completedAt = new Date();
      try {
        const pid = task.process.pid;
        if (pid) {
          const isWindows = process.platform === "win32";
          if (isWindows) {
            spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore" });
          } else {
            task.process.kill("SIGTERM");
          }
        } else {
          task.process.kill();
        }
      } catch (e) {
        // Process may already be dead
      }
      this.emit("task", { taskId: id, type: "completed", data: "Cancelled by user" } as TaskEvent);
      return true;
    }

    return false;
  }

  getProcessOutput(id: string): string[] {
    const task = this.tasks.get(id);
    return task?.outputLines || [];
  }

  // Summary for LLM context
  getSummary(): string {
    const running = this.getRunning();
    const pending = this.getPending();
    const completed = this.getCompleted().slice(-5); // Last 5

    const lines: string[] = [];
    if (running.length > 0) {
      lines.push("Running tasks:");
      running.forEach((t) => lines.push(`  🔄 [${t.id}] ${t.name}: ${t.progress || "in progress"}`));
    }
    if (pending.length > 0) {
      lines.push(`Pending: ${pending.length} task(s) in queue`);
    }
    if (completed.length > 0) {
      lines.push("Recent completed:");
      completed.forEach((t) => {
        const icon = t.status === "completed" ? "✅" : "❌";
        const duration = t.completedAt && t.startedAt
          ? `${((t.completedAt.getTime() - t.startedAt.getTime()) / 1000).toFixed(1)}s`
          : "?";
        lines.push(`  ${icon} [${t.id}] ${t.name} (${duration})`);
      });
    }
    return lines.length > 0 ? lines.join("\n") : "No tasks.";
  }
}
