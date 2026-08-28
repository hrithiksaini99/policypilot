# Day 4: Collaboration & Legibility Design Spec

**Branch:** `feature/day4-collaboration-legibility` (from `e9c9b2a`)  
**Date:** 2026-08-29  
**Status:** Awaiting written-spec review

---

## 1. Scope & Constraints

### 1.1 What This Spec Covers
- Two deterministic collaboration scenarios: `incident` (Day 3 behavior) and `healthy` (new)
- Single shared `PolicyPilotRuntime` with scenario-aware seed loading
- Local human `selectScenario` action for atomic scenario switching
- UI: scenario selector, Day 4 title, compact tool cards (read-only/mutating badges, availability, policy reason)
- Deterministic healthy seed values
- Runtime interfaces, state transitions, tool semantics, error precedence
- Reset vs scenario-switch behavior
- Components, files, accessibility, tests
- Non-goals, migration compatibility, acceptance criteria

### 1.2 Hard Constraints (No Exceptions)
- **Exactly five WebMCP tools** — no new tools, no tool removal, no dynamic unregister
- **One shared runtime instance** — `policyPilotRuntime` singleton remains the authority
- **No backend, no auth, no real operations** — all state is in-memory, deterministic, client-side
- **All authority stays in runtime** — UI never mutates state directly; only invokes runtime methods
- **No new `PolicyPilotToolName` values** — the union type is frozen at five members
- **`registerPolicyPilotTools` signature unchanged** — same five tool definitions, same order

---

## 2. Scenario Model

### 2.1 ScenarioId Type
```typescript
// src/lib/scenario.ts (new file)
export type ScenarioId = "incident" | "healthy";
```

### 2.2 Scenario Contract
| Property | `incident` | `healthy` |
|----------|------------|-----------|
| Incident status | `investigating` → `mitigated` on execution | `healthy` (never changes) |
| Incident signals | 3 seeded error signals | 2 seeded health signals |
| Active deployment | `DEP-8821` (checkout-v2, `suspect: true`) | `DEP-9900` (checkout-v3, `suspect: false`) |
| Previous deployment | `DEP-8817` (checkout-v1) | `DEP-9890` (checkout-v2) |
| `propose_rollback` | Allowed → creates proposal | Rejected → `NO_ACTION_REQUIRED` audit error |
| `execute_approved_rollback` | Available after approval | Always blocked (`executionAvailability: "blocked"`) |
| Approval button/fingerprint | Visible after proposal | Never visible |
| Policy explanation | "Proposal drafted; human approval required before execution." | "System healthy; no mutation justified. Rollback not permitted." |
| Execution availability | `blocked` → `available` → `completed` | Permanently `blocked` |
| Incident ID | `INC-1042` | `OPS-HEALTHY-0001` |
| Severity | `SEV-2` | `INFO` |
| Started at | `2026-08-26T08:30:00.000Z` | `2026-08-29T09:00:00.000Z` |
| Summary | "Elevated 5xx errors after feature-flag rollout" | "payments-api operating normally" |

### 2.3 Deterministic Healthy Seed Values
```typescript
// src/lib/operations.ts
const seededHealthyIncident: IncidentContext = Object.freeze({
  incidentId: "OPS-HEALTHY-0001",
  service: "payments-api",
  severity: "INFO",
  status: "healthy" as const,
  summary: "payments-api operating normally",
  startedAt: "2026-08-29T09:00:00.000Z",
  signals: Object.freeze([
    "5xx rate stable at 0.4%",
    "Latency p95 stable at 220ms",
  ]) as IncidentContext["signals"],
});

const seededHealthyDeployments: readonly RecentDeployment[] = Object.freeze([
  Object.freeze({
    deploymentId: "DEP-9900",
    service: "payments-api",
    version: "checkout-v3",
    previousVersion: "checkout-v2",
    deployedAt: "2026-08-29T08:00:00.000Z",
    status: "active" as const,
    suspect: false,
  }) satisfies RecentDeployment,
  Object.freeze({
    deploymentId: "DEP-9890",
    service: "payments-api",
    version: "checkout-v2",
    previousVersion: "checkout-v1",
    deployedAt: "2026-08-28T16:10:00.000Z",
    status: "superseded" as const,
    suspect: false,
  }) satisfies RecentDeployment,
]);
```

