# Day 4 Collaboration Legibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit incident/healthy scenario selector that makes PolicyPilot's human-agent policy boundary understandable in thirty seconds while preserving the complete Day 3 workflow.

**Architecture:** Extend the single closure-owned `PolicyPilotRuntime` with deterministic scenario seeds and `selectScenario()`. All five WebMCP definitions remain unchanged and delegate to that runtime. React components subscribe to one snapshot containing `scenarioId`, then render scenario controls, health/no-op policy, and per-tool availability.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Testing Library, Tailwind CSS, WebMCP `document.modelContext.registerTool`.

**Spec:** `docs/superpowers/specs/2026-08-29-day4-collaboration-legibility-design.md`

## Global Constraints

- Work only on `feature/day4-collaboration-legibility`, based on Day 3 commit `e9c9b2a`.
- Use OpenCode for coding labor; never pass `-m`/`--model` or edit OpenCode configuration.
- Preserve every Day 3 incident, approval, audit, registration retry/idempotency, reset, and execution contract.
- Register exactly five tools in the existing order; do not change metadata or dynamically unregister tools.
- Keep one `policyPilotRuntime`; UI may call only runtime methods and must not own authority state.
- Healthy values are fixed: `OPS-HEALTHY-0001`, `INFO`, `healthy`, `DEP-9900`, `checkout-v3`, and policy text `System healthy; no mutation justified. Rollback not permitted.`
- Closed-input validation precedes scenario policy. Valid healthy proposal input yields `NO_ACTION_REQUIRED`; malformed/unknown proposal input remains `INVALID_ROLLBACK_INPUT`. Valid-shaped healthy execution yields `APPROVAL_REQUIRED`; malformed execution remains `INVALID_APPROVAL_INPUT`.
- Scenario changes and reset create no audit event and never change WebMCP registrations.
- Preserve semantic HTML, native radio keyboard behavior, focus-visible controls, and responsive single-column layout.
- Task workers commit and stop. They write a task report; a fresh read-only reviewer gates the diff before the next task.
- Do not push, merge, deploy, create a PR, or change visibility without new user authorization.

## File Responsibility Map

- `src/lib/scenario.ts`: `ScenarioId` only.
- `src/lib/incident.ts`: additive `healthy` status and `INFO` severity types; existing seed unchanged.
- `src/lib/operations.ts`: scenario seeds, runtime authority, snapshot, tool behavior.
- `src/components/scenario-selector.tsx`: local human scenario control.
- `src/components/{incident-dashboard,policy-approval,agent-activity}.tsx`: scenario presentation.
- `src/components/webmcp-status.tsx`: registration status and five tool cards.
- `src/app/page.tsx`: Day 4 composition.

---

### Task 1: Scenario-aware runtime and unchanged WebMCP surface

**Files:**
- Create: `src/lib/scenario.ts`
- Modify: `src/lib/incident.ts`
- Modify: `src/lib/operations.ts`
- Test: `tests/incident.test.ts`
- Test: `tests/operations.test.ts`
- Test: `tests/webmcp.test.ts`

**Interfaces:**
- Consumes: existing `PolicyPilotRuntime`, `PolicyPilotSnapshot`, five tool adapters, Day 3 seeds.
- Produces: `ScenarioId = "incident" | "healthy"`; `PolicyPilotSnapshot.scenarioId`; `PolicyPilotRuntime.selectScenario(scenarioId): void`; `PolicyPilotRuntimeOptions.initialScenario`; `NO_ACTION_REQUIRED`.

- [ ] **Step 1: Write failing runtime tests**

Add tests equivalent to:

```ts
const runtime = createPolicyPilotRuntime({ initialScenario: "incident" });
runtime.proposeRollback({ deploymentId: "DEP-8821" });
const listener = vi.fn();
runtime.subscribe(listener);
runtime.selectScenario("healthy");
expect(runtime.getSnapshot()).toMatchObject({
  scenarioId: "healthy",
  incident: { incidentId: "OPS-HEALTHY-0001", severity: "INFO", status: "healthy" },
  recentDeployments: [{ deploymentId: "DEP-9900", suspect: false }],
  currentProposal: null,
  currentApproval: null,
  currentExecution: null,
  auditLog: [],
  policy: { phase: "read", executionAvailability: "blocked" },
});
expect(listener).toHaveBeenCalledTimes(1);
```

Also prove: same-scenario selection is a no-op; reset stays in the selected scenario; event numbering restarts; snapshots remain frozen/stable; valid `DEP-9900` yields audited `NO_ACTION_REQUIRED`; `{}`/unknown deployment yields audited `INVALID_ROLLBACK_INPUT`; valid-shaped healthy execution yields `APPROVAL_REQUIRED`; `{}` yields `INVALID_APPROVAL_INPUT`; all Day 3 tests remain unchanged.

- [ ] **Step 2: Prove RED**

Run: `npm test -- tests/incident.test.ts tests/operations.test.ts tests/webmcp.test.ts`

Expected: FAIL because scenario types, snapshot field, method, healthy seeds, and error code do not exist.

- [ ] **Step 3: Implement the minimal runtime contract**

```ts
export type ScenarioId = "incident" | "healthy";

export interface PolicyPilotRuntimeOptions {
  now?: () => string;
  initialScenario?: ScenarioId;
}

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
```

Inside the runtime, keep `let currentScenario = options.initialScenario ?? "incident"`. Choose incident/deployment seeds from `currentScenario`. `selectScenario(id)` returns immediately for the current ID; otherwise set ID, clear audit/proposal/approval/execution, reset `nextEventNumber`, null the lazy incident, invalidate the cached snapshot, and call `notify()` once. `reset()` performs the same clear without changing `currentScenario`.

