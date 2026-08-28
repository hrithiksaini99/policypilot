import {
  policyPilotRuntime,
  type PolicyPilotRuntime,
} from "@/lib/operations";

export type WebMCPRegistrationState = "registered" | "unsupported";

interface RegistrationEntry {
  readonly registeredNames: Set<string>;
  readonly runtime: PolicyPilotRuntime;
  pending: Promise<WebMCPRegistrationState> | null;
}

const registrations = new WeakMap<Document, RegistrationEntry>();

const EMPTY_OBJECT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const PROPOSE_ROLLBACK_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    deploymentId: { type: "string" },
  },
  required: ["deploymentId"],
  additionalProperties: false,
};

const EXECUTE_APPROVED_ROLLBACK_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: { approvalId: { type: "string" }, actionHash: { type: "string" } },
  required: ["approvalId", "actionHash"],
  additionalProperties: false,
};

function buildToolDefinitions(runtime: PolicyPilotRuntime) {
  return [
    {
      name: "get_incident_context",
      title: "Get incident context",
      description:
        "Read the current PolicyPilot incident, service health signals, and investigation status.",
      inputSchema: EMPTY_OBJECT_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => runtime.readIncident(),
    },
    {
      name: "list_recent_deploys",
      title: "List recent deploys",
      description:
        "List recent payments-api deployments and identify the active suspect rollout related to the incident.",
      inputSchema: EMPTY_OBJECT_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => runtime.listRecentDeploys(),
    },
    {
      name: "get_policy_state",
      title: "Get policy state",
      description: "Read the current PolicyPilot guardrail state and whether rollback execution is available.",
      inputSchema: EMPTY_OBJECT_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => runtime.getPolicyState(),
    },
    {
      name: "propose_rollback",
      title: "Propose rollback",
      description:
        "Prepare a non-executing rollback preview for the active suspect deployment; human approval is still required.",
      inputSchema: PROPOSE_ROLLBACK_SCHEMA,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input: Record<string, unknown>) => runtime.proposeRollback(input),
    },
    {
      name: "execute_approved_rollback",
      title: "Execute approved rollback",
      description: "Execute the exact simulated rollback only when a human-approved approval ID and action fingerprint match the pending proposal.",
      inputSchema: EXECUTE_APPROVED_ROLLBACK_SCHEMA,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input: Record<string, unknown>) => runtime.executeApprovedRollback(input),
    },
  ];
}

function getOrCreateEntry(
  targetDocument: Document,
  runtime: PolicyPilotRuntime,
): RegistrationEntry {
  const existing = registrations.get(targetDocument);
  if (existing) return existing;
  const created: RegistrationEntry = {
    registeredNames: new Set(),
    runtime,
    pending: null,
  };
  registrations.set(targetDocument, created);
  return created;
}

async function registerMissingTools(
  modelContext: NonNullable<Document["modelContext"]>,
  entry: RegistrationEntry,
): Promise<WebMCPRegistrationState> {
  for (const tool of buildToolDefinitions(entry.runtime)) {
    if (entry.registeredNames.has(tool.name)) continue;
    await modelContext.registerTool(tool);
    entry.registeredNames.add(tool.name);
  }
  return "registered";
}

export function registerPolicyPilotTools(
  targetDocument: Document,
  runtime: PolicyPilotRuntime = policyPilotRuntime,
): Promise<WebMCPRegistrationState> {
  const modelContext = targetDocument.modelContext;
  if (!modelContext) return Promise.resolve("unsupported");

  const entry = getOrCreateEntry(targetDocument, runtime);

  if (!entry.pending) {
    const attempt = registerMissingTools(modelContext, entry);
    const guarded = attempt.catch((error: unknown) => {
      if (entry.pending === guarded) entry.pending = null;
      throw error;
    });
    entry.pending = guarded;
  }

  return entry.pending;
}