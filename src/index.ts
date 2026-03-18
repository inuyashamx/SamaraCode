import * as readline from "readline";
import { ToolRegistry } from "./tools/registry.js";
import { ToolBuilder } from "./tools/builder.js";
import { registerBuiltinTools } from "./tools/builtin/index.js";
import { ModelRouter } from "./models/router.js";
import { TaskRunner } from "./core/task-runner.js";
import { Orchestrator, OrchestratorConfig } from "./core/orchestrator.js";
import { loadConfig, saveConfig, runSetupWizard, SamaraCodeConfig, getSamaraCodeHome } from "./config/index.js";
import { StatusBar } from "./ui/statusbar.js";
import * as path from "path";

const BANNER = `
╔═══════════════════════════════════════════════╗
║            ⚡ SamaraCode v0.1                ║
║   Self-extending autonomous coding agent      ║
╚═══════════════════════════════════════════════╝
`;

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function formatConfirmation(toolName: string, args: Record<string, any>): string {
  switch (toolName) {
    case "file_write": {
      const p = args.path || "unknown";
      const size = args.content ? `${args.content.length} chars` : "empty";
      return `Write file: ${p} (${size})`;
    }
    case "bash_execute":
      return `Run command: ${(args.command || "").slice(0, 120)}`;
    case "create_tool": {
      const desc = args.description || args.blueprint?.name || "unknown tool";
      const deps = args.blueprint?.dependencies?.join(", ") || "none";
      return `Create tool: "${desc}" (deps: ${deps})`;
    }
    case "spawn_agent":
      return `Spawn agent: "${args.name}" → ${(args.task || "").slice(0, 100)}`;
    case "run_background":
      return `Background: "${args.name}" → ${(args.command || "").slice(0, 100)}`;
    case "git_commit":
      return `Git commit: "${args.message || ""}" (files: ${args.files || "all"})`;
    default:
      return `${toolName}: ${JSON.stringify(args).slice(0, 150)}`;
  }
}

let autoAccept = false;

let statusBarRef: StatusBar | null = null;

async function askConfirmation(rl: readline.Interface, toolName: string, args: Record<string, any>): Promise<boolean> {
  // Self-modification ALWAYS requires explicit confirmation
  const forcedConfirm = toolName.includes("SELF-MODIFY");

  if (autoAccept && !forcedConfirm) {
    console.log(`  ✓ auto: ${formatConfirmation(toolName, args)}`);
    return true;
  }

  statusBarRef?.disable();
  const msg = formatConfirmation(toolName, args);
  const answer = await ask(rl, `\n  ⚠️  ${msg}\n  [y]es / [n]o / [a]ccept all: `);
  statusBarRef?.enable();
  const lower = answer.toLowerCase().trim();

  if (lower === "a" || lower === "accept" || lower === "all") {
    autoAccept = true;
    console.log("  → Auto-accepting all actions for this session.");
    return true;
  }

  return lower.startsWith("y") || lower === "";
}

