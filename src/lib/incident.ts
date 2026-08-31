import { getHealthyIncidentContext } from "@/lib/scenario";

export type IncidentStatus = "investigating" | "mitigated" | "healthy";

export interface IncidentContext {
  incidentId: string;
  service: string;
  severity: "SEV-2" | "INFO";
  status: IncidentStatus;
  summary: string;
  startedAt: string;
  signals: readonly string[];
}

const seededSignals = Object.freeze([
  "5xx rate increased from 0.4% to 8.7%",
  "Latency p95 increased from 220ms to 1.8s",
  "Errors began six minutes after checkout-v2 reached 100%",
]) as IncidentContext["signals"];

const seededIncident: IncidentContext = Object.freeze({
  incidentId: "INC-1042",
  service: "payments-api",
  severity: "SEV-2",
  status: "investigating",
  summary: "Elevated 5xx errors after feature-flag rollout",
  startedAt: "2026-08-26T08:30:00.000Z",
  signals: seededSignals,
});

export function getIncidentContext(): IncidentContext {
  return {
    ...seededIncident,
    signals: [...seededIncident.signals],
  };
}

export function getIncidentContextForScenario(scenario: "incident" | "healthy"): IncidentContext {
  if (scenario === "healthy") {
    const healthy = getHealthyIncidentContext();
    return {
      incidentId: healthy.incidentId,
      service: healthy.service,
      severity: healthy.severity,
      status: healthy.status,
      summary: healthy.summary,
      startedAt: healthy.startedAt,
      signals: healthy.signals,
    };
  }
  return getIncidentContext();
}