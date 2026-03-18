import { Tool, ToolResult } from "../types.js";

export const webSearchTool: Tool = {
  name: "web_search",
  description: "Search the web using DuckDuckGo. Returns search results with titles, URLs, and snippets.",
  category: "web",
  builtin: true,
  parameters: [
    { name: "query", type: "string", description: "Search query", required: true },
    { name: "max_results", type: "number", description: "Max results to return (default: 5)", required: false, default: 5 },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const query = encodeURIComponent(params.query);
      // Use DuckDuckGo HTML version for simplicity
      const url = `https://html.duckduckgo.com/html/?q=${query}`;

      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      const html = await response.text();

      // Parse results from HTML
      const results: { title: string; url: string; snippet: string }[] = [];
      const resultRegex = /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>(.*?)<\/a>/g;

      let match;
      const max = params.max_results || 5;
      while ((match = resultRegex.exec(html)) !== null && results.length < max) {
        results.push({
          url: match[1].replace(/&amp;/g, "&"),
          title: match[2].replace(/<\/?b>/g, "").trim(),
          snippet: match[3].replace(/<\/?b>/g, "").trim(),
        });
      }

      // Fallback: try simpler regex if first didn't match
      if (results.length === 0) {
        const simpleRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*(?:<b>[^<]*<\/b>[^<]*)*)<\/a>/g;
        while ((match = simpleRegex.exec(html)) !== null && results.length < max) {
          results.push({
            url: match[1].replace(/&amp;/g, "&"),
            title: match[2].replace(/<\/?b>/g, "").trim(),
            snippet: "",
          });
        }
      }

      return {
        success: true,
        data: {
          query: params.query,
          results,
          count: results.length,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
  tests: [
    {
      name: "search typescript",
      input: { query: "typescript programming language" },
      validate: (r) => r.success && r.data.results.length > 0,
    },
  ],
};
