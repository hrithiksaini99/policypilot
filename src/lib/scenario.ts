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

export type DeploymentStatus = "active" | "superseded";

export interface HealthyDeployment {
  deploymentId: string;
  service: string;
  version: string;
  previousVersion: string;
  deployedAt: string;
  status: DeploymentStatus;
  suspect: false;
}

const seededHealthySignals = Object.freeze([
  "5xx rate stable at 0.4%",
  "Latency p95 stable at 220ms",
]) as HealthyIncidentContext["signals"];

export const seededHealthyIncident: HealthyIncidentContext = Object.freeze({
  incidentId: "OPS-HEALTHY-0001",
  service: "payments-api",
  severity: "INFO",
  status: "healthy",
  summary: "payments-api operating normally",
  startedAt: "2026-08-29T09:00:00.000Z",
  signals: seededHealthySignals,
});

export const seededHealthyDeployments: readonly HealthyDeployment[] = Object.freeze([
  Object.freeze({
    deploymentId: "DEP-9900",
    service: "payments-api",
    version: "checkout-v3",
    previousVersion: "checkout-v2",
    deployedAt: "2026-08-29T08:00:00.000Z",
    status: "active",
    suspect: false,
  }) satisfies HealthyDeployment,
  Object.freeze({
    deploymentId: "DEP-9890",
    service: "payments-api",
    version: "checkout-v2",
    previousVersion: "checkout-v1",
    deployedAt: "2026-08-28T16:10:00.000Z",
    status: "active",
    suspect: false,
  }) satisfies HealthyDeployment,
]);

export function getHealthyIncidentContext(): HealthyIncidentContext {
  return {
    ...seededHealthyIncident,
    signals: [...seededHealthyIncident.signals],
  };
}

export function getHealthyDeployments(): readonly HealthyDeployment[] {
  return seededHealthyDeployments.map((d) => ({ ...d }));
}

export const NO_ACTION_REQUIRED = "NO_ACTION_REQUIRED" as const;