async function main() {
  console.log(BANNER);

  // Accept working directory as argument: samaracode /path/to/project
  const targetDir = process.argv[2];
  if (targetDir) {
    const resolved = path.resolve(targetDir);
    process.chdir(resolved);
    console.log(`📂 Working directory: ${resolved}`);
  } else {
    console.log(`📂 Working directory: ${process.cwd()}`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Load or run setup (from ~/.samaracode/config.json — global, works from any dir)
  let config = await loadConfig();

  if (!config.setupComplete) {
    config = await runSetupWizard(rl);
    if (!config.setupComplete) {
      console.log("Setup incomplete. Exiting.");
      rl.close();
      process.exit(1);
    }
  } else {
    console.log(`📋 Config loaded from ~/.samaracode/config.json`);
    console.log(`   Providers: ${Object.keys(config.providers).join(", ")}`);
    console.log(`   Autonomy: ${config.autonomyLevel}`);
  }

  // Initialize tools — dynamic tools stored globally in ~/.samaracode/tools/
  const home = getSamaraCodeHome();
  const toolsDir = path.join(home, "tools");
  const registry = new ToolRegistry(toolsDir);
  registerBuiltinTools(registry);

  const builder = new ToolBuilder(registry, toolsDir);
  const dynamicCount = await builder.loadPersistedTools();
  console.log(`📦 ${registry.getAll().length} tools loaded (${dynamicCount} dynamic)`);

  // Initialize model router from config
  const router = new ModelRouter();
  await router.initializeFromConfig(config);

  // Initialize task runner
  const taskRunner = new TaskRunner(config.background.maxConcurrentTasks);

  // Orchestrator
  const orchConfig: OrchestratorConfig = {
    autonomyLevel: config.autonomyLevel,
    maxIterations: 20,
    verbose: true,
    confirmBeforeExec: (name, args) => askConfirmation(rl, name, args),
  };

  const orchestrator = new Orchestrator(registry, builder, router, taskRunner, orchConfig);

  // Status bar — shows running agents/tasks at bottom of terminal
  const statusBar = new StatusBar(taskRunner);
  statusBarRef = statusBar;
  statusBar.start();

  // Background task notifications
  taskRunner.on("task", (event) => {
    if (event.type === "completed") {
      const task = taskRunner.getTask(event.taskId);
      const dur = task?.completedAt && task?.startedAt
        ? `${((task.completedAt.getTime() - task.startedAt.getTime()) / 1000).toFixed(1)}s`
        : "";
      console.log(`\n  ✅ "${task?.name}" completed ${dur ? `(${dur})` : ""}`);
      process.stdout.write("you> ");
    } else if (event.type === "failed") {
      const task = taskRunner.getTask(event.taskId);
      console.log(`\n  ❌ "${task?.name}" failed: ${event.data}`);
      process.stdout.write("you> ");
    }
  });

  console.log(`\nReady. Type your task or question.\n`);
  console.log(`  /tools        List all tools`);
  console.log(`  /tasks        Show background tasks`);
  console.log(`  /test [name]  Run tool tests`);
  console.log(`  /models       Show providers & routing`);
  console.log(`  /auto         Toggle auto-accept all actions`);
  console.log(`  /audit        Show session audit log`);
  console.log(`  /plan         Show current execution plan`);
  console.log(`  /cd [path]    Change working directory`);
  console.log(`  /level N      Set autonomy (0-3)`);
  console.log(`  /setup        Re-run setup wizard`);
  console.log(`  /reset        Clear conversation`);
  console.log(`  /quit         Exit\n`);

  const prompt = () => {
    rl.question("you> ", async (input) => {
      const trimmed = input.trim();
      if (!trimmed) return prompt();

      if (trimmed.startsWith("/")) {
        await handleCommand(trimmed, registry, router, orchestrator, taskRunner, orchConfig, config, rl);
        return prompt();
      }

      try {
        console.log();
        const response = await orchestrator.chat(trimmed);
        console.log(`\n⚡ ${response}\n`);
      } catch (err: any) {
        console.error(`\n  ❌ ${err.message}`);
        console.error(`  Try again or use /reset to clear conversation.\n`);
      }

      prompt();
    });
  };

  prompt();
}

async function handleCommand(
  cmd: string,
  registry: ToolRegistry,
  router: ModelRouter,
  orchestrator: Orchestrator,
  taskRunner: TaskRunner,
  orchConfig: OrchestratorConfig,
  config: SamaraCodeConfig,
  rl: readline.Interface
) {
  const parts = cmd.split(/\s+/);
  const command = parts[0];

  switch (command) {
    case "/tools":
      console.log("\n📦 Tools:");
      for (const tool of registry.getAll()) {
        const badge = tool.builtin ? "builtin " : "⚡dynamic";
        console.log(`  [${badge}] ${tool.name} (${tool.category}) - ${tool.description}`);
      }
      console.log();
      break;

    case "/tasks": {
      console.log("\n📋 Background tasks:");
      const all = taskRunner.getAll();
      if (all.length === 0) {
        console.log("  No tasks.\n");
        break;
      }
      for (const task of all) {
        const icons: Record<string, string> = {
          pending: "⏳",
          running: "🔄",
          completed: "✅",
          failed: "❌",
          cancelled: "🚫",
        };
        const icon = icons[task.status] || "?";
        let info = `  ${icon} [${task.id}] ${task.name} (${task.status})`;
        if (task.progress) info += ` - ${task.progress}`;
        if (task.status === "completed" && task.result) {
          info += ` → ${JSON.stringify(task.result).slice(0, 100)}`;
        }
        if (task.error) info += ` → ERROR: ${task.error}`;
        console.log(info);
      }
      console.log();
      break;
    }

    case "/test": {
      const name = parts[1];
      const tools = name ? [registry.get(name)].filter(Boolean) : registry.getAll();
      console.log(`\n🧪 Testing ${tools.length} tool(s)...`);
      for (const tool of tools) {
        if (!tool || !tool.tests || tool.tests.length === 0) continue;
        const result = await registry.testTool(tool.name);
        const icon = result.failed === 0 ? "✅" : "❌";
        console.log(`  ${icon} ${tool.name}: ${result.passed}/${result.passed + result.failed}`);
        result.errors.forEach((e) => console.log(`     → ${e}`));
      }
      console.log();
      break;
    }

    case "/models": {
      console.log("\n🧠 Providers & Routing:");
      for (const p of router.getAvailableProviders()) {
        console.log(`  ✓ ${p.name}: ${p.models.join(", ")}`);
      }
      console.log(`\n  Routing:`);
      for (const level of ["simple", "moderate", "complex", "expert"] as const) {
        const r = config.routing[level];
        console.log(`    ${level}: ${r.provider}/${r.model}`);
      }
      console.log();
      break;
    }

    case "/level": {
      const level = parseInt(parts[1]) as 0 | 1 | 2 | 3;
      if (isNaN(level) || level < 0 || level > 3) {
        console.log("Usage: /level 0|1|2|3");
        break;
      }
      orchConfig.autonomyLevel = level;
      config.autonomyLevel = level;
      await saveConfig(config);
      const labels = ["confirm all", "confirm risky", "autonomous", "full auto"];
      console.log(`Autonomy → ${level} (${labels[level]})`);
      break;
    }

    case "/setup":
      config = await runSetupWizard(rl);
      break;

    case "/auto":
      autoAccept = !autoAccept;
      console.log(autoAccept ? "  ✓ Auto-accept ON — all actions will be approved automatically." : "  ○ Auto-accept OFF — risky actions will ask for confirmation.");
      break;

    case "/audit": {
      const audit = orchestrator.getAudit();
      console.log(`\n📝 ${audit.getSummary()}`);
      const entries = audit.getEntries().slice(-10);
      for (const e of entries) {
        const icon = e.success === false ? "❌" : "✓";
        console.log(`  ${icon} [${e.timestamp.slice(11, 19)}] ${e.type}: ${e.action}`);
      }
      console.log();
      break;
    }

    case "/plan": {
      const plan = orchestrator.getActivePlan();
      if (!plan) {
        console.log("\nNo active plan.\n");
      } else {
        const planner = new (await import("./core/planner.js")).Planner(router);
        console.log("\n" + planner.formatPlanForDisplay(plan) + "\n");
      }
      break;
    }

    case "/cd": {
      const dir = parts.slice(1).join(" ");
      if (!dir) {
        console.log(`Current: ${process.cwd()}`);
      } else {
        try {
          const resolved = path.resolve(dir);
          process.chdir(resolved);
          console.log(`📂 ${resolved}`);
        } catch (err: any) {
          console.log(`Error: ${err.message}`);
        }
      }
      break;
    }

    case "/reset":
      orchestrator.resetHistory();
      autoAccept = false;
      console.log("Conversation cleared.\n");
      break;

    case "/quit":
    case "/exit":
      statusBarRef?.stop();
      console.log("Bye! ⚡");
      process.exit(0);

    default:
      console.log(`Unknown command: ${command}`);
  }
}

main().catch(console.error);
