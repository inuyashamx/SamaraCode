import { Tool, ToolResult } from "../types.js";

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<\/?b>/g, "")
    .replace(/<\/?[^>]+>/g, "")
    .trim();
}

export const webSearchTool: Tool = {
  name: "web_search",
  description: "Search the web using DuckDuckGo. Returns search results with titles, URLs, and snippets.",
  category: "web",
  builtin: true,
  parameters: [
    { name: "query", type: "string", description: "Search query", required: true },
    { name: "max_results", type: "number", description: "Max results to return (default: 8)", required: false, default: 8 },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const query = encodeURIComponent(params.query);
      const max = params.max_results || 8;
      const url = `https://html.duckduckgo.com/html/?q=${query}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);

      let response;
      try {
        response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html",
            "Accept-Language": "en-US,en;q=0.9",
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        return { success: false, error: `DuckDuckGo returned HTTP ${response.status}` };
      }

      const html = await response.text();
      const results: { title: string; url: string; snippet: string }[] = [];

      // Primary pattern: full result with snippet
      const resultRegex = /<a rel="nofollow"[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      let match;
      while ((match = resultRegex.exec(html)) !== null && results.length < max) {
        const resultUrl = decodeHtmlEntities(match[1]);
        if (resultUrl.includes("duckduckgo.com")) continue; // Skip DDG internal links
        results.push({
          url: resultUrl,
          title: decodeHtmlEntities(match[2]),
          snippet: decodeHtmlEntities(match[3]),
        });
      }

      // Fallback: simpler pattern without snippet
      if (results.length === 0) {
        const simpleRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
        while ((match = simpleRegex.exec(html)) !== null && results.length < max) {
          const resultUrl = decodeHtmlEntities(match[1]);
          if (resultUrl.includes("duckduckgo.com")) continue;
          results.push({
            url: resultUrl,
            title: decodeHtmlEntities(match[2]),
            snippet: "",
          });
        }
      }

      // Last resort fallback: look for any result links
      if (results.length === 0) {
        const linkRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
        while ((match = linkRegex.exec(html)) !== null && results.length < max) {
          const resultUrl = decodeHtmlEntities(match[1]);
          if (resultUrl.includes("duckduckgo.com")) continue;
          results.push({
            url: resultUrl,
            title: decodeHtmlEntities(match[2]),
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
      if (err.name === "AbortError") {
        return { success: false, error: "Search request timed out after 15 seconds" };
      }
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
