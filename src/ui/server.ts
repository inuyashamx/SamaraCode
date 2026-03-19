import * as http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { ToolRegistry } from "../tools/registry.js";
import { ToolBuilder } from "../tools/builder.js";
import { ModelRouter } from "../models/router.js";
import { TaskRunner } from "../core/task-runner.js";
import { Orchestrator, OrchestratorConfig } from "../core/orchestrator.js";
import { getHTML } from "./html.js";

interface WSMessage {
  type: string;
  [key: string]: any;
}

// Store logs per agent for the UI tab view
const agentLogs: Map<string, { name: string; logs: { type: string; text: string; time: string }[] }> = new Map();

export function startServer(
  registry: ToolRegistry,
  builder: ToolBuilder,
  router: ModelRouter,
  taskRunner: TaskRunner,
  port: number = 3777
): { url: string } {
  let autoAccept = false;
  let pendingConfirm: { resolve: (v: boolean) => void } | null = null;
  let activeWs: WebSocket | null = null;

  const confirmFn = async (toolName: string, args: Record<string, any>): Promise<boolean> => {
    const isSelfModify = toolName.includes("SELF-MODIFY");

    if (autoAccept && !isSelfModify) {
      broadcast({ type: "log", entry: { type: "system", text: `✓ auto: ${formatTool(toolName, args)}` } });
      return true;
    }

    broadcast({ type: "confirm", message: formatTool(toolName, args), toolName });

    return new Promise((resolve) => {
      pendingConfirm = { resolve };
    });
  };

  const orchConfig: OrchestratorConfig = {
    autonomyLevel: 1,
    maxIterations: 50,
    verbose: true,
    confirmBeforeExec: confirmFn,
  };

  const orchestrator = new Orchestrator(registry, builder, router, taskRunner, orchConfig);

  // Listen for UI events from orchestrator (previews, etc.)
  orchestrator.on("ui", (event) => {
    broadcast(event);
  });

  // Listen for token usage events
  orchestrator.on("token_update", (entry: any) => {
    const summary = orchestrator.getTokenSummary();
    broadcast({ type: "token_update", entry, summary });
  });

  // Capture console.log for verbose output
  const origLog = console.log;
  console.log = (...args: any[]) => {
    const text = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ").trim();
    if (!text) return;

    let logType = "system";
    if (text.includes("💭")) logType = "thinking";
    else if (text.includes("✓") || text.includes("✗")) logType = "tool";
    else if (text.includes("📄") || text.includes("✎") || text.includes("🔍") || text.includes("$") ||
             text.includes("◆") || text.includes("🔨") || text.includes("⟳") || text.includes("▦") ||
             text.includes("🌐") || text.includes("🔎") || text.includes("⎇") || text.includes("📋") ||
             text.includes("📂")) logType = "tool";
    else if (text.includes("⚠")) logType = "error";

    // Capture model info for the thinking indicator
    const modelMatch = text.match(/⚡\s+(\S+\/\S+)/);
    if (modelMatch) {
      broadcast({ type: "model_active", model: modelMatch[1] });
    }

    broadcast({ type: "log", entry: { type: logType, text } });
  };

  // Task events
  taskRunner.on("task", (event) => {
    broadcast({ type: "tasks", tasks: getTasksInfo() });

    const task = taskRunner.getTask(event.taskId);

    if (event.type === "progress" && task) {
      // Store agent log
      if (!agentLogs.has(event.taskId)) {
        agentLogs.set(event.taskId, { name: task.name, logs: [] });
      }
      agentLogs.get(event.taskId)!.logs.push({
        type: "tool",
        text: event.data || "",
        time: new Date().toISOString(),
      });
      // Broadcast agent log update (for detail panel)
      broadcast({ type: "agent_log", taskId: event.taskId, name: task.name, text: event.data });
      // Also send to main Logs tab with agent name prefix
      broadcast({ type: "log", entry: { type: "tool", text: `[${task.name}] ${event.data || ""}` } });
    }

    if (event.type === "url_detected" && event.data) {
      broadcast({ type: "open_preview", url: event.data.url, name: event.data.name || "Preview" });
      broadcast({ type: "log", entry: { type: "system", text: `🌐 Preview opened: ${event.data.url}` } });
    }

    if (event.type === "completed") {
      const dur = task?.completedAt && task?.startedAt
        ? ((task.completedAt.getTime() - task.startedAt.getTime()) / 1000).toFixed(1)
        : "?";
      // Store final result in agent logs
      if (agentLogs.has(event.taskId)) {
        const output = event.data?.output || event.data?.stdout || "done";
        agentLogs.get(event.taskId)!.logs.push({
          type: "result",
          text: typeof output === "string" ? output.slice(0, 500) : JSON.stringify(output).slice(0, 500),
          time: new Date().toISOString(),
        });
      }
      // Track sub-agent token usage
      const tokenUsage = event.data?.tokenUsage;
      if (tokenUsage && tokenUsage.input_tokens > 0) {
        orchestrator.trackTokens(
          task?.model || "gemini-3.1-flash-lite-preview",
          { input_tokens: tokenUsage.input_tokens, output_tokens: tokenUsage.output_tokens },
          task?.name || "agent"
        );
      }
      broadcast({ type: "log", entry: { type: "system", text: `✅ **${task?.name}** completed (${dur}s)` } });

      // Auto-wake the orchestrator: check if all tasks are done
      checkAndContinue();
    } else if (event.type === "failed") {
      broadcast({ type: "log", entry: { type: "error", text: `❌ **${task?.name}** failed: ${event.data}` } });

      // Also wake on failure
      checkAndContinue();
    }
  });

  let isProcessing = false;
  let continueTimer: ReturnType<typeof setTimeout> | null = null;

  async function checkAndContinue() {
    // Debounce — wait 500ms for other tasks to finish too
    if (continueTimer) clearTimeout(continueTimer);
    continueTimer = setTimeout(async () => {
      // Only check non-process tasks — dev servers are intentionally long-running
      const running = taskRunner.getRunning().filter((t) => t.type !== "process");
      if (running.length > 0) return; // Still have agent/background tasks running
      if (isProcessing) return; // Already processing

      // All tasks done — wake the orchestrator
      isProcessing = true;
      broadcast({ type: "processing", value: true });

      try {
        const response = await orchestrator.chat("[All background tasks have completed. Review the results and continue with the plan. If everything is done, summarize what was accomplished. If there are more steps, spawn new agents.]");
        broadcast({ type: "log", entry: { type: "agent", text: response } });
      } catch (err: any) {
        broadcast({ type: "log", entry: { type: "error", text: `Auto-continue error: ${err.message}` } });
      }

      isProcessing = false;
      broadcast({ type: "processing", value: false });
      broadcast({ type: "tasks", tasks: getTasksInfo() });
    }, 500);
  }

  function getTasksInfo() {
    return taskRunner.getAll()
      .filter((t) => t.status === "running" || t.status === "pending" ||
        (t.completedAt && Date.now() - t.completedAt.getTime() < 30000))
      .map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        type: t.type || "agent",
        provider: t.provider || "",
        model: t.model || "",
        elapsed: t.startedAt ? Math.floor((Date.now() - t.startedAt.getTime()) / 1000) : 0,
      }));
  }

  const manifest = JSON.stringify({
    name: "SamaraCode",
    short_name: "SamaraCode",
    start_url: "/",
    display: "standalone",
    background_color: "#1e1e2e",
    theme_color: "#1e1e2e",
    description: "Self-extending autonomous coding agent",
    icons: [{ src: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>", sizes: "any", type: "image/svg+xml" }],
  });

  // Error capture script injected into proxied HTML
  const ERROR_CAPTURE_SCRIPT = `<script>
(function(){
  var errors = [];
  var send = function() {
    if (errors.length === 0) return;
    var batch = errors.splice(0, 20);
    try { window.parent.postMessage({ type: 'preview-errors', errors: batch }, '*'); } catch(e) {}
  };
  setInterval(send, 2000);

  window.onerror = function(msg, src, line, col) {
    errors.push({ type: 'error', text: msg + ' at ' + (src||'?') + ':' + line + ':' + col });
  };
  window.addEventListener('unhandledrejection', function(e) {
    errors.push({ type: 'error', text: 'Unhandled promise: ' + (e.reason?.message || e.reason || 'unknown') });
  });

  var origError = console.error;
  console.error = function() {
    var msg = Array.prototype.slice.call(arguments).map(function(a) {
      return typeof a === 'string' ? a : (a?.message || JSON.stringify(a));
    }).join(' ');
    errors.push({ type: 'console-error', text: msg });
    origError.apply(console, arguments);
  };

  var origWarn = console.warn;
  console.warn = function() {
    var msg = Array.prototype.slice.call(arguments).map(function(a) {
      return typeof a === 'string' ? a : (a?.message || JSON.stringify(a));
    }).join(' ');
    errors.push({ type: 'console-warn', text: msg });
    origWarn.apply(console, arguments);
  };
})();
</script>`;

  // HTTP server
  const server = http.createServer(async (req, res) => {
    if (req.url === "/manifest.json") {
      res.writeHead(200, { "Content-Type": "application/manifest+json" });
      res.end(manifest);
    } else if (req.url?.startsWith("/proxy/")) {
      // Proxy endpoint: /proxy/http://localhost:5173/path
      const targetUrl = req.url.slice(7);
      try {
        const proxyRes = await fetch(targetUrl, {
          headers: { "Accept": req.headers.accept || "*/*" },
        });
        const contentType = proxyRes.headers.get("content-type") || "";
        let body: string | Buffer;

        if (contentType.includes("text/html")) {
          // Inject error capture script into HTML
          let html = await proxyRes.text();
          html = html.replace("</head>", ERROR_CAPTURE_SCRIPT + "</head>");
          body = html;
        } else {
          body = Buffer.from(await proxyRes.arrayBuffer());
        }

        // Forward important headers
        const headers: Record<string, string> = { "Content-Type": contentType };
        const cacheControl = proxyRes.headers.get("cache-control");
        if (cacheControl) headers["Cache-Control"] = cacheControl;

        res.writeHead(proxyRes.status, headers);
        res.end(body);
      } catch (err: any) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end(`Proxy error: ${err.message}`);
      }
    } else {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getHTML());
    }
  });

  // WebSocket
  const wss = new WebSocketServer({ server });

  function broadcast(msg: WSMessage) {
    const data = JSON.stringify(msg);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
  }

  wss.on("connection", (ws) => {
    activeWs = ws;

    // Send initial state
    ws.send(JSON.stringify({
      type: "init",
      tools: registry.getAll().map((t) => ({ name: t.name, category: t.category, builtin: t.builtin })),
      providers: router.getAvailableProviders().map((p) => ({ name: p.name, models: p.models })),
      cwd: process.cwd(),
      autoAccept,
    }));

    ws.on("message", async (raw) => {
      try {
        const msg: WSMessage = JSON.parse(raw.toString());

        switch (msg.type) {
          case "chat": {
            // Cancel any pending auto-continue — user is talking
            if (continueTimer) { clearTimeout(continueTimer); continueTimer = null; }

            broadcast({ type: "log", entry: { type: "user", text: msg.text } });
            broadcast({ type: "processing", value: true });
            isProcessing = true;

            try {
              const response = await orchestrator.chat(msg.text);
              broadcast({ type: "log", entry: { type: "agent", text: response } });
            } catch (err: any) {
              broadcast({ type: "log", entry: { type: "error", text: `Error: ${err.message}` } });
            }

            isProcessing = false;
            broadcast({ type: "processing", value: false });
            broadcast({ type: "tasks", tasks: getTasksInfo() });
            break;
          }

          case "confirm_response": {
            if (pendingConfirm) {
              const { resolve } = pendingConfirm;
              pendingConfirm = null;

              if (msg.action === "accept_all") {
                autoAccept = true;
                broadcast({ type: "autoAccept", value: true });
                resolve(true);
              } else {
                resolve(msg.accepted);
              }

              broadcast({ type: "log", entry: { type: "system", text: msg.accepted || msg.action === "accept_all" ? "✓ approved" : "✗ denied" } });
            }
            break;
          }

          case "command": {
            handleCommand(msg.cmd, orchestrator, registry, router, taskRunner, broadcast, autoAccept, (v) => { autoAccept = v; });
            break;
          }

          case "get_agent_logs": {
            const logs = agentLogs.get(msg.taskId);
            // Also include process output if it's a process
            const processOutput = taskRunner.getProcessOutput(msg.taskId);
            const allLogs = logs?.logs || [];
            if (processOutput.length > 0) {
              for (const line of processOutput) {
                allLogs.push({ type: "tool", text: line, time: "" });
              }
            }
            ws.send(JSON.stringify({ type: "agent_logs", taskId: msg.taskId, name: logs?.name || taskRunner.getTask(msg.taskId)?.name || "?", logs: allLogs }));
            break;
          }

          case "preview_error": {
            const err = msg.error;
            broadcast({ type: "log", entry: { type: "error", text: `🐛 [Preview] ${err.type}: ${err.text}` } });
            // Push to orchestrator's error buffer
            orchestrator.pushPreviewError(err.text);
            break;
          }

          case "kill_task": {
            const killed = taskRunner.cancel(msg.taskId);
            const taskName = taskRunner.getTask(msg.taskId)?.name || msg.taskId;
            if (killed) {
              broadcast({ type: "log", entry: { type: "system", text: `🛑 Process "${taskName}" killed.` } });
            } else {
              broadcast({ type: "log", entry: { type: "error", text: `Could not kill "${taskName}".` } });
            }
            broadcast({ type: "tasks", tasks: getTasksInfo() });
            break;
          }
        }
      } catch (err: any) {
        broadcast({ type: "log", entry: { type: "error", text: `WS Error: ${err.message}` } });
      }
    });
  });

  server.listen(port);
  const url = `http://localhost:${port}`;
  return { url };
}

