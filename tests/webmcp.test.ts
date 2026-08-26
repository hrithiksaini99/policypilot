import { describe, expect, it, vi } from "vitest";
import { getIncidentContext } from "@/lib/incident";
import { createPolicyPilotRuntime, PolicyPilotInputError } from "@/lib/operations";
import {
  registerIncidentContextTool,
  registerPolicyPilotTools,
} from "@/lib/webmcp";

const GET_INCIDENT_CONTEXT_METADATA = {
  name: "get_incident_context",
  title: "Get incident context",
  description:
    "Read the current PolicyPilot incident, service health signals, and investigation status.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, untrustedContentHint: false },
};

const LIST_RECENT_DEPLOYS_METADATA = {
  name: "list_recent_deploys",
  title: "List recent deploys",
  description:
    "List recent payments-api deployments and identify the active suspect rollout related to the incident.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, untrustedContentHint: false },
};

const PROPOSE_ROLLBACK_METADATA = {
  name: "propose_rollback",
  title: "Propose rollback",
  description:
    "Prepare a non-executing rollback preview for the active suspect deployment; human approval is still required.",
  inputSchema: {
    type: "object",
    properties: {
      deploymentId: { type: "string" },
    },
    required: ["deploymentId"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, untrustedContentHint: false },
};

const EXPECTED_TOOL_METADATA = [
  GET_INCIDENT_CONTEXT_METADATA,
  LIST_RECENT_DEPLOYS_METADATA,
  PROPOSE_ROLLBACK_METADATA,
];

function createRegisteredDocument() {
  const registerTool = vi.fn().mockResolvedValue(undefined);
  const targetDocument = { modelContext: { registerTool } } as unknown as Document;
  return { targetDocument, registerTool };
}

function createClockRuntime(timestamps: string[]) {
  let cursor = 0;
  return createPolicyPilotRuntime({
    now: () => timestamps[Math.min(cursor++, timestamps.length - 1)]!,
  });
}

function registeredToolsByName(registerTool: ReturnType<typeof vi.fn>) {
  return new Map(
    registerTool.mock.calls.map((call: unknown[]) => {
      const tool = call[0] as { name: string; execute: (input?: unknown) => Promise<unknown> };
      return [tool.name, tool];
    }),
  );
}

describe("registerPolicyPilotTools", () => {
  it("resolves unsupported without throwing when WebMCP is unavailable", async () => {
    await expect(registerPolicyPilotTools({} as Document)).resolves.toBe("unsupported");
    await expect(registerIncidentContextTool({} as Document)).resolves.toBe("unsupported");
  });

  it("registers exactly three tools with strict metadata in the required order", async () => {
    const { targetDocument, registerTool } = createRegisteredDocument();

    await expect(registerPolicyPilotTools(targetDocument)).resolves.toBe("registered");
    expect(registerTool).toHaveBeenCalledTimes(3);

    const metadata = registerTool.mock.calls.map((call: unknown[]) => {
      const tool = call[0] as Record<string, unknown>;
      expect(tool.execute).toBeTypeOf("function");
      const rest = { ...tool };
      delete rest.execute;
      return rest;
    });

    expect(metadata).toEqual(EXPECTED_TOOL_METADATA);
  });
});

describe("registerPolicyPilotTools execution and audit effects", () => {
  it("executes real callbacks against a fresh runtime with an injected clock", async () => {
    const runtime = createClockRuntime([
      "2026-08-26T12:00:00.000Z",
      "2026-08-26T12:05:00.000Z",
      "2026-08-26T12:10:00.000Z",
    ]);
    const { targetDocument, registerTool } = createRegisteredDocument();
    await registerPolicyPilotTools(targetDocument, runtime);

    const tools = registeredToolsByName(registerTool);

    const incident = await tools.get("get_incident_context")!.execute({});
    expect(incident).toEqual(getIncidentContext());

    const deploys = await tools.get("list_recent_deploys")!.execute({});
    expect(Array.isArray(deploys)).toBe(true);
    expect(deploys).toEqual(runtime.getSnapshot().recentDeployments);
    expect((deploys as { suspect: boolean }[]).some((d) => d.suspect)).toBe(true);

    const proposal = await tools.get("propose_rollback")!.execute({
      deploymentId: "DEP-8821",
    });
    expect(proposal).toMatchObject({
      deploymentId: "DEP-8821",
      incidentId: getIncidentContext().incidentId,
      requiresApproval: true,
      status: "awaiting_approval",
    });

    const snapshot = runtime.getSnapshot();
    expect(snapshot.currentProposal).toEqual(proposal);
    expect(snapshot.auditLog).toHaveLength(3);
    expect(
      snapshot.auditLog.map(({ toolName, status, timestamp }) => ({
        toolName,
        status,
        timestamp,
      })),
    ).toEqual([
      {
        toolName: "get_incident_context",
        status: "success",
        timestamp: "2026-08-26T12:00:00.000Z",
      },
      {
        toolName: "list_recent_deploys",
        status: "success",
        timestamp: "2026-08-26T12:05:00.000Z",
      },
      {
        toolName: "propose_rollback",
        status: "success",
        timestamp: "2026-08-26T12:10:00.000Z",
      },
    ]);
    expect(snapshot.auditLog[0]?.input).toBeUndefined();
    expect(snapshot.auditLog[1]?.input).toBeUndefined();
    expect(snapshot.auditLog[2]?.input).toEqual({ deploymentId: "DEP-8821" });
  });

  it("passes valid propose_rollback input through without coercion", async () => {
    const runtime = createClockRuntime(["2026-08-26T12:00:00.000Z"]);
    const { targetDocument, registerTool } = createRegisteredDocument();
    await registerPolicyPilotTools(targetDocument, runtime);

    const input = { deploymentId: "DEP-8821" };
    const result = await registeredToolsByName(registerTool)
      .get("propose_rollback")!
      .execute(input);

    expect(result).toMatchObject({ deploymentId: "DEP-8821" });
    expect(runtime.getSnapshot().auditLog[0]?.input).toEqual(input);
    expect(runtime.getSnapshot().auditLog[0]?.status).toBe("success");
  });

  it("rejects invalid propose_rollback inputs without coercion and records error audits", async () => {
    const runtime = createClockRuntime([
      "2026-08-26T12:00:00.000Z",
      "2026-08-26T12:01:00.000Z",
      "2026-08-26T12:02:00.000Z",
      "2026-08-26T12:03:00.000Z",
    ]);
    const { targetDocument, registerTool } = createRegisteredDocument();
    await registerPolicyPilotTools(targetDocument, runtime);

    const propose = registeredToolsByName(registerTool).get("propose_rollback")!;

    await expect(propose.execute({ deploymentId: "DEP-9999" })).rejects.toThrow(PolicyPilotInputError);
    await expect(propose.execute({ deploymentId: "DEP-8821", force: true })).rejects.toThrow(
      PolicyPilotInputError,
    );
    await expect(propose.execute({})).rejects.toThrow(PolicyPilotInputError);
    await expect(propose.execute("DEP-8821")).rejects.toThrow(PolicyPilotInputError);

    const snapshot = runtime.getSnapshot();
    const errors = snapshot.auditLog.filter((entry) => entry.status === "error");
    expect(errors).toHaveLength(4);
    expect(errors.every((entry) => entry.toolName === "propose_rollback")).toBe(true);
    expect(errors[0]?.error.code).toBe("INVALID_ROLLBACK_INPUT");
    expect(errors[3]?.input).toBe("DEP-8821");
    expect(snapshot.currentProposal).toBeNull();
  });
});

describe("registerPolicyPilotTools idempotency", () => {
  it("registers each tool once across repeated calls on the same document", async () => {
    const { targetDocument, registerTool } = createRegisteredDocument();

    await expect(registerPolicyPilotTools(targetDocument)).resolves.toBe("registered");
    await expect(registerPolicyPilotTools(targetDocument)).resolves.toBe("registered");

    expect(registerTool).toHaveBeenCalledTimes(3);
    const names = registerTool.mock.calls.map((call: unknown[]) => (call[0] as { name: string }).name);
    expect(new Set(names).size).toBe(3);
  });

  it("shares one in-flight registration across concurrent first calls on the same document", async () => {
    const { targetDocument, registerTool } = createRegisteredDocument();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    registerTool.mockImplementation(() => gate.then(() => undefined));

    const pending = Promise.all([
      registerPolicyPilotTools(targetDocument),
      registerPolicyPilotTools(targetDocument),
    ]);
    release();
    const states = await pending;

    expect(states).toEqual(["registered", "registered"]);
    expect(registerTool).toHaveBeenCalledTimes(3);
  });
});

describe("registerPolicyPilotTools failure recovery", () => {
  it("normalizes synchronous throws during registration into rejected promises", async () => {
    const registerTool = vi.fn(() => {
      throw new Error("sync registry failure");
    });
    const targetDocument = { modelContext: { registerTool } } as unknown as Document;

    await expect(registerPolicyPilotTools(targetDocument)).rejects.toThrow("sync registry failure");
  });

  it("normalizes asynchronous rejections during registration into rejected promises", async () => {
    const registerTool = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("async registry failure"));
    const targetDocument = { modelContext: { registerTool } } as unknown as Document;

    await expect(registerPolicyPilotTools(targetDocument)).rejects.toThrow("async registry failure");
  });

  it("keeps successful tools after partial failure and retries only the missing tool", async () => {
    const registerTool = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("registry offline"))
      .mockResolvedValueOnce(undefined);
    const targetDocument = { modelContext: { registerTool } } as unknown as Document;

    await expect(registerPolicyPilotTools(targetDocument)).rejects.toThrow("registry offline");
    expect(registerTool).toHaveBeenCalledTimes(3);

    await expect(registerPolicyPilotTools(targetDocument)).resolves.toBe("registered");

    expect(registerTool).toHaveBeenCalledTimes(4);
    const names = registerTool.mock.calls.map((call: unknown[]) => (call[0] as { name: string }).name);
    expect(names).toEqual([
      "get_incident_context",
      "list_recent_deploys",
      "propose_rollback",
      "propose_rollback",
    ]);

    const tools = registeredToolsByName(registerTool);
    await expect(tools.get("get_incident_context")!.execute({})).resolves.toEqual(
      getIncidentContext(),
    );
  });

  it("pins callbacks to the runtime supplied by the first registration attempt", async () => {
    const firstRuntime = createPolicyPilotRuntime();
    const secondRuntime = createPolicyPilotRuntime();
    const { targetDocument, registerTool } = createRegisteredDocument();

    await registerPolicyPilotTools(targetDocument, firstRuntime);
    await expect(registerPolicyPilotTools(targetDocument, secondRuntime)).resolves.toBe("registered");

    expect(registerTool).toHaveBeenCalledTimes(3);

    await registeredToolsByName(registerTool)
      .get("get_incident_context")!
      .execute({});

    expect(firstRuntime.getSnapshot().auditLog).toHaveLength(1);
    expect(secondRuntime.getSnapshot().auditLog).toHaveLength(0);
  });
});

