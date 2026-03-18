import * as path from "path";
import { exec } from "child_process";
import { ToolRegistry } from "./tools/registry.js";
import { ToolBuilder } from "./tools/builder.js";
import { registerBuiltinTools } from "./tools/builtin/index.js";
import { ModelRouter } from "./models/router.js";
import { TaskRunner } from "./core/task-runner.js";
import { loadConfig, runSetupWizard, getSamaraCodeHome } from "./config/index.js";
import { startServer } from "./ui/server.js";
import * as readline from "readline";

function openBrowser(url: string) {
  const platform = process.platform;

  // Try to open as standalone app window (no URL bar)
  const browsers = platform === "win32"
    ? [
        // Edge app mode
        `start msedge --app=${url} --new-window`,
        // Chrome app mode
        `start chrome --app=${url} --new-window`,
        // Fallback
        `start ${url}`,
      ]
    : platform === "darwin"
    ? [
        `open -na "Google Chrome" --args --app=${url}`,
        `open ${url}`,
      ]
    : [
        `google-chrome --app=${url}`,
        `chromium-browser --app=${url}`,
        `xdg-open ${url}`,
      ];

  // Try each browser until one works
  function tryNext(i: number) {
    if (i >= browsers.length) return;
    exec(browsers[i], (err) => {
      if (err) tryNext(i + 1);
    });
  }
  tryNext(0);
}

async function main() {
  // Accept working directory as argument
  const targetDir = process.argv[2];
  if (targetDir) {
    process.chdir(path.resolve(targetDir));
  }

  console.log("⚡ SamaraCode v0.1");
  console.log(`📂 ${process.cwd()}`);

  // Load config
  let config = await loadConfig();

  // If no setup, run wizard
  if (!config.setupComplete) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    config = await runSetupWizard(rl);
    rl.close();
    if (!config.setupComplete) {
      console.log("Setup incomplete. Exiting.");
      process.exit(1);
    }
  }

  // Initialize tools
  const home = getSamaraCodeHome();
  const toolsDir = path.join(home, "tools");
  const registry = new ToolRegistry(toolsDir);
  registerBuiltinTools(registry);

  const builder = new ToolBuilder(registry, toolsDir);
  const dynamicCount = await builder.loadPersistedTools();
  console.log(`📦 ${registry.getAll().length} tools (${dynamicCount} dynamic)`);

  // Initialize model router
  const router = new ModelRouter();
  await router.initializeFromConfig(config);

  // Task runner
  const taskRunner = new TaskRunner(config.background.maxConcurrentTasks);

  // Start web server
  const port = parseInt(process.env.SAMARACODE_PORT || "3777");
  const { url } = startServer(registry, builder, router, taskRunner, port);

  console.log(`\n⚡ SamaraCode running at ${url}`);
  console.log(`  Press Ctrl+C to stop.\n`);

  // Open browser
  openBrowser(url);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
