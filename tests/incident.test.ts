import { describe, expect, it } from "vitest";
import { getIncidentContext } from "@/lib/incident";

describe("getIncidentContext", () => {
  it("returns the seeded incident used by the Day 1 demo", () => {
    expect(getIncidentContext()).toEqual({
      incidentId: "INC-1042",
      service: "payments-api",
      severity: "SEV-2",
      status: "investigating",
      summary: "Elevated 5xx errors after feature-flag rollout",
      startedAt: "2026-08-26T08:30:00.000Z",
      signals: [
        "5xx rate increased from 0.4% to 8.7%",
        "Latency p95 increased from 220ms to 1.8s",
        "Errors began six minutes after checkout-v2 reached 100%",
      ],
    });
  });

  it("returns a fresh object so callers cannot mutate shared demo state", () => {
    const first = getIncidentContext();
    const second = getIncidentContext();

    expect(first).not.toBe(second);
    expect(first.signals).not.toBe(second.signals);
  });
});