> **Note:** `IncidentStatus` type expands to `"investigating" | "mitigated" | "healthy"` (see §4.1). `Severity` type expands additively to `"SEV-2" | "INFO"` preserving Day 3 `SEV-2`.

---

## 3. Runtime Interface Changes

### 3.1 New Runtime Method
```typescript
// src/lib/operations.ts — added to PolicyPilotRuntime interface
selectScenario(scenarioId: ScenarioId): void;
```

### 3.2 `selectScenario` Semantics (Atomic, Single Notification)
When `selectScenario(id)` is called:
1. **Atomically** (single synchronous transaction):
   - `currentScenario = id`
   - `auditLog = []`
   - `currentProposal = null`
   - `currentApproval = null`
   - `currentExecution = null`
   - `nextEventNumber = 1`
   - `currentIncident = null` (the next snapshot/tool read lazily loads the selected seed)
   - `cachedSnapshot = null`
2. **Notify subscribers exactly once** (no audit entry created)
3. **No change to WebMCP registrations** — `registrations` WeakMap untouched

> **Testable wording:**  
> "Calling `runtime.selectScenario('healthy')` followed by `runtime.getSnapshot()` returns a snapshot with `auditLog.length === 0`, `currentProposal === null`, `currentApproval === null`, `currentExecution === null`, `incident.status === 'healthy'`, and the subscriber callback has fired exactly once. No audit entry is recorded for the switch itself."

### 3.3 No-Op Behavior
- Calling `selectScenario(currentScenario)` is a **no-op**: no state mutation, no notification, no audit entry.
- **Testable wording:**  
> "Calling `runtime.selectScenario('incident')` when already in `incident` scenario leaves all state unchanged, fires zero notifications, and appends zero audit entries."

### 3.4 Reset vs Scenario-Switch
| Action | `reset()` | `selectScenario(id)` |
|--------|-----------|----------------------|
| Clears audit/proposal/approval/execution | Yes | Yes |
| Resets event IDs (`EVT-0001`) | Yes | Yes |
| Reloads incident seed | Yes (same scenario) | Yes (selected scenario) |
| Notifies subscribers | Once | Once (only if scenario changes) |
| Changes WebMCP registrations | No | No |
| Creates audit entry | No | No |

---

## 4. Type System Updates

### 4.1 `src/lib/incident.ts`
```typescript
export type IncidentStatus = "investigating" | "mitigated" | "healthy";

export type Severity = "SEV-2" | "INFO";

export interface IncidentContext {
  incidentId: string;
  service: string;
  severity: Severity;
  status: IncidentStatus;
  summary: string;
  startedAt: string;
  signals: readonly string[];
}
```

### 4.2 `src/lib/operations.ts`
```typescript
// New error code for healthy scenario
export type PolicyPilotErrorCode =
  | "INVALID_ROLLBACK_INPUT"
  | "INTERNAL_TOOL_ERROR"
  | "APPROVAL_REQUIRED"
  | "INVALID_APPROVAL_INPUT"
  | "APPROVAL_MISMATCH"
  | "ROLLBACK_ALREADY_EXECUTED"
  | "NO_ACTION_REQUIRED";  // NEW: healthy scenario blocks rollback

// PolicyPilotSnapshot adds readonly scenarioId as sole selector source
export interface PolicyPilotSnapshot {
  readonly scenarioId: ScenarioId;
  readonly incident: IncidentContext;
  readonly recentDeployments: readonly RecentDeployment[];
  readonly currentProposal: RollbackProposal | null;
  readonly auditLog: readonly PolicyPilotAuditEntry[];
  readonly policy: PolicyState;
  readonly currentApproval: ApprovalReceipt | null;
  readonly currentExecution: ExecutionReceipt | null;
}

// PolicyPilotRuntime interface adds:
selectScenario(scenarioId: ScenarioId): void;

// createPolicyPilotRuntime options add:
export interface PolicyPilotRuntimeOptions {
  now?: () => string;
  initialScenario?: ScenarioId;  // NEW: defaults to "incident"
}
```