describe("registerPolicyPilotTools document isolation", () => {
  it("keeps independent registration state per document", async () => {
    const first = createRegisteredDocument();
    const second = createRegisteredDocument();

    await expect(registerPolicyPilotTools(first.targetDocument)).resolves.toBe("registered");
    await expect(registerPolicyPilotTools(second.targetDocument)).resolves.toBe("registered");

    expect(first.registerTool).toHaveBeenCalledTimes(3);
    expect(second.registerTool).toHaveBeenCalledTimes(3);
  });
});

describe("registerIncidentContextTool legacy alias", () => {
  it("delegates to registerPolicyPilotTools and registers all three tools", async () => {
    const { targetDocument, registerTool } = createRegisteredDocument();

    await expect(registerIncidentContextTool(targetDocument)).resolves.toBe("registered");

    expect(registerTool).toHaveBeenCalledTimes(3);
    const names = registerTool.mock.calls.map((call: unknown[]) => (call[0] as { name: string }).name);
    expect(names).toEqual(["get_incident_context", "list_recent_deploys", "propose_rollback"]);
  });

  it("shares per-document state with registerPolicyPilotTools", async () => {
    const { targetDocument, registerTool } = createRegisteredDocument();

    await expect(registerIncidentContextTool(targetDocument)).resolves.toBe("registered");
    await expect(registerPolicyPilotTools(targetDocument)).resolves.toBe("registered");

    expect(registerTool).toHaveBeenCalledTimes(3);
  });
});
