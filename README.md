# PolicyPilot

PolicyPilot is an agent-native operations room. On Day 1 it demonstrates a deterministic incident dashboard that exposes exactly one read-only WebMCP tool — `get_incident_context` — so a browser-resident agent can inspect the current incident state without being able to change anything.

On Day 2 it adds a live agent activity feed, a rollback proposal preview that requires human approval, and a reset control — all driven by a shared runtime that is the single source of truth for audit state.

On Day 3 it adds a deterministic human approval workflow: an agent cannot execute the rollback until a person explicitly approves the exact proposal with its action fingerprint. The execution tool remains discoverable but is hard-rejected by the runtime before approval.

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

The seeded incident is the single source of truth: the dashboard UI and the WebMCP tools both read from `getIncidentContext()`. The adapter registers five structured tools through `document.modelContext` when available and degrades gracefully — the page stays fully usable in browsers without WebMCP.

The shared singleton `policyPilotRuntime` from `@/lib/operations` is the sole source of activity state. Its public API is `readIncident()`, `listRecentDeploys()`, `proposeRollback(input)`, `getSnapshot()`, `subscribe(listener)`, `reset()`, `getPolicyState()`, `approveCurrentProposal()`, and `executeApprovedRollback(input)`. The UI subscribes with `useSyncExternalStore` — no polling, no second store.

### Day 3 tools

| Tool | Description | Read-only | State-changing hint |
|------|-------------|-----------|---------------------|
| `get_incident_context` | Read the current incident, service health signals, and investigation status | Yes | No |
| `list_recent_deploys` | List recent payments-api deployments and identify the active suspect rollout | Yes | No |
| `get_policy_state` | Read the current PolicyPilot guardrail state and whether rollback execution is available | Yes | No |
| `propose_rollback` | Prepare a non-executing rollback preview for the active suspect deployment; human approval is still required | No | Yes (`readOnlyHint: false`) |
| `execute_approved_rollback` | Execute the exact simulated rollback only when a human-approved approval ID and action fingerprint match the pending proposal | No | Yes (`readOnlyHint: false`) |

The first three tools carry `readOnlyHint: true`; the last two carry `readOnlyHint: false`. Every definition has `untrustedContentHint: false`. The WebMCP registry has no removal API — `execute_approved_rollback` remains registered but the runtime rejects every premature, mismatched, or repeated attempt. Runtime validation is the authority boundary.

`propose_rollback` validates that `deploymentId` identifies the active suspect deployment (`DEP-8821`), then creates a `RollbackProposal` with `status: "awaiting_approval"` and `requiresApproval: true`.

`execute_approved_rollback` accepts exactly `{ "approvalId": "APR-INC-1042-DEP-8821", "actionHash": "fnv1a-32:rollback-inc-1042-dep-8821-checkout-v2-checkout-v1" }`. It validates a pending proposal, a matching approval receipt, and that the rollback hasn't already executed. On success it returns a fixed `ExecutionReceipt` with `executionId: "EXE-INC-1042-DEP-8821"`, updates the simulated incident to `status: "mitigated"`, and the health signals show the rollback completed.

### Human approval workflow

A local human-only UI action (`PolicyApproval` component) calls `runtime.approveCurrentProposal()` — no network call, authentication, database, or real deployment. This produces a deterministic `ApprovalReceipt` with the fixed `approvalId` and `actionHash`. Only after this step does the runtime allow `execute_approved_rollback` to succeed with the exact matching input.

### Audit trail

Every tool invocation appends an immutable `PolicyPilotAuditEntry` to the runtime's audit log. Entries have `eventId`, `timestamp`, exact `toolName`, `input`, and either `status: "success"` plus `result` or `status: "error"` plus `{ code, message }`. The UI renders newest first. Rejected execution attempts (before approval, wrong fingerprint, repeat) all create error audit entries with codes `APPROVAL_REQUIRED`, `APPROVAL_MISMATCH`, or `ROLLBACK_ALREADY_EXECUTED`.

### Reset semantics

The `Reset demo` button calls `policyPilotRuntime.reset()`, which clears the audit log, clears any current proposal/approval/execution, resets the event counter, and restores the initial investigating incident. Tool registrations are unaffected — the five tools remain registered.

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

## Testing the WebMCP tools (Day 3)

1. **ChatGPT in-app browser (preferred):** open the running local URL (`http://localhost:3000`) through ChatGPT's in-app browser.
2. **Chrome alternative:** use Chrome 149 or newer with `chrome://flags/#enable-webmcp-testing` enabled, then restart the browser.

### Judge prompt

Send the agent this prompt:

> Inspect the incident and policy, propose the safe rollback, try execution before approval, then approve the exact displayed rollback and execute it with the returned approval ID and action fingerprint.

**Expected result:** pre-approval execution rejects/audits with `APPROVAL_REQUIRED`; human dialog binds `DEP-8821`, `checkout-v2 → checkout-v1`, `APR-INC-1042-DEP-8821`, and the fingerprint `fnv1a-32:rollback-inc-1042-dep-8821-checkout-v2-checkout-v1`; only exact execution returns `EXE-INC-1042-DEP-8821`, changes health to `mitigated`, and creates a completed audit event. Repeat execution rejects with `ROLLBACK_ALREADY_EXECUTED`. Reset restores original incident/policy, empty audit/approval/execution, and five retained registrations.

## Day 1 boundary

Day 1 ships one read-only tool. Human approvals, mutations, and rollback execution arrive later.