function formatTool(name: string, args: Record<string, any>): string {
  switch (name) {
    case "file_edit": {
      const lines: string[] = [`Edit: ${args.path}`];
      if (args.remove) {
        lines.push(`─── Remove ───`);
        for (const line of args.remove.split("\n").slice(0, 20)) {
          lines.push(`- ${line}`);
        }
      }
      if (args.add) {
        lines.push(`─── Add ───`);
        for (const line of args.add.split("\n").slice(0, 20)) {
          lines.push(`+ ${line}`);
        }
      }
      if (args.description) lines.push(args.description);
      return lines.join("\n");
    }
    case "file_write": return `Write: ${args.path} (${args.content?.length || 0} chars)`;
    case "bash_execute": return `Run: ${(args.command || "").slice(0, 120)}`;
    case "create_tool": return `Create tool: ${args.blueprint?.name || args.name || "?"}`;
    case "spawn_agent": return `Spawn agent: "${args.name}"`;
    case "run_background": return `Background: ${args.name}`;
    case "git_commit": return `Commit: "${args.message || ""}"`;
    case "⚡ SELF-MODIFY": return `⚡ SELF-MODIFY: ${args.description || ""}`;
    default: return `${name}: ${JSON.stringify(args).slice(0, 100)}`;
  }
}