Validate proposal shape and the selected scenario's active deployment ID first. In healthy, valid `DEP-9900` throws `PolicyPilotInputError("NO_ACTION_REQUIRED", "System healthy; no rollback action required or permitted.")` inside `runTool`. Validate execution shape before checking approval.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- tests/incident.test.ts tests/operations.test.ts tests/webmcp.test.ts
npm test
npm run lint
npm run build
git add src/lib/scenario.ts src/lib/incident.ts src/lib/operations.ts tests/incident.test.ts tests/operations.test.ts tests/webmcp.test.ts
git commit -m "feat: add deterministic collaboration scenarios"
```

Write `.superpowers/sdd/day4-collaboration-legibility/task-1-report.md` with RED/GREEN evidence and commit hash. Fresh reviewer checks the spec and `HEAD^..HEAD`; Critical/Important findings must be fixed before Task 2.

---

### Task 2: Accessible selector and healthy-state collaboration UI

**Files:**
- Create: `src/components/scenario-selector.tsx`
- Create: `tests/scenario.test.tsx`
- Modify: `src/components/incident-dashboard.tsx`
- Modify: `src/components/policy-approval.tsx`
- Modify: `src/components/agent-activity.tsx`
- Modify: `tests/dashboard.test.tsx`

**Interfaces:**
- Consumes: `snapshot.scenarioId`, `runtime.selectScenario()`, healthy incident/policy values from Task 1.
- Produces: labeled native radio selector; healthy badge/signals; no approval/fingerprint in healthy; healthy activity empty state.

- [ ] **Step 1: Write failing component tests**

```tsx
render(<ScenarioSelector />);
expect(screen.getByRole("group", { name: "Collaboration scenario" })).toBeInTheDocument();
expect(screen.getByLabelText("Active incident")).toBeChecked();
fireEvent.click(screen.getByLabelText("Healthy system"));
expect(screen.getByLabelText("Healthy system")).toBeChecked();
expect(policyPilotRuntime.getSnapshot().scenarioId).toBe("healthy");
expect(screen.getByRole("status", { name: "Active scenario" }))
  .toHaveTextContent("Healthy system");
```

Add dashboard tests proving emerald healthy status, the two exact health signals, policy explanation only, absence of approval controls/fingerprint, healthy empty activity, and reset preserving healthy.

- [ ] **Step 2: Prove RED**

Run: `npm test -- tests/scenario.test.tsx tests/dashboard.test.tsx`

Expected: FAIL because the selector and scenario-specific rendering do not exist.

- [ ] **Step 3: Implement subscribed UI**

Use `useSyncExternalStore(policyPilotRuntime.subscribe, getSnapshot, getSnapshot)` in the selector. Render a `<fieldset>`/`<legend>`, two same-name native radio inputs, labels `Active incident` and `Healthy system`, focus-visible styles, and an `aria-live="polite"` status named `Active scenario`. Do not implement custom arrow-key handling.

Use `snapshot.scenarioId` in policy/activity components. Healthy policy renders only the exact explanation. Incident dashboard maps healthy status/severity/signals to emerald styles while preserving Day 3 amber behavior.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- tests/scenario.test.tsx tests/dashboard.test.tsx
npm test
npm run lint
npm run build
git add src/components/scenario-selector.tsx src/components/incident-dashboard.tsx src/components/policy-approval.tsx src/components/agent-activity.tsx tests/scenario.test.tsx tests/dashboard.test.tsx
git commit -m "feat: add human-selectable collaboration scenarios"
```

Write `task-2-report.md`; fresh reviewer verifies semantic controls, one snapshot source, no UI authority, and both scenario paths.

---

### Task 3: Five legible tool cards and Day 4 judge path

**Files:**
- Modify: `src/components/webmcp-status.tsx`
- Modify: `src/app/page.tsx`
- Modify: `tests/dashboard.test.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1 policy/scenario snapshot and Task 2 selector.
- Produces: exactly five cards with static existing metadata and derived availability; composed Day 4 page; judge instructions.

- [ ] **Step 1: Write failing tool-card/page tests**

Assert five semantic cards with exact existing tool names/descriptions and READ/MUTATE text. Assert availability rules: three reads always `Available`; proposal incident `Available`, healthy `No action required`; execution incident `Blocked`/`Available`/`Completed` by policy state and healthy always `Blocked`. Assert page title `PolicyPilot / Day 4` and selector presence.

- [ ] **Step 2: Prove RED**

Run: `npm test -- tests/dashboard.test.tsx`

Expected: FAIL because the status view still renders chips and the page is Day 3.

- [ ] **Step 3: Implement cards and integration**

Replace chips only after registration succeeds. Define one static five-item display descriptor array matching current WebMCP metadata; derive availability with a pure helper taking tool name and snapshot. Render semantic cards with textual READ/MUTATE and availability labels (not color-only), full policy text in `title`, responsive one-column/card grid. Add `<ScenarioSelector />` to the intro and update README with Day 4 scenario/judge steps. Do not change `src/lib/webmcp.ts`.

- [ ] **Step 4: Final verification and commit**

```bash
npm test -- tests/dashboard.test.tsx
npm test
npm run lint
npm run build
git add src/components/webmcp-status.tsx src/app/page.tsx tests/dashboard.test.tsx README.md
git commit -m "feat: make collaboration policy legible"
```

Run a production browser check: meaningful content, no overlay/console errors, five cards, native keyboard scenario switch, healthy no-op rejection, incident proposal/approval/execution, reset, and mobile-width layout. Write `task-3-report.md`; fresh final reviewer compares the complete spec range and requires zero Critical/Important findings.
