import { describe, expect, it, vi } from "vitest";
import {
  PolicyPilotInputError,
  createPolicyPilotRuntime,
  policyPilotRuntime,
  type PolicyPilotAuditSuccessEntry,
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
      "read_incident",
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
    expect(entry.toolName).toBe("read_incident");
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
