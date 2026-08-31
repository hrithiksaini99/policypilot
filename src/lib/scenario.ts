export type ScenarioId = "incident" | "healthy";

export interface PolicyPilotRuntimeOptions {
  now?: () => string;
  initialScenario?: ScenarioId;
}

export interface HealthyIncidentContext {
  incidentId: string;
  service: string;
  severity: "INFO";
  status: "healthy";
  summary: string;
  startedAt: string;
  signals: readonly string[];
}

export interface HealthyDeployment {
  deploymentId: string;
  service: string;
  version: string;
  previousVersion: string;
  deployedAt: string;
  status: "active";
  suspect: false;
}

const seededHealthySignals = Object.freeze([
  "All service health indicators nominal",
  "No active incidents or deployments requiring action",
]) as HealthyIncidentContext["signals"];

export const seededHealthyIncident: HealthyIncidentContext = Object.freeze({
  incidentId: "OPS-HEALTHY-0001",
  service: "payments-api",
  severity: "INFO",
  status: "healthy",
  summary: "System operating normally; no action required",
  startedAt: "2026-08-26T08:30:00.000Z",
  signals: seededHealthySignals,
});

export const seededHealthyDeployment: HealthyDeployment = Object.freeze({
  deploymentId: "DEP-9900",
  service: "payments-api",
  version: "checkout-v2",
  previousVersion: "checkout-v1",
  deployedAt: "2026-08-26T08:24:00.000Z",
  status: "active",
  suspect: false,
});

export function getHealthyIncidentContext(): HealthyIncidentContext {
  return {
    ...seededHealthyIncident,
    signals: [...seededHealthyIncident.signals],
  };
}

export function getHealthyDeployments(): readonly HealthyDeployment[] {
  return [seededHealthyDeployment];
}

export const NO_ACTION_REQUIRED = "NO_ACTION_REQUIRED" as const;