### 4.3 Policy State Explanations (Deterministic Strings)
| Phase | `incident` Explanation | `healthy` Explanation |
|-------|------------------------|----------------------|
| `read` | "Inspection and drafting allowed; execution requires human approval." | "System healthy; no mutation justified. Rollback not permitted." |
| `draft` | (not used) | (not used) |
| `approval_required` | "Proposal drafted; human approval required before execution." | (unreachable) |
| `approved` | "Proposal approved; awaiting execution." | (unreachable) |
| `executed` | "Rollback has been executed; incident is mitigated." | (unreachable) |

> **Error precedence:**
> - `propose_rollback`: malformed input or a deployment ID other than the active deployment for the selected scenario → `INVALID_ROLLBACK_INPUT`. Valid `DEP-9900` in healthy → `NO_ACTION_REQUIRED`. Valid `DEP-8821` in incident → creates the proposal.
> - `execute_approved_rollback`: Malformed/unknown input → `INVALID_APPROVAL_INPUT` (always, both scenarios). Well-formed input in healthy → `APPROVAL_REQUIRED`. Well-formed valid approval in incident → executes.

---

## 5. Tool Semantics (Unchanged Count, Scenario-Aware Behavior)

### 5.1 Tool Behavior Matrix
| Tool | `incident` | `healthy` |
|------|------------|-----------|
| `get_incident_context` | Returns seeded incident (investigating/mitigated) | Returns seeded healthy incident |
| `list_recent_deploys` | Returns seeded incident deployments (1 suspect) | Returns seeded healthy deployments (0 suspect) |
| `get_policy_state` | Returns phase per Day 3 logic | Always `phase: "read"`, `executionAvailability: "blocked"`, healthy explanation |
| `propose_rollback` | Creates proposal (audit success) | Malformed/unknown input → `INVALID_ROLLBACK_INPUT`; well-formed `DEP-9900` → `NO_ACTION_REQUIRED` (audit error), no proposal created |
| `execute_approved_rollback` | Executes after approval (audit success) | Malformed/unknown input → `INVALID_APPROVAL_INPUT`; well-formed input → `APPROVAL_REQUIRED` (audit error), never available |

### 5.2 `propose_rollback` in Healthy Scenario — Exact Behavior
```typescript
// Inside proposeRollback:
const deploymentId = validateRollbackInputForCurrentScenario(input);
if (currentScenario === "healthy" && deploymentId === "DEP-9900") {
  throw new PolicyPilotInputError(
    "NO_ACTION_REQUIRED",
    "System healthy; no rollback action required or permitted."
  );
}
// Incident scenario: normal proposal creation logic follows
// Audit entry recorded with error.code === "NO_ACTION_REQUIRED" or "INVALID_ROLLBACK_INPUT"
```

### 5.3 `execute_approved_rollback` in Healthy Scenario
- Validate the closed `{ approvalId, actionHash }` input first; malformed input throws `INVALID_APPROVAL_INPUT`.
- Any well-formed execution input then throws `APPROVAL_REQUIRED` ("No approved proposal available for execution.").
- `executionAvailability` permanently `"blocked"` in `getPolicyState`

### 5.4 Tool Registration Unchanged
`registerPolicyPilotTools` continues to register exactly five tools in this order:
1. `get_incident_context`
2. `list_recent_deploys`
3. `get_policy_state`
4. `propose_rollback`
5. `execute_approved_rollback`

No tool metadata changes. No conditional registration.

---

## 6. UI Specification

### 6.1 Page Title & Intro (`src/app/page.tsx`)
- Title line: `PolicyPilot / Day 4` (was `Day 3`)
- Intro copy unchanged: "Human authority. Agent speed." / "A policy-controlled operations room for the agent-native web."

### 6.2 Scenario Selector (New Component)
**File:** `src/components/scenario-selector.tsx`  
**Location:** Inside intro section (`<section aria-label="PolicyPilot introduction">`), after the intro paragraph, before the two-column grid.

