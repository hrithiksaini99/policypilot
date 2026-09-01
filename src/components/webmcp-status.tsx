"use client";

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { registerPolicyPilotTools } from "@/lib/webmcp";
import { policyPilotRuntime, type PolicyPilotSnapshot, type PolicyPilotToolName } from "@/lib/operations";

type RegistrationViewState = "registering" | "registered" | "unsupported" | "failed";

const stateStyles: Record<RegistrationViewState, { dot: string; text: string }> = {
  registering: { dot: "bg-cyan-400/50", text: "text-zinc-300" },
  registered: { dot: "bg-cyan-400", text: "text-cyan-200" },
  unsupported: { dot: "bg-zinc-600", text: "text-zinc-300" },
  failed: { dot: "bg-red-500", text: "text-red-200" },
};

function StatusLine({ viewState, children }: { viewState: RegistrationViewState; children: React.ReactNode }) {
  return (
    <p className={`flex items-center gap-2 text-sm font-medium ${stateStyles[viewState].text}`}>
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${stateStyles[viewState].dot}`} />
      {children}
    </p>
  );
}

interface ToolDisplayDescriptor {
  name: PolicyPilotToolName;
  title: string;
  description: string;
  readOnlyHint: boolean;
}

const TOOL_DISPLAY_DESCRIPTORS: readonly ToolDisplayDescriptor[] = Object.freeze([
  {
    name: "get_incident_context",
    title: "Get incident context",
    description: "Read the current PolicyPilot incident, service health signals, and investigation status.",
    readOnlyHint: true,
  },
  {
    name: "list_recent_deploys",
    title: "List recent deploys",
    description: "List recent payments-api deployments and identify the active suspect rollout related to the incident.",
    readOnlyHint: true,
  },
  {
    name: "get_policy_state",
    title: "Get policy state",
    description: "Read the current PolicyPilot guardrail state and whether rollback execution is available.",
    readOnlyHint: true,
  },
  {
    name: "propose_rollback",
    title: "Propose rollback",
    description: "Prepare a non-executing rollback preview for the active suspect deployment; human approval is still required.",
    readOnlyHint: false,
  },
  {
    name: "execute_approved_rollback",
    title: "Execute approved rollback",
    description: "Execute the exact simulated rollback only when a human-approved approval ID and action fingerprint match the pending proposal.",
    readOnlyHint: false,
  },
]);

function getBadgeText(readOnlyHint: boolean): string {
  return readOnlyHint ? "READ" : "MUTATE";
}

function getBadgeStyles(readOnlyHint: boolean): string {
  return readOnlyHint
    ? "inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-xs bg-cyan-500/20 text-cyan-300"
    : "inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-xs bg-amber-500/20 text-amber-300";
}

type AvailabilityStatus = "Available" | "No action required" | "Blocked" | "Completed";

function deriveAvailability(toolName: PolicyPilotToolName, snapshot: PolicyPilotSnapshot): AvailabilityStatus {
  const { policy, scenarioId } = snapshot;

  if (toolName === "get_incident_context" || toolName === "list_recent_deploys" || toolName === "get_policy_state") {
    return "Available";
  }

  if (toolName === "propose_rollback") {
    if (scenarioId === "healthy") {
      return "No action required";
    }
    return "Available";
  }

  if (toolName === "execute_approved_rollback") {
    if (scenarioId === "healthy") {
      return "Blocked";
    }
    if (policy.executionAvailability === "completed") {
      return "Completed";
    }
    if (policy.executionAvailability === "available") {
      return "Available";
    }
    return "Blocked";
  }

  return "Available";
}

function getAvailabilityStyles(status: AvailabilityStatus): string {
  const base = "inline-flex items-center gap-1 font-mono text-xs";
  switch (status) {
    case "Available":
      return `${base} text-green-300`;
    case "Completed":
      return `${base} text-emerald-300`;
    case "No action required":
      return `${base} text-amber-300`;
    case "Blocked":
      return `${base} text-red-300`;
    default:
      return `${base} text-zinc-300`;
  }
}

function getAvailabilityDot(status: AvailabilityStatus): string {
  switch (status) {
    case "Available":
      return "size-1.5 rounded-full bg-green-400";
    case "Completed":
      return "size-1.5 rounded-full bg-emerald-400";
    case "No action required":
      return "size-1.5 rounded-full bg-amber-400";
    case "Blocked":
      return "size-1.5 rounded-full bg-red-400";
    default:
      return "size-1.5 rounded-full bg-zinc-400";
  }
}

function ToolCard({
  descriptor,
  availability,
  policyExplanation,
}: {
  descriptor: ToolDisplayDescriptor;
  availability: AvailabilityStatus;
  policyExplanation: string;
}) {
  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-mono text-sm font-medium text-zinc-100 truncate">{descriptor.name}</h3>
          <span className={getBadgeStyles(descriptor.readOnlyHint)}>{getBadgeText(descriptor.readOnlyHint)}</span>
        </div>
      </div>
      <p className="text-xs text-zinc-400 line-clamp-2">{descriptor.description}</p>
      <div className="text-xs text-zinc-400 truncate" title={policyExplanation}>
        {policyExplanation}
      </div>
      <div
        className={getAvailabilityStyles(availability)}
        title={policyExplanation}
      >
        <span aria-hidden="true" className={getAvailabilityDot(availability)} />
        {availability}
      </div>
    </article>
  );
}

function getSnapshot(): PolicyPilotSnapshot {
  return policyPilotRuntime.getSnapshot();
}

export default function WebMCPStatus() {
  const [viewState, setViewState] = useState<RegistrationViewState>("registering");

  const snapshot = useSyncExternalStore(
    policyPilotRuntime.subscribe,
    getSnapshot,
    getSnapshot,
  );

  useEffect(() => {
    let active = true;

    registerPolicyPilotTools(document)
      .then((result) => {
        if (active) setViewState(result);
      })
      .catch((error: unknown) => {
        console.error("PolicyPilot WebMCP registration failed:", error);
        if (active) setViewState("failed");
      });

    return () => {
      active = false;
    };
  }, []);

  if (viewState === "registering") {
    return (
      <section
        aria-label="Agent tool readiness"
        className="flex min-w-0 flex-col gap-4 self-start rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-7"
      >
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">Agent tool readiness</p>
        <div role="status">
          <StatusLine viewState={viewState}>Registering tools…</StatusLine>
        </div>
      </section>
    );
  }

  if (viewState === "unsupported") {
    return (
      <section
        aria-label="Agent tool readiness"
        className="flex min-w-0 flex-col gap-4 self-start rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-7"
      >
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">Agent tool readiness</p>
        <div role="status" className="flex flex-col gap-2">
          <StatusLine viewState={viewState}>WebMCP unavailable</StatusLine>
          <p className="text-xs leading-5 text-zinc-400">
            Open this page in ChatGPT&apos;s in-app browser or a WebMCP-enabled Chrome build.
          </p>
        </div>
      </section>
    );
  }

  if (viewState === "failed") {
    return (
      <section
        aria-label="Agent tool readiness"
        className="flex min-w-0 flex-col gap-4 self-start rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-7"
      >
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">Agent tool readiness</p>
        <div role="alert">
          <StatusLine viewState={viewState}>Tool registration failed</StatusLine>
        </div>
      </section>
    );
  }

  const cards = TOOL_DISPLAY_DESCRIPTORS.map((descriptor) => (
    <ToolCard
      key={descriptor.name}
      descriptor={descriptor}
      availability={deriveAvailability(descriptor.name, snapshot)}
      policyExplanation={snapshot.policy.explanation}
    />
  ));

  return (
    <section
      aria-label="Agent tool readiness"
      className="flex min-w-0 flex-col gap-4 self-start rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-7"
    >
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">Agent tool readiness</p>
      <div role="status" className="flex flex-col gap-2">
        <StatusLine viewState={viewState}>5 tools registered</StatusLine>
      </div>
      <div className="grid gap-3 lg:grid-cols-2" aria-label="Registered tools">
        {cards}
      </div>
      <p className="text-xs leading-5 text-zinc-400">
        Connected agents can now read the live incident context, list recent deployments, check policy state,
        prepare rollback proposals, and attempt execution from this page. The execution tool is discoverable
        but rejects every call until a human approves the exact proposal with its action fingerprint.
      </p>
    </section>
  );
}