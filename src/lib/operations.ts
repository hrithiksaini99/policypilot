import { getIncidentContext, type IncidentContext } from "@/lib/incident";
import {
  type ScenarioId,
  type PolicyPilotRuntimeOptions as ScenarioRuntimeOptions,
  getHealthyIncidentContext,
  getHealthyDeployments,
  NO_ACTION_REQUIRED,
} from "@/lib/scenario";

export type PolicyPhase = "read" | "draft" | "approval_required" | "approved" | "executed";

export interface ApprovalReceipt {
  readonly approvalId: string;
  readonly actionHash: string;
  readonly proposalId: string;
  readonly approvedAt: string;
  readonly status: "approved";
}

export interface ExecutionReceipt {
  readonly executionId: string;
  readonly approvalId: string;
  readonly actionHash: string;
  readonly deploymentId: string;
  readonly status: "completed";
  readonly executedAt: string;
}

export interface PolicyState {
  readonly phase: PolicyPhase;
  readonly inspectionAllowed: true;
  readonly draftAllowed: true;
  readonly executionRequiresHumanApproval: true;
  readonly executionAvailability: "blocked" | "available" | "completed";
  readonly explanation: string;
}

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

export type PolicyPilotToolName =
  | "get_incident_context"
  | "list_recent_deploys"
  | "propose_rollback"
  | "execute_approved_rollback"
  | "get_policy_state";

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
  | "INTERNAL_TOOL_ERROR"
  | "APPROVAL_REQUIRED"
  | "INVALID_APPROVAL_INPUT"
  | "APPROVAL_MISMATCH"
  | "ROLLBACK_ALREADY_EXECUTED"
  | "NO_ACTION_REQUIRED";

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
  readonly scenarioId: ScenarioId;
  readonly incident: IncidentContext;
  readonly recentDeployments: readonly RecentDeployment[];
  readonly currentProposal: RollbackProposal | null;
  readonly auditLog: readonly PolicyPilotAuditEntry[];
  readonly policy: PolicyState;
  readonly currentApproval: ApprovalReceipt | null;
  readonly currentExecution: ExecutionReceipt | null;
}

export class PolicyPilotInputError extends Error {
  readonly code: PolicyPilotErrorCode;

  constructor(code: PolicyPilotErrorCode, message: string) {
    super(message);
    this.name = "PolicyPilotInputError";
    this.code = code;
  }
}

export type PolicyPilotRuntimeOptions = ScenarioRuntimeOptions;

