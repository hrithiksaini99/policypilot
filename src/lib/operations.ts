import { getIncidentContext, type IncidentContext } from "@/lib/incident";

export type DeploymentStatus = "active" | "superseded";

export interface RecentDeployment {
  readonly deploymentId: string;
  readonly service: string;
  readonly version: string;
  readonly previousVersion: string;
  readonly deployedAt: string;
  readonly status: DeploymentStatus;
  readonly suspect: boolean;
}

const seededDeployments: readonly RecentDeployment[] = Object.freeze([
  Object.freeze({
    deploymentId: "DEP-8821",
    service: "payments-api",
    version: "checkout-v2",
    previousVersion: "checkout-v1",
    deployedAt: "2026-08-26T08:24:00.000Z",
    status: "active",
    suspect: true,
  }) satisfies RecentDeployment,
  Object.freeze({
    deploymentId: "DEP-8817",
    service: "payments-api",
    version: "checkout-v1",
    previousVersion: "checkout-v0.9",
    deployedAt: "2026-08-25T16:10:00.000Z",
    status: "superseded",
    suspect: false,
  }) satisfies RecentDeployment,
]);

const foundSuspectDeployment = seededDeployments.find(
  (deployment) => deployment.suspect && deployment.status === "active",
);

if (!foundSuspectDeployment) {
  throw new Error("Seed data must include an active suspect deployment.");
}

const suspectDeployment: RecentDeployment = foundSuspectDeployment;

export type PolicyPilotToolName =
  | "read_incident"
  | "list_recent_deploys"
  | "propose_rollback";

export interface PolicyPilotAuditSuccessEntry {
  readonly eventId: string;
  readonly timestamp: string;
  readonly toolName: PolicyPilotToolName;
  readonly input: unknown;
  readonly status: "success";
  readonly result: unknown;
}

export type PolicyPilotErrorCode =
  | "INVALID_ROLLBACK_INPUT"
  | "INTERNAL_TOOL_ERROR";

export interface PolicyPilotAuditErrorDetail {
  readonly code: PolicyPilotErrorCode;
  readonly message: string;
}

export interface PolicyPilotAuditErrorEntry {
  readonly eventId: string;
  readonly timestamp: string;
  readonly toolName: PolicyPilotToolName;
  readonly input: unknown;
  readonly status: "error";
  readonly error: PolicyPilotAuditErrorDetail;
}

export type PolicyPilotAuditEntry =
  | PolicyPilotAuditSuccessEntry
  | PolicyPilotAuditErrorEntry;

export interface RollbackProposal {
  readonly proposalId: string;
  readonly incidentId: string;
  readonly deploymentId: string;
  readonly service: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly reason: string;
  readonly consequence: string;
  readonly requiresApproval: true;
  readonly status: "awaiting_approval";
}

export interface PolicyPilotSnapshot {
  readonly incident: IncidentContext;
  readonly recentDeployments: readonly RecentDeployment[];
  readonly currentProposal: RollbackProposal | null;
  readonly auditLog: readonly PolicyPilotAuditEntry[];
}

export class PolicyPilotInputError extends Error {
  readonly code: PolicyPilotErrorCode;

  constructor(code: PolicyPilotErrorCode, message: string) {
    super(message);
    this.name = "PolicyPilotInputError";
    this.code = code;
  }
}

const INVALID_ROLLBACK_INPUT: PolicyPilotErrorCode = "INVALID_ROLLBACK_INPUT";
const INTERNAL_TOOL_ERROR: PolicyPilotErrorCode = "INTERNAL_TOOL_ERROR";
const INVALID_ROLLBACK_MESSAGE =
  "deploymentId must identify the active suspect deployment (DEP-8821).";

export interface PolicyPilotRuntimeOptions {
  now?: () => string;
}

export interface PolicyPilotRuntime {
  readIncident(): IncidentContext;
  listRecentDeploys(): readonly RecentDeployment[];
  proposeRollback(input: unknown): RollbackProposal;
  getSnapshot(): PolicyPilotSnapshot;
  subscribe(listener: () => void): () => void;
  reset(): void;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as object)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function cloneDeployment(deployment: RecentDeployment): RecentDeployment {
  return { ...deployment };
}

function cloneIncident(incident: IncidentContext): IncidentContext {
  return { ...incident, signals: [...incident.signals] };
}

function cloneProposal(proposal: RollbackProposal): RollbackProposal {
  return { ...proposal };
}

