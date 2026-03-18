import { Tool, ToolResult } from "./types.js";
import * as fs from "fs/promises";
import * as path from "path";

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private dynamicToolsDir: string;

  constructor(dynamicToolsDir: string) {
    this.dynamicToolsDir = dynamicToolsDir;
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  getByCategory(category: string): Tool[] {
    return this.getAll().filter((t) => t.category === category);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  // Execute a tool by name
  async execute(name: string, params: Record<string, any>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool "${name}" not found` };
    }

    try {
      const result = await tool.execute(params);
      return result;
    } catch (err: any) {
      return { success: false, error: `Tool execution error: ${err.message}` };
    }
  }

  // Run all tests for a tool
  async testTool(name: string): Promise<{ passed: number; failed: number; errors: string[] }> {
    const tool = this.tools.get(name);
    if (!tool) return { passed: 0, failed: 0, errors: [`Tool "${name}" not found`] };
    if (!tool.tests || tool.tests.length === 0) {
      return { passed: 0, failed: 0, errors: ["No tests defined"] };
    }

    let passed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const test of tool.tests) {
      try {
        const result = await tool.execute(test.input);
        if (test.validate(result)) {
          passed++;
        } else {
          failed++;
          errors.push(`Test "${test.name}" failed validation`);
        }
      } catch (err: any) {
        failed++;
        errors.push(`Test "${test.name}" threw: ${err.message}`);
      }
    }

    return { passed, failed, errors };
  }

  // Save dynamic tool metadata to disk
  async saveDynamicTool(tool: Tool, sourceCode: string): Promise<void> {
    const toolDir = path.join(this.dynamicToolsDir, tool.name);
    await fs.mkdir(toolDir, { recursive: true });

    // Save metadata
    await fs.writeFile(
      path.join(toolDir, "meta.json"),
      JSON.stringify(
        {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          category: tool.category,
          createdAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    // Save source code
    await fs.writeFile(path.join(toolDir, "tool.ts"), sourceCode);
  }

  // List summary for LLM context
  listForLLM(): string {
    const tools = this.getAll();
    if (tools.length === 0) return "No tools available.";

    return tools
      .map((t) => {
        const params = t.parameters.map((p) => `${p.name}(${p.type}${p.required ? ",required" : ""})`).join(", ");
        return `- ${t.name}: ${t.description} [${params}]`;
      })
      .join("\n");
  }
}