export interface PolicyPilotRuntime {
  readIncident(): IncidentContext;
  listRecentDeploys(): readonly RecentDeployment[];
  proposeRollback(input: unknown): RollbackProposal;
  getSnapshot(): PolicyPilotSnapshot;
  subscribe(listener: () => void): () => void;
  reset(): void;
  getPolicyState(): PolicyState;
  approveCurrentProposal(): ApprovalReceipt;
  executeApprovedRollback(input: unknown): ExecutionReceipt;
  selectScenario(scenarioId: ScenarioId): void;
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

const ACTION_HASH = "fnv1a-32:rollback-inc-1042-dep-8821-checkout-v2-checkout-v1";
const APPROVAL_ID = "APR-INC-1042-DEP-8821";
const EXECUTION_ID = "EXE-INC-1042-DEP-8821";

const HEALTHY_ACTION_HASH = "fnv1a-32:rollback-ops-healthy-0001-dep-9900-checkout-v2-checkout-v1";
const HEALTHY_APPROVAL_ID = "APR-OPS-HEALTHY-0001-DEP-9900";
const HEALTHY_EXECUTION_ID = "EXE-OPS-HEALTHY-0001-DEP-9900";

function buildPolicyState(
  phase: PolicyPhase,
  executionAvailability: "blocked" | "available" | "completed",
  explanation: string,
): PolicyState {
  return deepFreeze({
    phase,
    inspectionAllowed: true as const,
    draftAllowed: true as const,
    executionRequiresHumanApproval: true as const,
    executionAvailability,
    explanation,
  });
}

function cloneApprovalReceipt(approval: ApprovalReceipt): ApprovalReceipt {
  return { ...approval };
}

function cloneExecutionReceipt(execution: ExecutionReceipt): ExecutionReceipt {
  return { ...execution };
}

function freezePolicyState(state: PolicyState): PolicyState {
  return deepFreeze({ ...state });
}

export function createPolicyPilotRuntime(
  options: PolicyPilotRuntimeOptions = {},
): PolicyPilotRuntime {
  const now = options.now ?? (() => new Date().toISOString());

  let currentScenario: ScenarioId = options.initialScenario ?? "incident";

  let auditLog: PolicyPilotAuditEntry[] = [];
  let currentProposal: RollbackProposal | null = null;
  let currentApproval: ApprovalReceipt | null = null;
  let currentExecution: ExecutionReceipt | null = null;
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

  let currentIncident: IncidentContext | null = null;

  function getCurrentIncident(): IncidentContext {
    if (currentIncident === null) {
      currentIncident = getIncidentContextForScenario(currentScenario);
    }
    return currentIncident;
  }

  function getIncidentContextForScenario(scenario: ScenarioId): IncidentContext {
    if (scenario === "healthy") {
      return getHealthyIncidentContext();
    }
    return getIncidentContext();
  }

  function getDeploymentsForScenario(scenario: ScenarioId): readonly RecentDeployment[] {
    if (scenario === "healthy") {
      return getHealthyDeployments();
    }
    return seededDeployments;
  }

  function getSuspectDeploymentForScenario(scenario: ScenarioId): RecentDeployment | null {
    const deployments = getDeploymentsForScenario(scenario);
    const found = deployments.find((d) => d.suspect && d.status === "active");
    return found ?? null;
  }

  function cloneIncidentLocal(incident: IncidentContext): IncidentContext {
    return { ...incident, signals: [...incident.signals] };
  }

  function buildMitigatedIncident(): IncidentContext {
    return deepFreeze({
      incidentId: "INC-1042",
      service: "payments-api",
      severity: "SEV-2" as const,
      status: "mitigated" as const,
      summary: "5xx errors stabilized after approved rollback",
      startedAt: "2026-08-26T08:30:00.000Z",
      signals: Object.freeze([
        "Approved rollback completed: checkout-v2 → checkout-v1",
        "5xx rate returned to 0.4%",
        "Latency p95 returned to 220ms",
      ]),
    });
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
              code: "INTERNAL_TOOL_ERROR" as PolicyPilotErrorCode,
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
      throw new PolicyPilotInputError("INVALID_ROLLBACK_INPUT", "deploymentId must identify the active suspect deployment (DEP-8821).");
    }

    const keys = Object.keys(input);
    if (
      keys.length !== 1 ||
      keys[0] !== "deploymentId" ||
      typeof input.deploymentId !== "string"
    ) {
      throw new PolicyPilotInputError("INVALID_ROLLBACK_INPUT", "deploymentId must identify the active suspect deployment (DEP-8821).");
    }

    const deploymentId = input.deploymentId;
    const suspectDeployment = getSuspectDeploymentForScenario(currentScenario);

    if (currentScenario === "healthy") {
      if (deploymentId === "DEP-9900") {
        throw new PolicyPilotInputError(NO_ACTION_REQUIRED, "System healthy; no rollback action required or permitted.");
      }
      throw new PolicyPilotInputError("INVALID_ROLLBACK_INPUT", "deploymentId must identify the active suspect deployment (DEP-8821).");
    }

    if (!suspectDeployment || deploymentId !== suspectDeployment.deploymentId) {
      throw new PolicyPilotInputError("INVALID_ROLLBACK_INPUT", "deploymentId must identify the active suspect deployment (DEP-8821).");
    }

    return deploymentId;
  }

