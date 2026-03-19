# ⚡ SamaraGeminiCode

Autonomous coding agent. Tell it what to build, it figures out how.

SamaraCode is an AI orchestrator that breaks your request into tasks, spawns agents to work in parallel, and shows everything in a web UI with live preview. Powered by Gemini 3.1 Flash Lite (free tier).

## Install

```bash
npm install -g samaracode
```

## Use

```bash
cd your-project
samara
```

First run opens a setup wizard — just paste your Gemini API key. Then the web UI opens in your browser.

Talk to it naturally:

```
you → build me a task manager in React with dark mode
```

It asks a couple of questions, proposes a plan, and spawns agents to build it. You watch the progress in the sidebar and see the result in the live preview tab.

## What it does

- **Multi-agent** — orchestrator delegates to specialized sub-agents running in parallel
- **Live preview** — dev servers open in an embedded preview tab with URL bar
- **Bug detection** — captures dev server errors, spawns debug agents to fix them when you report issues
- **Self-extending** — creates new tools on the fly, tests them, persists for future sessions
- **Token tracking** — dedicated Tokens tab shows per-query usage, cost breakdown, and session totals in real time
- **Smart file reads** — agents read only the lines they need (300-line cap), saving tokens on large files
- **Code sanitization** — auto-fixes escaped quotes in generated code files before writing to disk
- **Web UI** — chat, logs, tokens tab, task sidebar, agent detail panels, preview tabs
- **19 built-in tools** — file ops, shell, web search, git, memory, grep, project detection
- **Works from any directory** — global command, config stored in `~/.samaracode/`

## Model

SamaraCode uses a single model for everything:

| Model | Provider | Input/1M | Output/1M |
|-------|----------|----------|-----------|
| `gemini-3.1-flash-lite-preview` | Google | $0.075 | $0.30 |

Free tier: 15 RPM, 1,500 RPD, 1M tokens/min. With billing enabled, pay-as-you-go.

## Requirements

- Node.js 18+
- Gemini API key ([get one here](https://aistudio.google.com/apikey))

## Architecture

```
  Web UI (browser)
  Chat | Logs | Tokens | Preview | Task Sidebar
          ↕ WebSocket
      Orchestrator (gemini-3.1-flash-lite-preview)
      understands → plans → delegates
          ↕
  ┌─────────┬─────────┬──────────┐
  │ Agent A │ Agent B │ Agent N  │  (same model)
  │ (code)  │ (debug) │ (search) │
  └─────────┴─────────┴──────────┘
          ↕
    19 Built-in Tools + Dynamic Tools
    file_read | bash | grep | git | web_search | ...
```

## Token Usage

The Tokens tab tracks every LLM call in real time:

- **Summary cards** — total calls, input/output tokens, total cost
- **Query log** — per-call breakdown with timestamp, source (orchestrator/agent), model, tokens, cost
- **Tab badge** — running cost visible without switching tabs

## Config

```
~/.samaracode/
├── config.json    # API keys, routing
├── tools/         # Dynamic tools created by agents
├── memory/        # Persistent agent memory
└── audit/         # Session logs
```

Delete `~/.samaracode/config.json` to re-run the setup wizard.

## Development

```bash
git clone https://github.com/inuyashamx/SamaraCode.git
cd SamaraCode
npm install
npm run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SAMARACODE_PORT` | Web UI port (default: 3777) |
| `GEMINI_API_KEY` | Gemini API key (alternative to wizard) |

## License

MIT — Built by [inuyashamx](https://github.com/inuyashamx)
