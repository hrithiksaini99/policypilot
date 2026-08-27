"use client";

import { useEffect, useState } from "react";
import { registerPolicyPilotTools } from "@/lib/webmcp";

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

const TOOL_NAMES = ["get_incident_context", "list_recent_deploys", "propose_rollback"] as const;

export default function WebMCPStatus() {
  const [viewState, setViewState] = useState<RegistrationViewState>("registering");

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

  return (
    <section
      aria-label="Agent tool readiness"
      className="flex min-w-0 flex-col gap-4 self-start rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-7"
    >
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">Agent tool readiness</p>

      {viewState === "registering" && (
        <div role="status">
          <StatusLine viewState={viewState}>Registering tools…</StatusLine>
        </div>
      )}

      {viewState === "registered" && (
        <div role="status" className="flex flex-col gap-2">
          <StatusLine viewState={viewState}>3 tools registered</StatusLine>
          <ul className="flex flex-wrap gap-1.5" aria-label="Registered tools">
            {TOOL_NAMES.map((name) => (
              <li key={name}>
                <code className="w-fit rounded-md bg-black/40 px-2 py-1 font-mono text-xs text-cyan-300 ring-1 ring-cyan-500/30">
                  {name}
                </code>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-5 text-zinc-400">
            Connected agents can now read the live incident context, list recent deployments, and prepare rollback proposals from this page.
          </p>
        </div>
      )}

      {viewState === "unsupported" && (
        <div role="status" className="flex flex-col gap-2">
          <StatusLine viewState={viewState}>WebMCP unavailable</StatusLine>
          <p className="text-xs leading-5 text-zinc-400">
            Open this page in ChatGPT&apos;s in-app browser or a WebMCP-enabled Chrome build.
          </p>
        </div>
      )}

      {viewState === "failed" && (
        <div role="alert">
          <StatusLine viewState={viewState}>Tool registration failed</StatusLine>
        </div>
      )}
    </section>
  );
}