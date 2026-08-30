"use client";

import { useSyncExternalStore } from "react";
import { policyPilotRuntime, type PolicyPilotSnapshot } from "@/lib/operations";
import IncidentDashboard from "@/components/incident-dashboard";

function getSnapshot(): PolicyPilotSnapshot {
  return policyPilotRuntime.getSnapshot();
}

export default function LiveIncidentDashboard() {
  const snapshot = useSyncExternalStore(
    policyPilotRuntime.subscribe,
    getSnapshot,
    getSnapshot,
  );

  return <IncidentDashboard incident={snapshot.incident} />;
}