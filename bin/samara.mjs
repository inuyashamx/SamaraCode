#!/usr/bin/env node

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { existsSync } from "fs";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Prefer compiled dist if it exists (production / global install)
const distEntry = resolve(root, "dist", "main.js");
const srcEntry = resolve(root, "src", "main.tsx");

if (existsSync(distEntry)) {
  // Production: run compiled JS directly
  const result = spawnSync(process.execPath, [distEntry, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  process.exit(result.status || 0);
} else {
  // Development: use tsx to run TypeScript source
  const tsx = resolve(root, "node_modules", ".bin", "tsx");
  const result = spawnSync(tsx, [srcEntry, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: process.cwd(),
    shell: true,
  });
  process.exit(result.status || 0);
}
