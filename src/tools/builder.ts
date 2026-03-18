import { Tool, ToolParameter, ToolResult, ToolTest } from "./types.js";
import { ToolRegistry } from "./registry.js";
import * as fs from "fs/promises";
import * as path from "path";

// Blueprint: what the LLM proposes before creating a tool
export interface ToolBlueprint {
  name: string;
  description: string;
  category: string;
  parameters: ToolParameter[];
  dependencies: string[]; // npm packages needed
  code: string; // The execute function body
  testCases: {
    name: string;
    input: Record<string, any>;
    expectSuccess: boolean;
    validateSnippet?: string; // JS expression that returns boolean
  }[];
}

export class ToolBuilder {
  private registry: ToolRegistry;
  private toolsDir: string;

  constructor(registry: ToolRegistry, toolsDir: string = "data/tools") {
    this.toolsDir = path.resolve(toolsDir);
    this.registry = registry;
  }

  // Install npm dependencies needed by a tool
  async installDependencies(deps: string[]): Promise<{ success: boolean; error?: string }> {
    if (deps.length === 0) return { success: true };

    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    try {
      const cmd = `npm install ${deps.join(" ")}`;
      console.log(`  [builder] Installing: ${cmd}`);
      const { stdout, stderr } = await execAsync(cmd, { cwd: process.cwd(), timeout: 60000 });
      if (stderr && stderr.includes("ERR!")) {
        return { success: false, error: stderr };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // Build a Tool from a blueprint
  async buildFromBlueprint(blueprint: ToolBlueprint): Promise<{
    success: boolean;
    tool?: Tool;
    error?: string;
    testResults?: { passed: number; failed: number; errors: string[] };
  }> {
    console.log(`\n🔨 Building tool: ${blueprint.name || "unnamed"}`);

    // Ensure arrays exist
    blueprint.dependencies = blueprint.dependencies || [];
    blueprint.parameters = blueprint.parameters || [];
    blueprint.testCases = blueprint.testCases || [];

    // Step 1: Install dependencies
    if (blueprint.dependencies.length > 0) {
      const depResult = await this.installDependencies(blueprint.dependencies);
      if (!depResult.success) {
        return { success: false, error: `Failed to install dependencies: ${depResult.error}` };
      }
      console.log(`  ✓ Dependencies installed`);
    }

    // Step 2: Create the execute function
    let executeFn: (params: Record<string, any>) => Promise<ToolResult>;
    try {
      // Wrap the code in an async function
      // The code has access to params and should return a ToolResult
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const wrappedCode = `
        const fs = await import("fs/promises");
        const path = await import("path");
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);
        try {
          ${blueprint.code}
        } catch (err) {
          return { success: false, error: err.message };
        }
      `;
      executeFn = new AsyncFunction("params", wrappedCode) as any;
      console.log(`  ✓ Function compiled`);
    } catch (err: any) {
      return { success: false, error: `Failed to compile tool code: ${err.message}` };
    }

    // Step 3: Build test functions
    const tests: ToolTest[] = blueprint.testCases.map((tc) => ({
      name: tc.name,
      input: tc.input,
      validate: (result: ToolResult) => {
        if (tc.expectSuccess && !result.success) return false;
        if (!tc.expectSuccess && result.success) return false;
        if (tc.validateSnippet) {
          try {
            const fn = new Function("result", `return ${tc.validateSnippet}`);
            return fn(result);
          } catch {
            return false;
          }
        }
        return true;
      },
    }));

    // Step 4: Assemble the tool
    const tool: Tool = {
      name: blueprint.name,
      description: blueprint.description,
      category: blueprint.category,
      builtin: false,
      parameters: blueprint.parameters,
      execute: executeFn,
      tests,
      createdAt: new Date(),
    };

    // Step 5: Run tests
    console.log(`  🧪 Running ${tests.length} test(s)...`);
    let passed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const test of tests) {
      try {
        const result = await executeFn(test.input);
        if (test.validate(result)) {
          passed++;
          console.log(`    ✓ ${test.name}`);
        } else {
          failed++;
          const msg = `Test "${test.name}" failed validation (got: ${JSON.stringify(result).slice(0, 100)})`;
          errors.push(msg);
          console.log(`    ✗ ${test.name}`);
        }
      } catch (err: any) {
        failed++;
        errors.push(`Test "${test.name}" threw: ${err.message}`);
        console.log(`    ✗ ${test.name}: ${err.message}`);
      }
    }

    const testResults = { passed, failed, errors };

    if (failed > 0) {
      return {
        success: false,
        tool,
        error: `Tool built but ${failed} test(s) failed`,
        testResults,
      };
    }

    // Step 6: Register and persist
    this.registry.register(tool);
    await this.persistTool(blueprint);
    console.log(`  ✅ Tool "${blueprint.name}" built, tested, and registered!`);

    return { success: true, tool, testResults };
  }

  // Save tool to disk for future sessions
  private async persistTool(blueprint: ToolBlueprint): Promise<void> {
    const toolDir = path.join(this.toolsDir, blueprint.name);
    await fs.mkdir(toolDir, { recursive: true });

    await fs.writeFile(
      path.join(toolDir, "blueprint.json"),
      JSON.stringify(blueprint, null, 2)
    );
  }

  // Load all persisted tools from disk
  async loadPersistedTools(): Promise<number> {
    let loaded = 0;
    try {
      const entries = await fs.readdir(this.toolsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const bpPath = path.join(this.toolsDir, entry.name, "blueprint.json");
          const raw = await fs.readFile(bpPath, "utf-8");
          const blueprint: ToolBlueprint = JSON.parse(raw);

          // Rebuild without running tests (already validated)
          const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
          const wrappedCode = `
            const fs = await import("fs/promises");
            const path = await import("path");
            const { exec } = await import("child_process");
            const { promisify } = await import("util");
            const execAsync = promisify(exec);
            try {
              ${blueprint.code}
            } catch (err) {
              return { success: false, error: err.message };
            }
          `;
          const executeFn = new AsyncFunction("params", wrappedCode);

          const tool: Tool = {
            name: blueprint.name,
            description: blueprint.description,
            category: blueprint.category,
            builtin: false,
            parameters: blueprint.parameters,
            execute: executeFn as any,
            tests: [],
            createdAt: new Date(),
          };

          this.registry.register(tool);
          loaded++;
        } catch {
          // Skip broken tools
        }
      }
    } catch {
      // No tools dir yet
    }
    return loaded;
  }

  // Generate the JSON that the LLM should produce to propose a tool
  static getBlueprintSchema(): string {
    return `{
  "name": "tool_name_snake_case",
  "description": "What this tool does",
  "category": "filesystem|web|data|system|custom",
  "parameters": [
    { "name": "param_name", "type": "string|number|boolean|object|array", "description": "...", "required": true }
  ],
  "dependencies": ["npm-package-name"],
  "code": "// JS code. Has access to 'params' object, fs, path, exec. Must return { success: boolean, data?: any, error?: string }",
  "testCases": [
    { "name": "test name", "input": { "param": "value" }, "expectSuccess": true, "validateSnippet": "result.data !== undefined" }
  ]
}`;
  }
}