**Accessibility Requirements:**
- `<fieldset>` with `<legend>` "Collaboration scenario"
- Two `<input type="radio">` with `name="scenario"`, `value="incident"` and `value="healthy"`
- Associated `<label>` elements with visible text "Active incident" / "Healthy system"
- `aria-describedby` linking to a live region announcing the active scenario
- Keyboard navigable (arrow keys between options)
- Focus-visible styles matching existing button focus rings
- Announces change via `aria-live="polite"` region

**Behavior:**
- Calls `policyPilotRuntime.selectScenario(id)` on change
- Reflects `snapshot.scenarioId`, the sole reactive scenario source
- No loading state — switch is synchronous

### 6.3 WebMCP Status — Compact Tool Cards (Replace Chips)
**File:** `src/components/webmcp-status.tsx` (modify)

**Card Layout (per tool):**
```
┌─────────────────────────────────────────────────────────┐
│ get_incident_context                          ● READ    │
│ Read the current PolicyPilot incident...               │
│                                                         │
│ Available • Policy: Inspection allowed                 │
└─────────────────────────────────────────────────────────┘
```

**Card Fields:**
| Field | Source | Healthy Scenario Value |
|-------|--------|------------------------|
| Name | `tool.name` | Same |
| Description | `tool.description` | Same |
| Badge | `tool.annotations.readOnlyHint` → "READ" / "MUTATE" | Same |
| Availability | Derived per tool from `snapshot.scenarioId` and policy state | Three read tools: "Available"; proposal: "No action required"; execution: "Blocked" |
| Policy Reason | `policy.explanation` (truncated to 80 chars + tooltip) | Healthy explanation |

**Per-tool availability rules:**
- `get_incident_context`, `list_recent_deploys`, and `get_policy_state`: always `Available`.
- `propose_rollback`: `Available` in the incident scenario; `No action required` (blocked) in healthy.
- `execute_approved_rollback`: `Blocked` before approval, `Available` after approval, `Completed` after execution, and always `Blocked` in healthy.

**Responsive Layout:**
- Two-column grid on `lg:` (unchanged)
- Single column on `< lg` (unchanged)
- Cards use `flex flex-col gap-1.5 p-3` inside `lg:grid-cols-2`

**Implementation Notes:**
- Replace `<ul className="flex flex-wrap gap-1.5">` chip list with `<div className="grid gap-3 lg:grid-cols-2">` card grid
- Each card: `rounded-lg border border-zinc-800 bg-zinc-900/60 p-3`
- Badge: `inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-xs` with `bg-cyan-500/20 text-cyan-300` (READ) or `bg-amber-500/20 text-amber-300` (MUTATE)
- Availability: `inline-flex items-center gap-1 font-mono text-xs` with green/red dot + text
- Policy reason: `text-xs text-zinc-400 truncate` with `title` attribute for full text

### 6.4 Policy Approval — Healthy Scenario Hides Approval UI
**File:** `src/components/policy-approval.tsx` (modify)

- When `snapshot.scenarioId === "healthy"`: render only the policy explanation section (no proposal, no approval button, no fingerprint)
- `currentProposal`, `currentApproval`, `currentExecution` always `null` in healthy scenario (enforced by runtime)
- Policy explanation uses healthy deterministic string (§4.3)

### 6.5 Incident Dashboard — Healthy Status Badge
**File:** `src/components/incident-dashboard.tsx` (modify)

- Status badge color: `bg-emerald-500/15 text-emerald-300 ring-emerald-500/40` for `healthy`
- Status text: "Healthy" (capitalized from `incident.status`)
- Signals list uses healthy seeded signals

### 6.6 Agent Activity — Healthy Scenario Empty State
**File:** `src/components/agent-activity.tsx` (modify)

- When `snapshot.scenarioId === "healthy"` and `auditLog.length === 0`: show "System healthy. No agent activity recorded." instead of "Connected agents can inspect..."
- Reset button remains functional (calls `reset()`, which stays in current scenario)

---

## 7. File & Component Map

### 7.1 New Files
| Path | Purpose |
|------|---------|
| `src/lib/scenario.ts` | `ScenarioId` type export |
| `src/components/scenario-selector.tsx` | Accessible radio group for scenario switching |

