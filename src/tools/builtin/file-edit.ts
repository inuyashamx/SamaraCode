import { Tool, ToolResult } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";

function stripLineNumbers(text: string): string {
  // Strip line number prefixes from file_read output (e.g. "867: <paper-input" → "<paper-input")
  return text.replace(/^\d+:\s?/gm, "");
}

function fixEscapedQuotes(text: string, filePath: string): string {
  const codeExts = [".tsx", ".ts", ".jsx", ".js", ".html", ".css", ".json", ".vue", ".svelte"];
  if (codeExts.some((ext) => filePath.endsWith(ext))) {
    return text.replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return text;
}

export const fileEditTool: Tool = {
  name: "file_edit",
  description: `Edit a file. Two modes:
1) LINE MODE (recommended): Provide start_line + new_string to replace lines from start_line to end_line (or insert after start_line if insert_after=true).
2) STRING MODE: Provide old_string + new_string to find-and-replace exact text.
Line mode is more reliable for large files. Always use file_read first to see the current content.`,
  category: "filesystem",
  builtin: true,
  parameters: [
    { name: "path", type: "string", description: "Path to the file", required: true },
    { name: "new_string", type: "string", description: "The new text to insert or replace with", required: true },
    { name: "old_string", type: "string", description: "For string mode: exact text to find and replace", required: false },
    { name: "start_line", type: "number", description: "For line mode: start line number (1-based)", required: false },
    { name: "end_line", type: "number", description: "For line mode: end line number (inclusive). If omitted, only start_line is replaced", required: false },
    { name: "insert_after", type: "boolean", description: "If true with start_line, INSERT new_string after that line instead of replacing", required: false },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const filePath = path.resolve(params.path);
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");
      let fixedNew = fixEscapedQuotes(params.new_string, filePath);

      // LINE MODE: start_line is provided
      if (params.start_line && params.start_line > 0) {
        const start = params.start_line;
        const newLines = fixedNew.split("\n");

        if (start > lines.length) {
          return { success: false, error: `start_line ${start} exceeds file length (${lines.length} lines)` };
        }

        if (params.end_line && params.end_line > 0) {
          // REPLACE mode: both start_line and end_line given — replace that range
          const end = Math.min(params.end_line, lines.length);
          const removed = end - start + 1;
          lines.splice(start - 1, removed, ...newLines);
          await fs.writeFile(filePath, lines.join("\n"), "utf-8");
          return {
            success: true,
            data: `Replaced lines ${start}-${end} (${removed} lines) with ${newLines.length} lines in ${filePath}`,
          };
        }

        // INSERT mode: only start_line given (or insert_after=true) — insert after that line
        lines.splice(start, 0, ...newLines);
        await fs.writeFile(filePath, lines.join("\n"), "utf-8");
        return {
          success: true,
          data: `Inserted ${newLines.length} lines after line ${start} in ${filePath}`,
        };
      }

      // STRING MODE: old_string is provided
      let oldStr = params.old_string || "";
      if (!oldStr) {
        return { success: false, error: "Provide either old_string (string mode) or start_line (line mode)" };
      }

      // Auto-strip line number prefixes that LLMs copy from file_read output
      const strippedOld = stripLineNumbers(oldStr);

      // Try matching: first raw, then stripped
      let matchStr = oldStr;
      let occurrences = content.split(oldStr).length - 1;

      if (occurrences === 0 && strippedOld !== oldStr) {
        occurrences = content.split(strippedOld).length - 1;
        if (occurrences > 0) matchStr = strippedOld;
      }

      // Also try with fixed escaped quotes on old_string
      if (occurrences === 0) {
        const fixedOld = fixEscapedQuotes(oldStr, filePath);
        if (fixedOld !== oldStr) {
          occurrences = content.split(fixedOld).length - 1;
          if (occurrences > 0) matchStr = fixedOld;
        }
      }

      if (occurrences === 0) {
        const firstWords = (strippedOld || oldStr).trim().split("\n")[0].trim().slice(0, 50);
        const nearIdx = lines.findIndex((l) => l.includes(firstWords));
        const hint = nearIdx >= 0
          ? ` Nearest match at line ${nearIdx + 1}. TIP: Use start_line=${nearIdx + 1} with end_line instead of old_string for more reliable editing.`
          : "";
        return {
          success: false,
          error: `old_string not found in file.${hint}`,
        };
      }

      if (occurrences > 1) {
        return {
          success: false,
          error: `old_string found ${occurrences} times. Use start_line/end_line for precision, or add more context.`,
        };
      }

      const newContent = content.replace(matchStr, fixedNew);
      await fs.writeFile(filePath, newContent, "utf-8");

      const oldLineCount = matchStr.split("\n").length;
      const newLineCount = fixedNew.split("\n").length;
      return {
        success: true,
        data: `Replaced ${oldLineCount} lines with ${newLineCount} lines in ${filePath}`,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
  tests: [
    {
      name: "edit file",
      input: { path: "/tmp/samaracode-test-edit.txt", old_string: "hello", new_string: "world" },
      validate: (r) => r.success === true || (r.error ? r.error.includes("not found") : false),
    },
  ],
};
