# PolicyPilot

PolicyPilot is an agent-native operations room. On Day 1 it demonstrates a deterministic incident dashboard that exposes exactly one read-only WebMCP tool — `get_incident_context` — so a browser-resident agent can inspect the current incident state without being able to change anything.

## Architecture

```text
seeded incident (src/lib/incident.ts)
        ↓
WebMCP adapter (src/lib/webmcp.ts)
        ↓
document.modelContext.registerTool()
        ↓
agent call from a WebMCP-enabled browser
```

The seeded incident is the single source of truth: the dashboard UI and the WebMCP tool both read from `getIncidentContext()`. The adapter registers a structured read-only tool through `document.modelContext` when available and degrades gracefully — the page stays fully usable in browsers without WebMCP.

## Prerequisites

- Node.js 20.9 or newer
- npm

## Install

```bash
npm install
```

## Start

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Stop the server by pressing `Ctrl+C`. No containers or background services remain.

## Production check

```bash
npm run build && npm run start
```

Open [http://localhost:3000](http://localhost:3000), then stop with `Ctrl+C`.

## Verification

```bash
npm test
npm run lint
npm run build
```

## Testing the WebMCP tool

1. **ChatGPT in-app browser (preferred):** open the running local URL (`http://localhost:3000`) through ChatGPT's in-app browser.
2. **Chrome alternative:** use Chrome 149 or newer with `chrome://flags/#enable-webmcp-testing` enabled, then restart the browser.

Send the agent this prompt:

> Inspect this page's available tools, call `get_incident_context`, and summarize the incident without proposing or executing a change.

**Expected result:** the tool returns incident `INC-1042`, service `payments-api`, severity `SEV-2`, status `investigating`, and three health signals.

## Day 1 boundary

Day 1 ships one read-only tool. Human approvals, mutations, and rollback execution arrive later.