### 7.2 Modified Files
| Path | Changes |
|------|---------|
| `src/lib/incident.ts` | Add `healthy` status and additive `INFO` severity type |
| `src/lib/operations.ts` | Add healthy incident/deployment seeds, `scenarioId` snapshot field, `NO_ACTION_REQUIRED`, `selectScenario`, `initialScenario`, and scenario-aware tool/policy logic |
| `src/lib/webmcp.ts` | No functional changes (tools already delegate to runtime) |
| `src/app/page.tsx` | Title "Day 4", add `<ScenarioSelector />` in intro section |
| `src/components/incident-dashboard.tsx` | Handle `healthy` status badge and signals |
| `src/components/webmcp-status.tsx` | Replace chip list with compact cards showing availability + policy reason |
| `src/components/policy-approval.tsx` | Hide approval UI in healthy scenario |
| `src/components/agent-activity.tsx` | Healthy empty state message |
| `src/types/webmcp.d.ts` | No changes (tool definitions unchanged) |

### 7.3 Test Files (Modified + New)
| Path | Changes |
|------|---------|
| `tests/operations.test.ts` | Add `selectScenario` tests, healthy scenario tool behavior, no-op switch, reset vs switch |
| `tests/incident.test.ts` | Verify additive incident status/severity types preserve the Day 3 seed contract |
| `tests/webmcp.test.ts` | Verify tool metadata unchanged; verify healthy scenario execution paths |
| `tests/scenario.test.ts` (new) | Scenario selector integration, accessibility, atomic switch, no-op |
| `tests/dashboard.test.tsx` | Healthy incident rendering, scenario selector presence |

---

## 8. Accessibility Requirements (WCAG 2.1 AA)

