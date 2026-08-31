"use client";

import { useSyncExternalStore } from "react";
import { policyPilotRuntime, type PolicyPilotSnapshot } from "@/lib/operations";

function getSnapshot(): PolicyPilotSnapshot {
  return policyPilotRuntime.getSnapshot();
}

export default function ScenarioSelector() {
  const snapshot = useSyncExternalStore(
    policyPilotRuntime.subscribe,
    getSnapshot,
    getSnapshot,
  );

  const scenarioId = snapshot.scenarioId;

  return (
    <fieldset className="flex items-center gap-4">
      <legend className="font-mono text-xs uppercase tracking-wider text-zinc-400">Collaboration scenario</legend>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="scenario"
            value="incident"
            checked={scenarioId === "incident"}
            onChange={() => policyPilotRuntime.selectScenario("incident")}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          />
          <span className="font-mono text-sm text-zinc-100">Active incident</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="scenario"
            value="healthy"
            checked={scenarioId === "healthy"}
            onChange={() => policyPilotRuntime.selectScenario("healthy")}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          />
          <span className="font-mono text-sm text-zinc-100">Healthy system</span>
        </label>
      </div>
      <div role="status" aria-live="polite" aria-label="Active scenario" className="sr-only">
        {scenarioId === "incident" ? "Active incident" : "Healthy system"}
      </div>
    </fieldset>
  );
}