function freezeAuditInput(input: unknown): unknown {
  if (Array.isArray(input)) return deepFreeze([...input]);
  if (input !== null && typeof input === "object") {
    return deepFreeze({ ...(input as object) });
  }
  return input;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function createPolicyPilotRuntime(
  options: PolicyPilotRuntimeOptions = {},
): PolicyPilotRuntime {
  const now = options.now ?? (() => new Date().toISOString());

  let auditLog: PolicyPilotAuditEntry[] = [];
  let currentProposal: RollbackProposal | null = null;
  let nextEventNumber = 1;
  let cachedSnapshot: PolicyPilotSnapshot | null = null;
  const listeners = new Set<() => void>();

  function notify(): void {
    cachedSnapshot = null;
    for (const listener of Array.from(listeners)) listener();
  }

  function nextEventId(): string {
    const eventId = `EVT-${String(nextEventNumber).padStart(4, "0")}`;
    nextEventNumber += 1;
    return eventId;
  }

  function appendAuditEntry(entry: PolicyPilotAuditEntry): void {
    auditLog = [...auditLog, entry];
  }

  function runTool<TResult>(
    toolName: PolicyPilotToolName,
    input: unknown,
    execute: () => TResult,
    freezeResult: (result: TResult) => unknown,
  ): TResult {
    try {
      const result = execute();
      appendAuditEntry(
        deepFreeze({
          eventId: nextEventId(),
          timestamp: now(),
          toolName,
          input: freezeAuditInput(input),
          status: "success" as const,
          result: freezeResult(result),
        }),
      );
      notify();
      return result;
    } catch (error) {
      const detail =
        error instanceof PolicyPilotInputError
          ? { code: error.code, message: error.message }
          : {
              code: INTERNAL_TOOL_ERROR,
              message:
                error instanceof Error
                  ? error.message
                  : "Tool execution failed unexpectedly.",
            };
      appendAuditEntry(
        deepFreeze({
          eventId: nextEventId(),
          timestamp: now(),
          toolName,
          input: freezeAuditInput(input),
          status: "error" as const,
          error: detail,
        }),
      );
      notify();
      throw error;
    }
  }

  function validateRollbackInput(input: unknown): string {
    if (!isPlainObject(input)) {
      throw new PolicyPilotInputError(INVALID_ROLLBACK_INPUT, INVALID_ROLLBACK_MESSAGE);
    }

    const keys = Object.keys(input);
    if (
      keys.length !== 1 ||
      keys[0] !== "deploymentId" ||
      typeof input.deploymentId !== "string"
    ) {
      throw new PolicyPilotInputError(INVALID_ROLLBACK_INPUT, INVALID_ROLLBACK_MESSAGE);
    }

    const deploymentId = input.deploymentId;
    if (deploymentId !== suspectDeployment.deploymentId) {
      throw new PolicyPilotInputError(INVALID_ROLLBACK_INPUT, INVALID_ROLLBACK_MESSAGE);
    }

    return deploymentId;
  }

  function buildRollbackProposal(deploymentId: string): RollbackProposal {
    const incident = getIncidentContext();
    return deepFreeze({
      proposalId: `RB-${incident.incidentId}-${deploymentId}`,
      incidentId: incident.incidentId,
      deploymentId,
      service: suspectDeployment.service,
      fromVersion: suspectDeployment.version,
      toVersion: suspectDeployment.previousVersion,
      reason: `Incident signals began six minutes after ${suspectDeployment.version} reached 100%.`,
      consequence: `Traffic would return to ${suspectDeployment.previousVersion}; no customer data would be modified.`,
      requiresApproval: true as const,
      status: "awaiting_approval" as const,
    });
  }

  function readIncident(): IncidentContext {
    return runTool(
      "read_incident",
      undefined,
      () => getIncidentContext(),
      cloneIncident,
    );
  }

  function listRecentDeploys(): readonly RecentDeployment[] {
    return runTool(
      "list_recent_deploys",
      undefined,
      () => seededDeployments.map(cloneDeployment),
      (deployments) => deployments.map((deployment) => deepFreeze(cloneDeployment(deployment))),
    );
  }

  function proposeRollback(input: unknown): RollbackProposal {
    const stored = runTool(
      "propose_rollback",
      input,
      () => {
        const proposal = buildRollbackProposal(validateRollbackInput(input));
        currentProposal = proposal;
        return proposal;
      },
      cloneProposal,
    );
    return cloneProposal(stored);
  }

  function getSnapshot(): PolicyPilotSnapshot {
    if (!cachedSnapshot) {
      cachedSnapshot = deepFreeze({
        incident: deepFreeze(cloneIncident(getIncidentContext())),
        recentDeployments: seededDeployments.map((deployment) =>
          deepFreeze(cloneDeployment(deployment)),
        ),
        currentProposal: currentProposal ? deepFreeze(cloneProposal(currentProposal)) : null,
        auditLog: auditLog.map((entry) => {
          if (entry.status === "success") {
            return deepFreeze({ ...entry });
          }
          return deepFreeze({ ...entry, error: { ...entry.error } });
        }),
      });
    }
    return cachedSnapshot;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function reset(): void {
    auditLog = [];
    currentProposal = null;
    nextEventNumber = 1;
    notify();
  }

  return {
    readIncident,
    listRecentDeploys,
    proposeRollback,
    getSnapshot,
    subscribe,
    reset,
  };
}

export const policyPilotRuntime: PolicyPilotRuntime = createPolicyPilotRuntime();
