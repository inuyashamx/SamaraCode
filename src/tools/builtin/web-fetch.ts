import { Tool, ToolResult } from "../types.js";

export const webFetchTool: Tool = {
  name: "web_fetch",
  description: "Fetch content from a URL. Returns the response body as text.",
  category: "web",
  builtin: true,
  parameters: [
    { name: "url", type: "string", description: "The URL to fetch", required: true },
    { name: "method", type: "string", description: "HTTP method (default: GET)", required: false, default: "GET" },
    { name: "headers", type: "object", description: "Request headers as key-value pairs", required: false },
    { name: "body", type: "string", description: "Request body for POST/PUT", required: false },
    { name: "timeout", type: "number", description: "Request timeout in ms (default: 30000)", required: false, default: 30000 },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const timeout = params.timeout || 30000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const options: RequestInit = {
        method: params.method || "GET",
        headers: {
          "User-Agent": "SamaraCode/1.0",
          ...(params.headers || {}),
        },
        signal: controller.signal,
      };

      if (params.body && ["POST", "PUT", "PATCH"].includes((params.method || "").toUpperCase())) {
        options.body = params.body;
      }

      let response;
      try {
        response = await fetch(params.url, options);
      } finally {
        clearTimeout(timer);
      }
      const text = await response.text();

      // Truncate very long responses
      const maxLen = 50000;
      const truncated = text.length > maxLen ? text.slice(0, maxLen) + "\n...[truncated]" : text;

      return {
        success: response.ok,
        data: {
          status: response.status,
          statusText: response.statusText,
          body: truncated,
          headers: Object.fromEntries(response.headers.entries()),
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
  tests: [
    {
      name: "fetch httpbin",
      input: { url: "https://httpbin.org/get" },
      validate: (r) => r.success && r.data.status === 200,
    },
  ],
};
