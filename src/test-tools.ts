import { ToolRegistry } from "./tools/registry.js";
import { registerBuiltinTools } from "./tools/builtin/index.js";

async function main() {
  console.log("🧪 SamaraCode - Tool Test Suite\n");

  const registry = new ToolRegistry("data/tools");
  registerBuiltinTools(registry);

  console.log(`Loaded ${registry.getAll().length} tools\n`);

  // Test each tool
  for (const tool of registry.getAll()) {
    console.log(`━━━ ${tool.name} (${tool.category}) ━━━`);
    console.log(`  ${tool.description}`);

    if (!tool.tests || tool.tests.length === 0) {
      console.log(`  ⚠ No tests defined\n`);
      continue;
    }

    const result = await registry.testTool(tool.name);
    if (result.failed === 0) {
      console.log(`  ✅ ${result.passed} test(s) passed\n`);
    } else {
      console.log(`  ❌ ${result.passed} passed, ${result.failed} failed`);
      result.errors.forEach((e) => console.log(`     → ${e}`));
      console.log();
    }
  }

  // Quick manual tests
  console.log("━━━ Manual Integration Tests ━━━\n");

  // Test file write + read
  console.log("  Testing file_write → file_read cycle...");
  const writeResult = await registry.execute("file_write", {
    path: "data/test-output.txt",
    content: "Hello from SamaraCode! " + new Date().toISOString(),
  });
  console.log(`  Write: ${writeResult.success ? "✅" : "❌"}`);

  const readResult = await registry.execute("file_read", { path: "data/test-output.txt" });
  console.log(`  Read: ${readResult.success && readResult.data?.includes("Hello") ? "✅" : "❌"}`);

  // Test dir_list
  console.log("  Testing dir_list...");
  const dirResult = await registry.execute("dir_list", { path: "src" });
  console.log(`  Dir: ${dirResult.success ? "✅" : "❌"} (${dirResult.data?.length} entries)`);

  // Test grep
  console.log("  Testing grep_search...");
  const grepResult = await registry.execute("grep_search", { pattern: "export", path: "src", include: "*.ts" });
  console.log(`  Grep: ${grepResult.success ? "✅" : "❌"} (${grepResult.data?.count} matches)`);

  // Test bash
  console.log("  Testing bash_execute...");
  const bashResult = await registry.execute("bash_execute", { command: "echo SamaraCode && node --version" });
  console.log(`  Bash: ${bashResult.success ? "✅" : "❌"} (${bashResult.data?.stdout})`);

  // Test memory
  console.log("  Testing memory_save → memory_load cycle...");
  await registry.execute("memory_save", {
    key: "test-memory",
    content: "This is a test memory entry",
    tags: ["test"],
  });
  const memResult = await registry.execute("memory_load", { key: "test-memory" });
  console.log(`  Memory: ${memResult.success && memResult.data?.content?.includes("test") ? "✅" : "❌"}`);

  console.log("\n✨ Test suite complete!");
}

main().catch(console.error);