1. **Scenario Selector:**
   - Fieldset/legend grouping
   - Radio inputs with labels
   - `aria-live="polite"` announcement on change
   - Focus visible: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400`
   - Native radio-group arrow-key behavior; no custom keyboard handler

2. **Tool Cards:**
   - Semantic `<article>` or `<section>` per card
   - Badge text ("READ"/"MUTATE") not color-only
   - Availability dot + text not color-only
   - Policy reason has full text in `title` attribute

3. **General:**
   - All existing focus styles preserved
   - Color contrast ≥ 4.5:1 for all text
   - Scenario switch is synchronous and does not introduce animation

---

## 9. Test Specifications

### 9.1 Unit Tests (Runtime) — `tests/operations.test.ts`
```typescript
describe("selectScenario", () => {
  it("switches from incident to healthy atomically", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "incident" });
    runtime.proposeRollback({ deploymentId: "DEP-8821" });
    expect(runtime.getSnapshot().currentProposal).not.toBeNull();

    runtime.selectScenario("healthy");

    const snap = runtime.getSnapshot();
    expect(snap.auditLog).toHaveLength(0);
    expect(snap.currentProposal).toBeNull();
    expect(snap.currentApproval).toBeNull();
    expect(snap.currentExecution).toBeNull();
    expect(snap.incident.status).toBe("healthy");
    expect(snap.recentDeployments[0].deploymentId).toBe("DEP-9900");
  });

  it("switching to same scenario is a no-op (no notification, no audit)", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "incident" });
    const listener = vi.fn();
    runtime.subscribe(listener);

    runtime.selectScenario("incident");

    expect(listener).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().auditLog).toHaveLength(0);
  });

  it("notifies subscribers exactly once on actual switch", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "incident" });
    const listener = vi.fn();
    runtime.subscribe(listener);

    runtime.selectScenario("healthy");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("propose_rollback in healthy scenario rejects with NO_ACTION_REQUIRED", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "healthy" });

    expect(() => runtime.proposeRollback({ deploymentId: "DEP-9900" }))
      .toThrow(PolicyPilotInputError);
    expect(runtime.getSnapshot().auditLog[0].error.code).toBe("NO_ACTION_REQUIRED");
  });

  it("keeps malformed and unknown healthy proposal inputs invalid", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "healthy" });

    expect(() => runtime.proposeRollback({})).toThrow(PolicyPilotInputError);
    expect(() => runtime.proposeRollback({ deploymentId: "DEP-UNKNOWN" }))
      .toThrow(PolicyPilotInputError);
    expect(runtime.getSnapshot().auditLog.map((entry) =>
      entry.status === "error" ? entry.error.code : null,
    )).toEqual(["INVALID_ROLLBACK_INPUT", "INVALID_ROLLBACK_INPUT"]);
  });

  it("execute_approved_rollback in healthy scenario rejects with APPROVAL_REQUIRED", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "healthy" });

    expect(() => runtime.executeApprovedRollback({
      approvalId: "APR-INC-1042-DEP-8821",
      actionHash: "fnv1a-32:rollback-inc-1042-dep-8821-checkout-v2-checkout-v1",
    })).toThrow(PolicyPilotInputError);
    expect(runtime.getSnapshot().auditLog[0].error.code).toBe("APPROVAL_REQUIRED");
  });

  it("keeps malformed healthy execution input invalid", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "healthy" });

    expect(() => runtime.executeApprovedRollback({})).toThrow(PolicyPilotInputError);
    const [entry] = runtime.getSnapshot().auditLog;
    expect(entry.status === "error" ? entry.error.code : null)
      .toBe("INVALID_APPROVAL_INPUT");
  });

  it("getPolicyState in healthy scenario returns read/blocked with healthy explanation", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "healthy" });
    const state = runtime.getPolicyState();

    expect(state.phase).toBe("read");
    expect(state.executionAvailability).toBe("blocked");
    expect(state.explanation).toBe("System healthy; no mutation justified. Rollback not permitted.");
  });

  it("reset() in healthy scenario stays in healthy scenario", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "healthy" });
    runtime.reset();

    expect(runtime.getSnapshot().incident.status).toBe("healthy");
    expect(runtime.getSnapshot().recentDeployments[0].deploymentId).toBe("DEP-9900");
  });
});
```

### 9.2 Integration Tests — `tests/webmcp.test.ts`
- Verify all five tools still register with identical metadata
- Verify `propose_rollback` via WebMCP in healthy scenario returns `NO_ACTION_REQUIRED` error audit
- Verify `execute_approved_rollback` via WebMCP in healthy scenario returns `APPROVAL_REQUIRED` error audit

### 9.3 Component Tests — `tests/scenario.test.tsx`
```typescript
describe("ScenarioSelector", () => {
  it("renders two radio options with correct labels", () => {
    render(<ScenarioSelector />);
    expect(screen.getByLabelText("Active incident")).toBeInTheDocument();
    expect(screen.getByLabelText("Healthy system")).toBeInTheDocument();
  });

  it("announces scenario change via aria-live region", async () => {
    render(<ScenarioSelector />);
    const liveRegion = screen.getByRole("status", { name: /active scenario/i });
    fireEvent.click(screen.getByLabelText("Healthy system"));
    expect(liveRegion).toHaveTextContent("Healthy system");
  });

  it("calls runtime.selectScenario on change", () => {
    const selectSpy = vi.spyOn(policyPilotRuntime, "selectScenario");
    render(<ScenarioSelector />);
    fireEvent.click(screen.getByLabelText("Healthy system"));
    expect(selectSpy).toHaveBeenCalledWith("healthy");
  });

  it("exposes native radio semantics and checked state", () => {
    render(<ScenarioSelector />);
    const incidentRadio = screen.getByLabelText("Active incident");
    const healthyRadio = screen.getByLabelText("Healthy system");
    expect(incidentRadio).toHaveAttribute("type", "radio");
    expect(incidentRadio).toBeChecked();
    fireEvent.click(healthyRadio);
    expect(healthyRadio).toBeChecked();
  });
});
```

Browser verification must additionally prove native arrow-key movement between the two radios.

### 9.4 Dashboard Tests — `tests/dashboard.test.tsx`
- Healthy incident renders with emerald badge, correct signals
- WebMCP status shows compact cards (not chips) with availability + policy reason
- Policy approval shows only explanation in healthy scenario
- Agent activity shows healthy empty state

---

## 10. Non-Goals (Explicitly Out of Scope)

- ❌ New WebMCP tools or tool metadata changes
- ❌ Backend API, database, or persistence
- ❌ Authentication, authorization, or user identity
- ❌ Real deployment/rollback operations
- ❌ Dynamic tool registration/unregistration
- ❌ Multi-user collaboration (this is single-client demo)
- ❌ Scenario persistence across page reloads (runtime is in-memory)
- ❌ Animation/transition on scenario switch
- ❌ Third-party integrations
- ❌ Changes to `PolicyPilotToolName` union or tool count

---

## 11. Migration Compatibility

- **Existing tests pass unchanged** — `incident` scenario is default and preserves all Day 3 behavior
- **`policyPilotRuntime` singleton** — default `initialScenario: "incident"` maintains backward compatibility
- **No breaking changes to public runtime methods** — `reset()`, `subscribe()`, `getSnapshot()`, all tool methods unchanged
- **WebMCP registration** — identical promise resolution, identical tool definitions
- **TypeScript types** — only additive (`ScenarioId`, `NO_ACTION_REQUIRED`, `healthy` status, `selectScenario`)

---

## 12. Acceptance Criteria

| # | Criterion | Verification |
|---|-----------|--------------|
| 1 | Branch `feature/day4-collaboration-legibility` exists from `e9c9b2a` | `git log --oneline -1` |
| 2 | Spec file created at `docs/superpowers/specs/2026-08-29-day4-collaboration-legibility-design.md` | `ls docs/superpowers/specs/` |
| 3 | `ScenarioId` type exported from `src/lib/scenario.ts` | `grep -r "ScenarioId" src/lib/scenario.ts` |
| 4 | `selectScenario` method on runtime with atomic clear + single notify | Unit tests pass |
| 5 | Healthy seed values match §2.3 exactly | `tests/operations.test.ts` healthy snapshot/deployment tests |
| 6 | `propose_rollback` in healthy → `NO_ACTION_REQUIRED` audit error | Unit + WebMCP tests |
| 7 | `execute_approved_rollback` in healthy → `APPROVAL_REQUIRED` audit error | Unit + WebMCP tests |
| 8 | `getPolicyState` in healthy → `read`/`blocked`/healthy explanation | Unit test |
| 9 | Scenario selector in intro section, accessible, calls `selectScenario` | Component test |
| 10 | WebMCP status shows compact cards (not chips) with badge/availability/reason | Visual + component test |
| 11 | Policy approval hides approval UI in healthy scenario | Component test |
| 12 | Incident dashboard shows healthy badge + signals | Component test |
| 13 | Agent activity shows healthy empty state | Component test |
| 14 | Title reads "PolicyPilot / Day 4" | `grep "Day 4" src/app/page.tsx` |
| 15 | All existing Day 3 tests still pass | `npm run test` |
| 16 | No new WebMCP tools registered | `tests/webmcp.test.ts` metadata equality |
| 17 | No dynamic tool unregister | Code review: `registrations` WeakMap untouched |
| 18 | Commit message exactly: `docs: specify Day 4 collaboration scenarios` | `git log --format=%s -1` |

---

## 13. Self-Check Checklist

- [x] No unresolved placeholders in the spec
- [x] No contradictions between §2.2, §4.3, §5.1, and §5.2
- [x] Input validation and scenario-policy precedence are explicit
- [x] `selectScenario` no-op behavior is specified and testable
- [x] Reset vs switch behavior table is complete
- [x] All five tools are accounted for; no sixth tool is introduced
- [x] No backend, authentication, or real operations enter implementation scope
- [x] Accessibility requirements are specific and testable
- [x] Component/file map matches the current codebase
- [x] Acceptance criteria are binary
- [x] Commit message format matches exactly
- [x] The spec does not authorize pushing the branch

---

## 14. Commit Instruction

```bash
git add docs/superpowers/specs/2026-08-29-day4-collaboration-legibility-design.md
git commit -m "docs: specify Day 4 collaboration scenarios"
# Do NOT push
# Do NOT use model flags
```

Return the commit hash and a one-line summary upon completion.
