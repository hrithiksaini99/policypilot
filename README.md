# PolicyPilot

PolicyPilot is an agent-native operations room demonstrating a three-day WebMCP evolution:

| Day | Milestone | Tools | Key Capability |
|-----|-----------|-------|----------------|
| **Day 1** (main) | Read-only incident inspection | 1 (`get_incident_context`) | Deterministic dashboard + single read-only WebMCP tool |
| **Day 2** (feature/day2-tool-contract) | Shared runtime, activity feed, rollback proposal preview, audit trail, reset | 3 (adds `list_recent_deploys`, `propose_rollback`) | Live agent feed, non-executing preview, immutable audit log |
| **Day 3** (feature/day3-approval-execution) | Human approval gate, deterministic fingerprint, pre-approval rejection, simulated execution & mitigation | 5 (adds `get_policy_state`, `execute_approved_rollback`) | Approval receipt binding, execution only after exact fingerprint match |

> **Branch status:** `main` contains the **Day 1** implementation only. Day 2 and Day 3 remain on their feature branches — the default branch does **not** run Day 3.

---

## Day 1 — Read-Only Inspection (main)

A deterministic incident dashboard exposing exactly one read-only WebMCP tool — `get_incident_context` — so a browser-resident agent can inspect the current incident state without being able to change anything.

**Architecture:**
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

---

## Day 2 — Shared Runtime, Activity Feed & Rollback Preview (feature/day2-tool-contract)

Adds a live agent activity feed, a rollback proposal preview that requires human approval, and a reset control — all driven by a shared runtime that is the single source of truth for audit state.

**New architecture layer:**
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

---

## Day 3 — Deterministic Approval & Execution (feature/day3-approval-execution)

Adds a deterministic human approval workflow: an agent cannot execute the rollback until a person explicitly approves the exact proposal with its action fingerprint. The execution tool remains discoverable but is hard-rejected by the runtime before approval.

### Five WebMCP tools

| Tool | Description | Read-only | State-changing hint |
|------|-------------|-----------|---------------------|
| `get_incident_context` | Read the current incident, service health signals, and investigation status | Yes | No |
| `list_recent_deploys` | List recent payments-api deployments and identify the active suspect rollout | Yes | No |
| `get_policy_state` | Read the current PolicyPilot guardrail state and whether rollback execution is available | Yes | No |
| `propose_rollback` | Prepare a non-executing rollback preview for the active suspect deployment; human approval is still required | No | Yes (`readOnlyHint: false`) |
| `execute_approved_rollback` | Execute the exact simulated rollback only when a human-approved approval ID and action fingerprint match the pending proposal | No | Yes (`readOnlyHint: false`) |

The first three tools carry `readOnlyHint: true`; the last two carry `readOnlyHint: false`. Every definition has `untrustedContentHint: false`. The WebMCP registry has no removal API — `execute_approved_rollback` remains registered but the runtime rejects every premature, mismatched, or repeated attempt. Runtime validation is the authority boundary.

### Local human approval gate

A local human-only UI action (`PolicyApproval` component) calls `runtime.approveCurrentProposal()` — no network call, authentication, database, or real deployment. This produces a deterministic `ApprovalReceipt` with a fixed `approvalId` and `actionHash`. Only after this step does the runtime allow `execute_approved_rollback` to succeed with the exact matching input.

### Deterministic approval ID & action fingerprint

- **Approval ID:** `APR-INC-1042-DEP-8821`
- **Action fingerprint:** `fnv1a-32:rollback-inc-1042-dep-8821-checkout-v2-checkout-v1`

These are fixed, reproducible values — not generated at runtime.

### Pre-approval rejection

Calling `execute_approved_rollback` before human approval (or with a mismatched approval ID / action fingerprint) is rejected by the runtime with error codes:
- `APPROVAL_REQUIRED` — no approval receipt exists
- `APPROVAL_MISMATCH` — approval ID or action fingerprint does not match the pending proposal
- `ROLLBACK_ALREADY_EXECUTED` — repeat execution attempt

Each rejection creates an immutable audit entry.

### Simulated execution & mitigation

On successful execution with exact matching input, the runtime returns a fixed `ExecutionReceipt` with `executionId: "EXE-INC-1042-DEP-8821"`, updates the simulated incident to `status: "mitigated"`, and the health signals show the rollback completed.

---

## Branch Links

- **[Day 1 (main)](https://github.com/hrithiksaini99/policypilot/tree/main):** `git checkout main` — this branch
- **[Day 2](https://github.com/hrithiksaini99/policypilot/tree/feature/day2-tool-contract):** `git checkout feature/day2-tool-contract`
- **[Day 3](https://github.com/hrithiksaini99/policypilot/tree/feature/day3-approval-execution):** `git checkout feature/day3-approval-execution`

---

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

## Branch-Specific Testing

### Day 1 (main)

```bash
git checkout main
npm install && npm run dev
```

1. Open `http://localhost:3000` in a WebMCP-enabled browser
2. Prompt the agent:
   > Inspect this page's available tools, call `get_incident_context`, and summarize the incident without proposing or executing a change.

**Expected:** Tool returns incident `INC-1042`, service `payments-api`, severity `SEV-2`, status `investigating`, three health signals.

---

### Day 2 (feature/day2-tool-contract)

```bash
git checkout feature/day2-tool-contract
npm install && npm run dev
```

1. Open `http://localhost:3000` in a WebMCP-enabled browser
2. Prompt the agent:
   > Inspect the incident, list recent deployments, and prepare—but do not execute—the safest rollback. Explain why human approval is still required.

**Expected:** Agent discovers three tools, calls all three, receives proposal `RB-INC-1042-DEP-8821` with `fromVersion: "checkout-v2"`, `toVersion: "checkout-v1"`, `status: "awaiting_approval"`. UI shows three-event activity trail and awaiting-approval preview.

---

### Day 3 (feature/day3-approval-execution)

```bash
git checkout feature/day3-approval-execution
npm install && npm run dev
```

1. Open `http://localhost:3000` in a WebMCP-enabled browser
2. Prompt the agent:
   > Inspect the incident and policy, propose the safe rollback, try execution before approval, then approve the exact displayed rollback and execute it with the returned approval ID and action fingerprint.

**Expected:** Pre-execution rejects with `APPROVAL_REQUIRED`; human dialog binds `DEP-8821`, `checkout-v2 → checkout-v1`, `APR-INC-1042-DEP-8821`, and fingerprint `fnv1a-32:rollback-inc-1042-dep-8821-checkout-v2-checkout-v1`; exact execution returns `EXE-INC-1042-DEP-8821`, changes health to `mitigated`, creates completed audit event; repeat execution rejects with `ROLLBACK_ALREADY_EXECUTED`; Reset restores original incident/policy, empty audit/approval/execution, five retained registrations.

---

## Day 1 Boundary

Day 1 ships one read-only tool. Human approvals, mutations, and rollback execution arrive on Day 2 and Day 3 feature branches.