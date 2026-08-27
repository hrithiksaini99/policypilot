# PolicyPilot

PolicyPilot is an agent-native operations room. On Day 1 it demonstrates a deterministic incident dashboard that exposes exactly one read-only WebMCP tool — `get_incident_context` — so a browser-resident agent can inspect the current incident state without being able to change anything.

On Day 2 it adds a live agent activity feed, a rollback proposal preview that requires human approval, and a reset control — all driven by a shared runtime that is the single source of truth for audit state.

## Architecture

```text
seeded incident (src/lib/incident.ts)
        ↓
shared runtime (src/lib/operations.ts)
        ↓
WebMCP adapter (src/lib/webmcp.ts)
        ↓
document.modelContext.registerTool()
        ↓
agent call from a WebMCP-enabled browser
```

The seeded incident is the single source of truth: the dashboard UI and the WebMCP tools both read from `getIncidentContext()`. The adapter registers three structured tools through `document.modelContext` when available and degrades gracefully — the page stays fully usable in browsers without WebMCP.

The shared singleton `policyPilotRuntime` from `@/lib/operations` is the sole source of activity state. Its public API is `readIncident()`, `listRecentDeploys()`, `proposeRollback(input)`, `getSnapshot()`, `subscribe(listener)`, and `reset()`. The UI subscribes with `useSyncExternalStore` — no polling, no second store.

### Day 2 tools

| Tool | Description | Read-only | State-changing hint |
|------|-------------|-----------|---------------------|
| `get_incident_context` | Read the current incident, service health signals, and investigation status | Yes | No |
| `list_recent_deploys` | List recent payments-api deployments and identify the active suspect rollout | Yes | No |
| `propose_rollback` | Prepare a non-executing rollback preview for the active suspect deployment; human approval is still required | No | Yes (`readOnlyHint: false`) |

Only `propose_rollback` carries `readOnlyHint: false`. It validates that `deploymentId` identifies the active suspect deployment (`DEP-8821`), then creates a `RollbackProposal` with `status: "awaiting_approval"` and `requiresApproval: true`. Day 2 never executes a rollback.

### Audit trail

Every tool invocation appends an immutable `PolicyPilotAuditEntry` to the runtime's audit log. Entries have `eventId`, `timestamp`, exact `toolName`, `input`, and either `status: "success"` plus `result` or `status: "error"` plus `{ code, message }`. The UI renders newest first.

### Reset semantics

The `Reset demo` button calls `policyPilotRuntime.reset()`, which clears the audit log, clears any current proposal, and resets the event counter. Tool registrations are unaffected — the three tools remain registered.

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

## Testing the WebMCP tools (Day 2)

1. **ChatGPT in-app browser (preferred):** open the running local URL (`http://localhost:3000`) through ChatGPT's in-app browser.
2. **Chrome alternative:** use Chrome 149 or newer with `chrome://flags/#enable-webmcp-testing` enabled, then restart the browser.

Send the agent this prompt:

> Inspect the incident, list recent deployments, and prepare—but do not execute—the safest rollback. Explain why human approval is still required.

**Expected result:** the agent discovers exactly three tools (`get_incident_context`, `list_recent_deploys`, `propose_rollback`), calls `get_incident_context` (returns incident `INC-1042`, service `payments-api`, severity `SEV-2`, status `investigating`, three health signals), calls `list_recent_deploys` (returns `DEP-8821` as the active suspect deployment for `payments-api` rolling out `checkout-v2` from `checkout-v1`), calls `propose_rollback` with `{ "deploymentId": "DEP-8821" }` and receives proposal `RB-INC-1042-DEP-8821` with `fromVersion: "checkout-v2"`, `toVersion: "checkout-v1"`, `status: "awaiting_approval"`, and an explicit statement that Day 2 cannot execute the rollback — human approval is still required. The UI shows a three-event activity trail (get_incident_context success, list_recent_deploys success, propose_rollback success) and an awaiting-approval preview.

## Day 1 boundary

Day 1 ships one read-only tool. Human approvals, mutations, and rollback execution arrive later.