  function buildRollbackProposal(deploymentId: string): RollbackProposal {
    const incident = getCurrentIncident();
    const suspectDeployment = getSuspectDeploymentForScenario(currentScenario)!;
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

  function validateApprovalInput(input: unknown): { approvalId: string; actionHash: string } {
    if (!isPlainObject(input)) {
      throw new PolicyPilotInputError("INVALID_APPROVAL_INPUT", "Input must be a plain object with exactly approvalId and actionHash.");
    }

    const keys = Object.keys(input);
    if (keys.length !== 2 || !keys.includes("approvalId") || !keys.includes("actionHash")) {
      throw new PolicyPilotInputError("INVALID_APPROVAL_INPUT", "Input must be a plain object with exactly approvalId and actionHash.");
    }

    if (typeof input.approvalId !== "string" || typeof input.actionHash !== "string") {
      throw new PolicyPilotInputError("INVALID_APPROVAL_INPUT", "approvalId and actionHash must be strings.");
    }

    return { approvalId: input.approvalId, actionHash: input.actionHash };
  }

  function readIncident(): IncidentContext {
    return runTool(
      "get_incident_context",
      undefined,
      () => cloneIncidentLocal(getCurrentIncident()),
      cloneIncidentLocal,
    );
  }

  function listRecentDeploys(): readonly RecentDeployment[] {
    return runTool(
      "list_recent_deploys",
      undefined,
      () => getDeploymentsForScenario(currentScenario).map(cloneDeployment),
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

  function getPolicyState(): PolicyState {
    return runTool(
      "get_policy_state",
      undefined,
      () => buildPolicyStateInternal(),
      (state) => deepFreeze({ ...state }),
    );
  }

  function buildPolicyStateInternal(): PolicyState {
    if (currentExecution) {
      return buildPolicyState("executed", "completed", "Rollback has been executed; incident is mitigated.");
    }
    if (currentApproval) {
      return buildPolicyState("approved", "available", "Proposal approved; awaiting execution.");
    }
    if (currentProposal) {
      return buildPolicyState("approval_required", "blocked", "Proposal drafted; human approval required before execution.");
    }
    return buildPolicyState("read", "blocked", "Inspection and drafting allowed; execution requires human approval.");
  }

  function approveCurrentProposal(): ApprovalReceipt {
    if (!currentProposal) {
      throw new PolicyPilotInputError("INVALID_APPROVAL_INPUT", "No proposal pending approval.");
    }

    const isHealthy = currentScenario === "healthy";
    const approval: ApprovalReceipt = deepFreeze({
      approvalId: isHealthy ? HEALTHY_APPROVAL_ID : APPROVAL_ID,
      actionHash: isHealthy ? HEALTHY_ACTION_HASH : ACTION_HASH,
      proposalId: currentProposal.proposalId,
      approvedAt: now(),
      status: "approved" as const,
    });

    currentApproval = approval;
    notify();
    return cloneApprovalReceipt(approval);
  }

  function executeApprovedRollback(input: unknown): ExecutionReceipt {
    return runTool(
      "execute_approved_rollback",
      input,
      () => {
        const { approvalId, actionHash } = validateApprovalInput(input);

        if (!currentProposal || !currentApproval) {
          throw new PolicyPilotInputError("APPROVAL_REQUIRED", "No approved proposal available for execution.");
        }

        if (approvalId !== currentApproval.approvalId || actionHash !== currentApproval.actionHash) {
          throw new PolicyPilotInputError("APPROVAL_MISMATCH", "Approval ID or action hash does not match the current approval receipt.");
        }

        if (currentExecution) {
          throw new PolicyPilotInputError("ROLLBACK_ALREADY_EXECUTED", "Rollback has already been executed.");
        }

        const execution: ExecutionReceipt = deepFreeze({
          executionId: currentScenario === "healthy" ? HEALTHY_EXECUTION_ID : EXECUTION_ID,
          approvalId: currentApproval.approvalId,
          actionHash: currentApproval.actionHash,
          deploymentId: currentProposal.deploymentId,
          status: "completed" as const,
          executedAt: now(),
        });

        currentExecution = execution;
        currentIncident = buildMitigatedIncident();

        return execution;
      },
      cloneExecutionReceipt,
    );
  }

  function getSnapshot(): PolicyPilotSnapshot {
    if (!cachedSnapshot) {
      cachedSnapshot = deepFreeze({
        scenarioId: currentScenario,
        incident: deepFreeze(cloneIncidentLocal(getCurrentIncident())),
        recentDeployments: getDeploymentsForScenario(currentScenario).map((deployment) =>
          deepFreeze(cloneDeployment(deployment)),
        ),
        currentProposal: currentProposal ? deepFreeze(cloneProposal(currentProposal)) : null,
        auditLog: auditLog.map((entry) => {
          if (entry.status === "success") {
            return deepFreeze({ ...entry });
          }
          return deepFreeze({ ...entry, error: { ...entry.error } });
        }),
        policy: freezePolicyState(buildPolicyStateInternal()),
        currentApproval: currentApproval ? deepFreeze(cloneApprovalReceipt(currentApproval)) : null,
        currentExecution: currentExecution ? deepFreeze(cloneExecutionReceipt(currentExecution)) : null,
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
    currentApproval = null;
    currentExecution = null;
    currentIncident = null;
    nextEventNumber = 1;
    notify();
  }

  function selectScenario(scenarioId: ScenarioId): void {
    if (scenarioId === currentScenario) {
      return;
    }
    currentScenario = scenarioId;
    auditLog = [];
    currentProposal = null;
    currentApproval = null;
    currentExecution = null;
    currentIncident = null;
    nextEventNumber = 1;
    cachedSnapshot = null;
    notify();
  }

  return {
    readIncident,
    listRecentDeploys,
    proposeRollback,
    getSnapshot,
    subscribe,
    reset,
    getPolicyState,
    approveCurrentProposal,
    executeApprovedRollback,
    selectScenario,
  };
}

export const policyPilotRuntime: PolicyPilotRuntime = createPolicyPilotRuntime();

export { NO_ACTION_REQUIRED };