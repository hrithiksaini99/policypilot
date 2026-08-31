import { describe, expect, it, vi } from "vitest";
import {
  PolicyPilotInputError,
  createPolicyPilotRuntime,
  policyPilotRuntime,
  type PolicyPilotAuditSuccessEntry,
  type PolicyPilotAuditErrorEntry,
  type PolicyPilotSnapshot,
  type RecentDeployment,
} from "@/lib/operations";
import { getIncidentContext } from "@/lib/incident";

vi.mock("@/lib/incident", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/incident")>();
  return { ...actual, getIncidentContext: vi.fn(actual.getIncidentContext) };
});

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const expectedDeployments: RecentDeployment[] = [
  {
    deploymentId: "DEP-8821",
    service: "payments-api",
    version: "checkout-v2",
    previousVersion: "checkout-v1",
    deployedAt: "2026-08-26T08:24:00.000Z",
    status: "active",
    suspect: true,
  },
  {
    deploymentId: "DEP-8817",
    service: "payments-api",
    version: "checkout-v1",
    previousVersion: "checkout-v0.9",
    deployedAt: "2026-08-25T16:10:00.000Z",
    status: "superseded",
    suspect: false,
  },
];

function createSequentialClock(...stamps: string[]): () => string {
  const baseMs = Date.parse(stamps[stamps.length - 1]);
  let calls = 0;
  return () => {
    const index = calls++;
    if (index < stamps.length) return stamps[index];
    return new Date(baseMs + (index - stamps.length + 1) * 60_000).toISOString();
  };
}

describe("listRecentDeploys", () => {
  it("returns the seeded deployments newest first", () => {
    const runtime = createPolicyPilotRuntime();

    expect(runtime.listRecentDeploys()).toEqual(expectedDeployments);
  });

  it("returns fresh defensive copies on every read", () => {
    const runtime = createPolicyPilotRuntime();
    const first = runtime.listRecentDeploys();
    const second = runtime.listRecentDeploys();

    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);

    (first[0] as Mutable<RecentDeployment>).deploymentId = "TAMPERED";

    expect(runtime.listRecentDeploys()).toEqual(expectedDeployments);
  });
});

describe("proposeRollback", () => {
  it("creates the exact deterministic rollback proposal for the active suspect deployment", () => {
    const runtime = createPolicyPilotRuntime();

    expect(runtime.proposeRollback({ deploymentId: "DEP-8821" })).toEqual({
      proposalId: "RB-INC-1042-DEP-8821",
      incidentId: "INC-1042",
      deploymentId: "DEP-8821",
      service: "payments-api",
      fromVersion: "checkout-v2",
      toVersion: "checkout-v1",
      reason: "Incident signals began six minutes after checkout-v2 reached 100%.",
      consequence: "Traffic would return to checkout-v1; no customer data would be modified.",
      requiresApproval: true,
      status: "awaiting_approval",
    });
  });

  it("repeating the valid proposal returns the same deterministic value while recording another event", () => {
    const runtime = createPolicyPilotRuntime();
    const first = runtime.proposeRollback({ deploymentId: "DEP-8821" });
    const second = runtime.proposeRollback({ deploymentId: "DEP-8821" });

    expect(second).toEqual(first);
    expect(second).not.toBe(first);

    (first as Mutable<typeof first>).proposalId = "TAMPERED";

    expect(runtime.getSnapshot().currentProposal?.proposalId).toBe(
      "RB-INC-1042-DEP-8821",
    );
    expect(runtime.getSnapshot().auditLog).toHaveLength(2);
  });

  it("buildRollbackProposal uses runtime-owned incident state, not imported getIncidentContext directly", () => {
    let callCount = 0;
    vi.mocked(getIncidentContext).mockImplementation(() => {
      callCount += 1;
      return {
        incidentId: callCount === 1 ? "INC-1042" : "INC-DIFFERENT",
        service: "payments-api",
        severity: "SEV-2" as const,
        status: "investigating" as const,
        summary: "Elevated 5xx errors after feature-flag rollout",
        startedAt: "2026-08-26T08:30:00.000Z",
        signals: ["signal 1", "signal 2"],
      };
    });

    const runtime = createPolicyPilotRuntime();
    const first = runtime.proposeRollback({ deploymentId: "DEP-8821" });
    const second = runtime.proposeRollback({ deploymentId: "DEP-8821" });

    expect(first.incidentId).toBe("INC-1042");
    expect(second.incidentId).toBe("INC-1042");
  });

  it.each([
    ["missing input entirely", undefined],
    ["null input", null],
    ["array input", [{ deploymentId: "DEP-8821" }]],
    ["object missing deploymentId", {}],
    ["non-string deploymentId", { deploymentId: 8821 }],
    ["unknown deploymentId", { deploymentId: "DEP-9999" }],
    ["extra fields alongside deploymentId", { deploymentId: "DEP-8821", force: true }],
  ])("rejects %s with PolicyPilotInputError", (_label, input) => {
    const runtime = createPolicyPilotRuntime();

    let caught: unknown;
    try {
      runtime.proposeRollback(input);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PolicyPilotInputError);
    const inputError = caught as PolicyPilotInputError;
    expect(inputError.code).toBe("INVALID_ROLLBACK_INPUT");
    expect(inputError.message).toMatch(/deploymentId/i);
    expect(inputError.message).toMatch(/active suspect deployment/i);
    expect(runtime.getSnapshot().currentProposal).toBeNull();
  });
});

