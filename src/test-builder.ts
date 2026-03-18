import { ToolRegistry } from "./tools/registry.js";
import { ToolBuilder, ToolBlueprint } from "./tools/builder.js";
import { registerBuiltinTools } from "./tools/builtin/index.js";

async function main() {
  console.log("🔨 SamaraCode - Tool Builder Test\n");

  const registry = new ToolRegistry("data/tools");
  registerBuiltinTools(registry);
  const builder = new ToolBuilder(registry, "data/tools");

  console.log(`Tools before: ${registry.getAll().length}\n`);

  // Test 1: Create a simple tool (no dependencies)
  console.log("━━━ Test 1: Create a string manipulation tool ━━━");
  const blueprint1: ToolBlueprint = {
    name: "string_reverse",
    description: "Reverse a string",
    category: "text",
    parameters: [
      { name: "text", type: "string", description: "Text to reverse", required: true },
    ],
    dependencies: [],
    code: `
      const reversed = params.text.split("").reverse().join("");
      return { success: true, data: reversed };
    `,
    testCases: [
      {
        name: "reverse hello",
        input: { text: "hello" },
        expectSuccess: true,
        validateSnippet: 'result.data === "olleh"',
      },
      {
        name: "reverse empty",
        input: { text: "" },
        expectSuccess: true,
        validateSnippet: 'result.data === ""',
      },
    ],
  };

  const result1 = await builder.buildFromBlueprint(blueprint1);
  console.log(`Result: ${result1.success ? "✅" : "❌"} ${result1.error || ""}\n`);

  // Test 2: Create a tool that uses fs (file system)
  console.log("━━━ Test 2: Create a file stats tool ━━━");
  const blueprint2: ToolBlueprint = {
    name: "file_stats",
    description: "Get file size and modification date",
    category: "filesystem",
    parameters: [
      { name: "path", type: "string", description: "Path to file", required: true },
    ],
    dependencies: [],
    code: `
      const filePath = path.resolve(params.path);
      const stat = await fs.stat(filePath);
      return {
        success: true,
        data: {
          size: stat.size,
          modified: stat.mtime.toISOString(),
          isFile: stat.isFile(),
          isDirectory: stat.isDirectory(),
        }
      };
    `,
    testCases: [
      {
        name: "stat package.json",
        input: { path: "package.json" },
        expectSuccess: true,
        validateSnippet: "result.data.size > 0 && result.data.isFile === true",
      },
    ],
  };

  const result2 = await builder.buildFromBlueprint(blueprint2);
  console.log(`Result: ${result2.success ? "✅" : "❌"} ${result2.error || ""}\n`);

  // Test 3: Create a tool with intentional test failure
  console.log("━━━ Test 3: Tool with failing test (should fail gracefully) ━━━");
  const blueprint3: ToolBlueprint = {
    name: "always_fail",
    description: "This tool intentionally fails for testing",
    category: "test",
    parameters: [],
    dependencies: [],
    code: `return { success: true, data: "actual" };`,
    testCases: [
      {
        name: "should fail",
        input: {},
        expectSuccess: true,
        validateSnippet: 'result.data === "expected"', // Wrong expectation
      },
    ],
  };

  const result3 = await builder.buildFromBlueprint(blueprint3);
  console.log(`Result: ${result3.success ? "❌ Should have failed!" : "✅ Correctly rejected"}\n`);

  // Verify tools are registered
  console.log(`━━━ Final state ━━━`);
  console.log(`Tools after: ${registry.getAll().length}`);
  console.log(`Dynamic tools:`);
  for (const tool of registry.getAll()) {
    if (!tool.builtin) {
      console.log(`  ⚡ ${tool.name} (${tool.category})`);
    }
  }

  // Test using the created tool
  console.log(`\n━━━ Using created tools ━━━`);
  const reverseResult = await registry.execute("string_reverse", { text: "SamaraCode" });
  console.log(`string_reverse("SamaraCode") = ${reverseResult.data}`);

  const statsResult = await registry.execute("file_stats", { path: "package.json" });
  console.log(`file_stats("package.json") = ${JSON.stringify(statsResult.data)}`);

  // Test persistence: reload from disk
  console.log(`\n━━━ Persistence test ━━━`);
  const registry2 = new ToolRegistry("data/tools");
  const builder2 = new ToolBuilder(registry2, "data/tools");
  const loaded = await builder2.loadPersistedTools();
  console.log(`Loaded ${loaded} tool(s) from disk`);

  if (loaded > 0) {
    const r = await registry2.execute("string_reverse", { text: "test" });
    console.log(`Persisted string_reverse("test") = ${r.data}`);
    console.log("✅ Persistence works!");
  }

  console.log("\n✨ Builder test complete!");
}

main().catch(console.error);