function handleCommand(
  cmd: string,
  orchestrator: Orchestrator,
  registry: ToolRegistry,
  router: ModelRouter,
  taskRunner: TaskRunner,
  broadcast: (msg: WSMessage) => void,
  autoAccept: boolean,
  setAutoAccept: (v: boolean) => void,
) {
  const parts = cmd.split(/\s+/);
  switch (parts[0]) {
    case "/tools":
      const tools = registry.getAll().map((t) => `${t.builtin ? "●" : "⚡"} ${t.name} (${t.category})`);
      broadcast({ type: "log", entry: { type: "system", text: tools.join("\n") } });
      break;
    case "/tasks":
      broadcast({ type: "tasks", tasks: taskRunner.getAll().map((t) => ({ id: t.id, name: t.name, status: t.status, elapsed: 0 })) });
      break;
    case "/auto":
      setAutoAccept(!autoAccept);
      broadcast({ type: "autoAccept", value: !autoAccept });
      broadcast({ type: "log", entry: { type: "system", text: `Auto-accept: ${!autoAccept ? "ON" : "OFF"}` } });
      break;
    case "/reset":
      orchestrator.resetHistory();
      broadcast({ type: "log", entry: { type: "system", text: "Conversation cleared." } });
      break;
    case "/models":
      const providers = router.getAvailableProviders().map((p) => `✓ ${p.name}: ${p.models.join(", ")}`);
      broadcast({ type: "log", entry: { type: "system", text: providers.join("\n") } });
      break;
    default:
      broadcast({ type: "log", entry: { type: "error", text: `Unknown: ${parts[0]}` } });
  }
}