describe("audit log", () => {
  it("records one success entry per tool call with injected timestamps and sequential ids", () => {
    const stamps = [
      "2026-08-26T09:00:00.000Z",
      "2026-08-26T09:01:00.000Z",
      "2026-08-26T09:02:00.000Z",
    ];
    const runtime = createPolicyPilotRuntime({ now: createSequentialClock(...stamps) });
    const incident = runtime.readIncident();
    const deployments = runtime.listRecentDeploys();
    const proposal = runtime.proposeRollback({ deploymentId: "DEP-8821" });

    const snapshot = runtime.getSnapshot();
    expect(snapshot.auditLog.map((entry) => entry.eventId)).toEqual([
      "EVT-0001",
      "EVT-0002",
      "EVT-0003",
    ]);
    expect(snapshot.auditLog.map((entry) => entry.timestamp)).toEqual(stamps);
    expect(snapshot.auditLog.map((entry) => entry.toolName)).toEqual([
      "get_incident_context",
      "list_recent_deploys",
      "propose_rollback",
    ]);
    expect(snapshot.auditLog.every((entry) => entry.status === "success")).toBe(true);

    const successEntries = snapshot.auditLog.filter(
      (entry): entry is PolicyPilotAuditSuccessEntry => entry.status === "success",
    );
    expect(successEntries).toHaveLength(3);
    expect(successEntries[0].result).toEqual(incident);
    expect(successEntries[0].result).not.toBe(incident);
    expect(successEntries[1].result).toEqual(deployments);
    expect(successEntries[2].result).toEqual(proposal);

    for (const entry of snapshot.auditLog) {
      expect(Object.isFrozen(entry)).toBe(true);
      if (entry.status === "success") {
        expect(Object.isFrozen(entry.result)).toBe(true);
      }
    }
  });

  it("logs an error entry before throwing for invalid input", () => {
    const runtime = createPolicyPilotRuntime({
      now: createSequentialClock("2026-08-26T09:05:00.000Z"),
    });

    let caught: unknown;
    try {
      runtime.proposeRollback({});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PolicyPilotInputError);

    const snapshot = runtime.getSnapshot();
    expect(snapshot.auditLog).toHaveLength(1);
    const [entry] = snapshot.auditLog;
    expect(entry.eventId).toBe("EVT-0001");
    expect(entry.timestamp).toBe("2026-08-26T09:05:00.000Z");
    expect(entry.toolName).toBe("propose_rollback");
    expect(entry.input).toEqual({});
    if (entry.status !== "error") {
      throw new Error("Expected an error audit entry.");
    }
    expect(entry.error).toEqual({
      code: "INVALID_ROLLBACK_INPUT",
      message: expect.stringMatching(/active suspect deployment/i),
    });
  });

  it("audits unexpected tool failures with a neutral internal code, not a validation code", () => {
    const runtime = createPolicyPilotRuntime({
      now: createSequentialClock("2026-08-26T09:10:00.000Z"),
    });
    vi.mocked(getIncidentContext).mockImplementationOnce(() => {
      throw new Error("incident store unavailable");
    });

    let caught: unknown;
    try {
      runtime.readIncident();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(PolicyPilotInputError);
    expect((caught as Error).message).toBe("incident store unavailable");

    const [entry] = runtime.getSnapshot().auditLog;
    if (entry.status !== "error") {
      throw new Error("Expected an error audit entry.");
    }
    expect(entry.toolName).toBe("get_incident_context");
    expect(entry.error.code).toBe("INTERNAL_TOOL_ERROR");
    expect(entry.error.message).toBe("incident store unavailable");
  });

  it("keeps the incident in investigating state and stores a successful proposal on the snapshot", () => {
    const runtime = createPolicyPilotRuntime();
    const proposal = runtime.proposeRollback({ deploymentId: "DEP-8821" });

    const snapshot = runtime.getSnapshot();
    expect(snapshot.currentProposal).toEqual(proposal);
    expect(snapshot.incident.status).toBe("investigating");
    expect(snapshot.incident).toEqual(getIncidentContext());
  });
});

describe("subscribers", () => {
  it("notifies subscribers exactly once per tool call and honors unsubscribe", () => {
    const runtime = createPolicyPilotRuntime();
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = runtime.subscribe(first);
    runtime.subscribe(second);

    runtime.readIncident();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    runtime.listRecentDeploys();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("notifies subscribers once when an invalid tool attempt is logged", () => {
    const runtime = createPolicyPilotRuntime();
    const listener = vi.fn();
    runtime.subscribe(listener);

    expect(() => runtime.proposeRollback(null)).toThrow(PolicyPilotInputError);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("publishes the new proposal to snapshots read inside subscribers during notification", () => {
    const runtime = createPolicyPilotRuntime();
    let observedDuringNotification: unknown;

    runtime.subscribe(() => {
      observedDuringNotification = runtime.getSnapshot().currentProposal;
    });

    const proposal = runtime.proposeRollback({ deploymentId: "DEP-8821" });

    expect(observedDuringNotification).toEqual(proposal);
    expect(runtime.getSnapshot().currentProposal).toEqual(proposal);
  });

  it("exposes closure-safe methods that work detached from the runtime object", () => {
    const runtime = createPolicyPilotRuntime();
    const { readIncident, getSnapshot, proposeRollback } = runtime;

    readIncident();
    proposeRollback({ deploymentId: "DEP-8821" });

    expect(getSnapshot().auditLog).toHaveLength(2);
  });
});

describe("getSnapshot", () => {
  it("returns the same frozen snapshot until state changes, then a new frozen snapshot", () => {
    const runtime = createPolicyPilotRuntime();

    const before = runtime.getSnapshot();
    expect(Object.isFrozen(before)).toBe(true);
    expect(runtime.getSnapshot()).toBe(before);

    runtime.readIncident();

    const after = runtime.getSnapshot();
    expect(after).not.toBe(before);
    expect(Object.isFrozen(after)).toBe(true);
    expect(after.auditLog).toHaveLength(1);
    expect(before.auditLog).toHaveLength(0);
  });

  it("freezes nested structures so they cannot mutate runtime state", () => {
    const runtime = createPolicyPilotRuntime();
    runtime.proposeRollback({ deploymentId: "DEP-8821" });

    const snapshot: PolicyPilotSnapshot = runtime.getSnapshot();
    expect(Object.isFrozen(snapshot.recentDeployments)).toBe(true);
    expect(Object.isFrozen(snapshot.auditLog)).toBe(true);
    expect(Object.isFrozen(snapshot.recentDeployments[0])).toBe(true);
    expect(Object.isFrozen(snapshot.currentProposal)).toBe(true);

    const forged: RecentDeployment = { ...expectedDeployments[0], deploymentId: "FORGED" };
    expect(() =>
      (snapshot.recentDeployments as unknown as RecentDeployment[]).push(forged),
    ).toThrow(TypeError);

    expect(runtime.listRecentDeploys()).toHaveLength(2);
  });
});

describe("reset", () => {
  it("clears the proposal and audit log and restarts event ids", () => {
    const runtime = createPolicyPilotRuntime({
      now: createSequentialClock("2026-08-26T10:00:00.000Z"),
    });
    runtime.readIncident();
    runtime.proposeRollback({ deploymentId: "DEP-8821" });
    expect(runtime.getSnapshot().auditLog).toHaveLength(2);

    runtime.reset();

    const snapshot = runtime.getSnapshot();
    expect(snapshot.auditLog).toHaveLength(0);
    expect(snapshot.currentProposal).toBeNull();

    runtime.proposeRollback({ deploymentId: "DEP-8821" });
    expect(runtime.getSnapshot().auditLog[0].eventId).toBe("EVT-0001");
  });

  it("notifies subscribers once even when state is already empty without creating an audit entry", () => {
    const runtime = createPolicyPilotRuntime();
    const listener = vi.fn();
    runtime.subscribe(listener);

    runtime.reset();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot().auditLog).toHaveLength(0);
    expect(runtime.getSnapshot().currentProposal).toBeNull();
  });
});

describe("policyPilotRuntime singleton", () => {
  it("exposes the full public contract", () => {
    expect(typeof policyPilotRuntime.readIncident).toBe("function");
    expect(typeof policyPilotRuntime.listRecentDeploys).toBe("function");
    expect(typeof policyPilotRuntime.proposeRollback).toBe("function");
    expect(typeof policyPilotRuntime.getSnapshot).toBe("function");
    expect(typeof policyPilotRuntime.subscribe).toBe("function");
    expect(typeof policyPilotRuntime.reset).toBe("function");

    const snapshot = policyPilotRuntime.getSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.recentDeployments).toEqual(expectedDeployments);
  });
});

describe("policy phase and approval/execution runtime", () => {
  it("getPolicyState produces a success audit event named get_policy_state and returns state", () => {
    const stamps = ["2026-08-28T09:00:00.000Z", "2026-08-28T09:01:00.000Z"];
    const runtime = createPolicyPilotRuntime({ now: createSequentialClock(...stamps) });
    const state = runtime.getPolicyState();

    expect(state.phase).toBe("read");
    expect(state.executionAvailability).toBe("blocked");

    const snapshot = runtime.getSnapshot();
    const policyStateEntries = snapshot.auditLog.filter(
      (e): e is PolicyPilotAuditSuccessEntry => e.toolName === "get_policy_state" && e.status === "success"
    );
    expect(policyStateEntries).toHaveLength(1);
    expect(policyStateEntries[0].eventId).toBe("EVT-0001");
    expect(policyStateEntries[0].timestamp).toBe(stamps[0]);
    expect(policyStateEntries[0].toolName).toBe("get_policy_state");
    expect(policyStateEntries[0].input).toBeUndefined();
    expect(policyStateEntries[0].result).toEqual(state);
    expect(policyStateEntries[0].result).not.toBe(state);
  });

  it("getSnapshot does not create audit entries or notifications recursively", () => {
    const runtime = createPolicyPilotRuntime({ now: () => "2026-08-28T09:00:00.000Z" });
    runtime.getPolicyState(); // Creates EVT-0001

    const beforeCount = runtime.getSnapshot().auditLog.length;
    let notifyCount = 0;
    const unsubscribe = runtime.subscribe(() => { notifyCount++; });

    // Multiple getSnapshot calls should not create new audit entries or notifications
    runtime.getSnapshot();
    runtime.getSnapshot();
    runtime.getSnapshot();

    expect(runtime.getSnapshot().auditLog).toHaveLength(beforeCount);
    expect(notifyCount).toBe(0);

    unsubscribe();
  });

  it("starts in read phase with blocked execution availability", () => {
    const runtime = createPolicyPilotRuntime({ now: () => "2026-08-28T09:00:00.000Z" });
    const state = runtime.getPolicyState();

    expect(state.phase).toBe("read");
    expect(state.executionAvailability).toBe("blocked");
    expect(state.inspectionAllowed).toBe(true);
    expect(state.draftAllowed).toBe(true);
    expect(state.executionRequiresHumanApproval).toBe(true);
    expect(state.explanation).toContain("human approval");
  });

  it("proposeRollback moves policy to approval_required", () => {
    const runtime = createPolicyPilotRuntime({ now: () => "2026-08-28T09:01:00.000Z" });
    runtime.proposeRollback({ deploymentId: "DEP-8821" });
    const state = runtime.getPolicyState();

    expect(state.phase).toBe("approval_required");
    expect(state.executionAvailability).toBe("blocked");
    expect(state.explanation).toContain("human approval");
  });

  it("human approval moves policy to approved/available", () => {
    const runtime = createPolicyPilotRuntime({ now: () => "2026-08-28T09:02:00.000Z" });
    runtime.proposeRollback({ deploymentId: "DEP-8821" });
    const approval = runtime.approveCurrentProposal();
    const state = runtime.getPolicyState();

    expect(state.phase).toBe("approved");
    expect(state.executionAvailability).toBe("available");
    expect(state.explanation).toContain("awaiting execution");
    expect(approval.approvalId).toBe("APR-INC-1042-DEP-8821");
    expect(approval.actionHash).toBe("fnv1a-32:rollback-inc-1042-dep-8821-checkout-v2-checkout-v1");
    expect(approval.status).toBe("approved");
  });

  it("rejects execution before human approval and audits the failure", () => {
    const runtime = createPolicyPilotRuntime({ now: () => "2026-08-28T09:00:00.000Z" });
    runtime.proposeRollback({ deploymentId: "DEP-8821" });

    expect(() => runtime.executeApprovedRollback({
      approvalId: "APR-INC-1042-DEP-8821",
      actionHash: "fnv1a-32:rollback-inc-1042-dep-8821-checkout-v2-checkout-v1",
    })).toThrow(PolicyPilotInputError);

    expect(runtime.getSnapshot().auditLog.at(-1)).toMatchObject({
      toolName: "execute_approved_rollback",
      status: "error",
      error: { code: "APPROVAL_REQUIRED" },
    });
  });

  it("binds approval and execution to the exact proposal", () => {
    const runtime = createPolicyPilotRuntime({ now: () => "2026-08-28T09:01:00.000Z" });
    runtime.proposeRollback({ deploymentId: "DEP-8821" });
    const approval = runtime.approveCurrentProposal();

    expect(approval).toMatchObject({
      approvalId: "APR-INC-1042-DEP-8821",
      actionHash: "fnv1a-32:rollback-inc-1042-dep-8821-checkout-v2-checkout-v1",
    });
    expect(() => runtime.executeApprovedRollback({
      approvalId: approval.approvalId,
      actionHash: "wrong",
    })).toThrow(PolicyPilotInputError);
  });

  it("executes once, updates health, and reset restores the initial state", () => {
    const runtime = createPolicyPilotRuntime({ now: () => "2026-08-28T09:02:00.000Z" });
    runtime.proposeRollback({ deploymentId: "DEP-8821" });
    const approval = runtime.approveCurrentProposal();
    const execution = runtime.executeApprovedRollback({
      approvalId: approval.approvalId,
      actionHash: approval.actionHash,
    });

    expect(execution).toMatchObject({ executionId: "EXE-INC-1042-DEP-8821", status: "completed" });
    expect(runtime.readIncident()).toMatchObject({ status: "mitigated" });
    expect(() => runtime.executeApprovedRollback({
      approvalId: approval.approvalId,
      actionHash: approval.actionHash,
    })).toThrow(PolicyPilotInputError);
    runtime.reset();
    expect(runtime.getSnapshot()).toMatchObject({
      policy: { phase: "read", executionAvailability: "blocked" },
      currentProposal: null,
      currentApproval: null,
      currentExecution: null,
      auditLog: [],
      incident: { status: "investigating" },
    });
  });

  it("rejects malformed approval input and audits the failure", () => {
    const runtime = createPolicyPilotRuntime({ now: () => "2026-08-28T09:03:00.000Z" });

    expect(() => runtime.executeApprovedRollback({})).toThrow(PolicyPilotInputError);
    expect(() => runtime.executeApprovedRollback({ approvalId: "APR-INC-1042-DEP-8821" })).toThrow(PolicyPilotInputError);
    expect(() => runtime.executeApprovedRollback({ actionHash: "fnv1a-32:..." })).toThrow(PolicyPilotInputError);
    expect(() => runtime.executeApprovedRollback({ approvalId: "APR-INC-1042-DEP-8821", actionHash: "fnv1a-32:...", extra: true })).toThrow(PolicyPilotInputError);

    const snapshot = runtime.getSnapshot();
    const errorEntries = snapshot.auditLog.filter(
      (e): e is PolicyPilotAuditErrorEntry => e.toolName === "execute_approved_rollback" && e.status === "error"
    );
    expect(errorEntries).toHaveLength(4);
    for (const entry of errorEntries) {
      expect(entry.error.code).toBe("INVALID_APPROVAL_INPUT");
    }
  });

  it("rejects execution with no pending proposal and audits the failure", () => {
    const runtime = createPolicyPilotRuntime({ now: () => "2026-08-28T09:04:00.000Z" });

    expect(() => runtime.executeApprovedRollback({
      approvalId: "APR-INC-1042-DEP-8821",
      actionHash: "fnv1a-32:rollback-inc-1042-dep-8821-checkout-v2-checkout-v1",
    })).toThrow(PolicyPilotInputError);

    expect(runtime.getSnapshot().auditLog.at(-1)).toMatchObject({
      toolName: "execute_approved_rollback",
      status: "error",
      error: { code: "APPROVAL_REQUIRED" },
    });
  });

  it("rejects mismatched approval ID and audits the failure", () => {
    const runtime = createPolicyPilotRuntime({ now: () => "2026-08-28T09:05:00.000Z" });
    runtime.proposeRollback({ deploymentId: "DEP-8821" });
    runtime.approveCurrentProposal();

    expect(() => runtime.executeApprovedRollback({
      approvalId: "APR-WRONG",
      actionHash: "fnv1a-32:rollback-inc-1042-dep-8821-checkout-v2-checkout-v1",
    })).toThrow(PolicyPilotInputError);

    expect(runtime.getSnapshot().auditLog.at(-1)).toMatchObject({
      toolName: "execute_approved_rollback",
      status: "error",
      error: { code: "APPROVAL_MISMATCH" },
    });
  });

  it("rejects mismatched action hash and audits the failure", () => {
    const runtime = createPolicyPilotRuntime({ now: () => "2026-08-28T09:06:00.000Z" });
    runtime.proposeRollback({ deploymentId: "DEP-8821" });
    const approval = runtime.approveCurrentProposal();

    expect(() => runtime.executeApprovedRollback({
      approvalId: approval.approvalId,
      actionHash: "fnv1a-32:wrong-hash",
    })).toThrow(PolicyPilotInputError);

    expect(runtime.getSnapshot().auditLog.at(-1)).toMatchObject({
      toolName: "execute_approved_rollback",
      status: "error",
      error: { code: "APPROVAL_MISMATCH" },
    });
  });

  it("rejects repeat execution and audits the failure", () => {
    const runtime = createPolicyPilotRuntime({ now: () => "2026-08-28T09:07:00.000Z" });
    runtime.proposeRollback({ deploymentId: "DEP-8821" });
    const approval = runtime.approveCurrentProposal();
    runtime.executeApprovedRollback({ approvalId: approval.approvalId, actionHash: approval.actionHash });

    expect(() => runtime.executeApprovedRollback({
      approvalId: approval.approvalId,
      actionHash: approval.actionHash,
    })).toThrow(PolicyPilotInputError);

    expect(runtime.getSnapshot().auditLog.at(-1)).toMatchObject({
      toolName: "execute_approved_rollback",
      status: "error",
      error: { code: "ROLLBACK_ALREADY_EXECUTED" },
    });
  });

  it("approveCurrentProposal does not append an audit entry", () => {
    const runtime = createPolicyPilotRuntime({ now: () => "2026-08-28T09:08:00.000Z" });
    runtime.proposeRollback({ deploymentId: "DEP-8821" });
    const beforeCount = runtime.getSnapshot().auditLog.length;

    runtime.approveCurrentProposal();

    expect(runtime.getSnapshot().auditLog).toHaveLength(beforeCount);
  });

  it("snapshots stay frozen and referentially stable until a genuine change", () => {
    const runtime = createPolicyPilotRuntime({ now: () => "2026-08-28T09:09:00.000Z" });
    runtime.proposeRollback({ deploymentId: "DEP-8821" });

    const snap1 = runtime.getSnapshot();
    const snap2 = runtime.getSnapshot();
    expect(snap1).toBe(snap2);
    expect(Object.isFrozen(snap1)).toBe(true);
    expect(Object.isFrozen(snap1.policy)).toBe(true);
    expect(Object.isFrozen(snap1.currentApproval)).toBe(true);
    expect(Object.isFrozen(snap1.currentExecution)).toBe(true);

    runtime.approveCurrentProposal();

    const snap3 = runtime.getSnapshot();
    expect(snap3).not.toBe(snap1);
    expect(snap3.policy.phase).toBe("approved");
    expect(snap3.currentApproval).not.toBeNull();
  });
});

describe("scenario-aware runtime", () => {
  it("starts with incident scenario by default", () => {
    const runtime = createPolicyPilotRuntime();
    expect(runtime.getSnapshot().scenarioId).toBe("incident");
  });

  it("starts with healthy scenario when initialScenario is healthy", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "healthy" });
    expect(runtime.getSnapshot().scenarioId).toBe("healthy");
    expect(runtime.getSnapshot().incident.incidentId).toBe("OPS-HEALTHY-0001");
    expect(runtime.getSnapshot().incident.severity).toBe("INFO");
    expect(runtime.getSnapshot().incident.status).toBe("healthy");
    expect(runtime.getSnapshot().recentDeployments).toHaveLength(2);
    expect(runtime.getSnapshot().recentDeployments[0]).toMatchObject({
      deploymentId: "DEP-9900",
      version: "checkout-v3",
      previousVersion: "checkout-v2",
      deployedAt: "2026-08-29T08:00:00.000Z",
      status: "active",
      suspect: false,
    });
    expect(runtime.getSnapshot().recentDeployments[1]).toMatchObject({
      deploymentId: "DEP-9890",
      version: "checkout-v2",
      previousVersion: "checkout-v1",
      deployedAt: "2026-08-28T16:10:00.000Z",
      status: "active",
      suspect: false,
    });
  });

  it("selectScenario switches to healthy and clears state", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "incident" });
    runtime.proposeRollback({ deploymentId: "DEP-8821" });
    const listener = vi.fn();
    runtime.subscribe(listener);
    runtime.selectScenario("healthy");

    expect(runtime.getSnapshot()).toMatchObject({
      scenarioId: "healthy",
      incident: { incidentId: "OPS-HEALTHY-0001", severity: "INFO", status: "healthy" },
      recentDeployments: [
        { deploymentId: "DEP-9900", version: "checkout-v3", previousVersion: "checkout-v2", suspect: false },
        { deploymentId: "DEP-9890", version: "checkout-v2", previousVersion: "checkout-v1", suspect: false },
      ],
      currentProposal: null,
      currentApproval: null,
      currentExecution: null,
      auditLog: [],
      policy: { phase: "read", executionAvailability: "blocked" },
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("selectScenario to same scenario is a no-op", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "incident" });
    const listener = vi.fn();
    runtime.subscribe(listener);
    runtime.selectScenario("incident");

    expect(listener).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().scenarioId).toBe("incident");
  });

  it("reset stays in the selected scenario", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "healthy" });
    // In healthy, proposeRollback throws NO_ACTION_REQUIRED, creating an error audit entry
    let caught: unknown;
    try {
      runtime.proposeRollback({ deploymentId: "DEP-9900" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PolicyPilotInputError);
    expect((caught as PolicyPilotInputError).code).toBe("NO_ACTION_REQUIRED");
    expect(runtime.getSnapshot().auditLog).toHaveLength(1);

    runtime.reset();

    expect(runtime.getSnapshot().scenarioId).toBe("healthy");
    expect(runtime.getSnapshot().currentProposal).toBeNull();
    expect(runtime.getSnapshot().auditLog).toHaveLength(0);
  });

  it("event numbering restarts on scenario switch", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "incident" });
    runtime.readIncident();
    runtime.selectScenario("healthy");
    runtime.readIncident();

    const auditLog = runtime.getSnapshot().auditLog;
    // After selectScenario, audit log is cleared, so only the second readIncident remains
    expect(auditLog).toHaveLength(1);
    expect(auditLog[0].eventId).toBe("EVT-0001");
  });

  it("snapshots remain frozen and stable", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "healthy" });
    const snap1 = runtime.getSnapshot();
    const snap2 = runtime.getSnapshot();
    expect(snap1).toBe(snap2);
    expect(Object.isFrozen(snap1)).toBe(true);
  });

  it("valid DEP-9900 in healthy yields audited NO_ACTION_REQUIRED", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "healthy" });

    let caught: unknown;
    try {
      runtime.proposeRollback({ deploymentId: "DEP-9900" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PolicyPilotInputError);
    expect((caught as PolicyPilotInputError).code).toBe("NO_ACTION_REQUIRED");
    const auditLog = runtime.getSnapshot().auditLog;
    expect(auditLog).toHaveLength(1);
    expect(auditLog[0].status).toBe("error");
    if (auditLog[0].status === "error") {
      expect(auditLog[0].error.code).toBe("NO_ACTION_REQUIRED");
    }
  });

  it("unknown deployment in healthy yields audited INVALID_ROLLBACK_INPUT", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "healthy" });

    let caught: unknown;
    try {
      runtime.proposeRollback({ deploymentId: "DEP-9999" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PolicyPilotInputError);
    expect((caught as PolicyPilotInputError).code).toBe("INVALID_ROLLBACK_INPUT");
  });

  it("empty input in healthy yields audited INVALID_ROLLBACK_INPUT", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "healthy" });

    let caught: unknown;
    try {
      runtime.proposeRollback({});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PolicyPilotInputError);
    expect((caught as PolicyPilotInputError).code).toBe("INVALID_ROLLBACK_INPUT");
  });

  it("valid-shaped execution in healthy yields APPROVAL_REQUIRED", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "healthy" });
    // In healthy, no proposal can be created (DEP-9900 throws NO_ACTION_REQUIRED),
    // so executing without approval should yield APPROVAL_REQUIRED

    let caught: unknown;
    try {
      runtime.executeApprovedRollback({
        approvalId: "APR-OPS-HEALTHY-0001-DEP-9900",
        actionHash: "fnv1a-32:rollback-ops-healthy-0001-dep-9900-checkout-v2-checkout-v1",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PolicyPilotInputError);
    expect((caught as PolicyPilotInputError).code).toBe("APPROVAL_REQUIRED");
  });

  it("empty execution input yields INVALID_APPROVAL_INPUT", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "healthy" });

    let caught: unknown;
    try {
      runtime.executeApprovedRollback({});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PolicyPilotInputError);
    expect((caught as PolicyPilotInputError).code).toBe("INVALID_APPROVAL_INPUT");
  });

  it("getPolicyState in healthy scenario returns read/blocked with healthy explanation", () => {
    const runtime = createPolicyPilotRuntime({ initialScenario: "healthy" });
    const state = runtime.getPolicyState();

    expect(state.phase).toBe("read");
    expect(state.executionAvailability).toBe("blocked");
    expect(state.inspectionAllowed).toBe(true);
    expect(state.draftAllowed).toBe(true);
    expect(state.executionRequiresHumanApproval).toBe(true);
    expect(state.explanation).toBe("System healthy; no mutation justified. Rollback not permitted.");

    const snapshot = runtime.getSnapshot();
    const policyStateEntries = snapshot.auditLog.filter(
      (e): e is PolicyPilotAuditSuccessEntry => e.toolName === "get_policy_state" && e.status === "success"
    );
    expect(policyStateEntries).toHaveLength(1);
    expect(policyStateEntries[0].result).toEqual(state);
  });
});
