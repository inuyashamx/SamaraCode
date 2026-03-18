# ⚡ SamaraCode

Autonomous coding agent. Tell it what to build, it figures out how.

SamaraCode is an AI orchestrator that breaks your request into tasks, spawns agents to work in parallel, and shows everything in a web UI with live preview. Powered by Gemini 3.1.

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
- **Web UI** — chat, logs, task sidebar, agent detail panels, preview tabs
- **19 built-in tools** — file ops, shell, web search, git, memory, grep, project detection
- **Works from any directory** — global command, config stored in `~/.samaracode/`

## Requirements

- Node.js 18+
- Gemini API key ([get one here](https://aistudio.google.com/apikey))
- Claude and GPT can be added later from the UI

## Architecture

```
  Web UI (browser)
  Chat | Logs | Preview | Task Sidebar
          ↕ WebSocket
      Orchestrator (Gemini 3.1 Pro)
      understands → plans → delegates
          ↕
  ┌─────────┬─────────┬──────────┐
  │ Agent A │ Agent B │ Agent N  │  (Gemini Flash)
  │ (code)  │ (debug) │ (search) │
  └─────────┴─────────┴──────────┘
          ↕
    19 Built-in Tools + Dynamic Tools
    file_read | bash | grep | git | web_search | ...
```

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
