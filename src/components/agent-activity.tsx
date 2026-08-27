"use client";

import { useSyncExternalStore } from "react";
import { policyPilotRuntime, type PolicyPilotAuditEntry, type PolicyPilotSnapshot, type RollbackProposal } from "@/lib/operations";

function getSnapshot(): PolicyPilotSnapshot {
  return policyPilotRuntime.getSnapshot();
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} UTC`;
}

function formatResult(result: unknown): string {
  if (result === null || result === undefined) return "—";
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2).slice(0, 200);
  } catch {
    return String(result).slice(0, 200);
  }
}

function formatError(error: { readonly code: string; readonly message: string }): string {
  return `${error.code}: ${error.message}`;
}

function AuditEntry({ entry }: { entry: PolicyPilotAuditEntry }) {
  const isError = entry.status === "error";
  return (
    <li className="border-l-2 px-3 py-2 text-sm leading-6" style={{ borderLeftColor: isError ? "rgb(239 68 68 / 0.7)" : "rgb(34 197 94 / 0.7)" }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="font-medium text-zinc-100">{entry.eventId}</span>
          <time className="text-zinc-400" dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time>
          <code className="rounded bg-black/30 px-1.5 py-0.5 text-cyan-300 ring-1 ring-cyan-500/30">{entry.toolName}</code>
        </div>
        <span className={`shrink-0 font-mono text-xs font-medium ${isError ? "text-red-300" : "text-green-300"}`}>
          {entry.status}
        </span>
      </div>
      <div className="mt-1 flex flex-col gap-1 font-mono text-xs text-zinc-300">
        <div>
          <span className="text-zinc-400">Input:</span>{" "}
          <code className="bg-black/30 px-1.5 py-0.5 rounded">{formatResult(entry.input)}</code>
        </div>
        <div>
          <span className="text-zinc-400">{isError ? "Error:" : "Result:"}</span>{" "}
          <code className="bg-black/30 px-1.5 py-0.5 rounded">
            {isError ? formatError(entry.error) : formatResult(entry.result)}
          </code>
        </div>
      </div>
    </li>
  );
}

function ProposalPreview({ proposal }: { proposal: RollbackProposal }) {
  return (
    <section aria-label="Rollback proposal preview" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
      <div className="flex items-center gap-2 mb-4">
        <span aria-hidden="true" className="size-2 rounded-full bg-amber-500" />
        <h2 className="font-semibold text-amber-200">Awaiting human approval</h2>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Deployment</dt>
          <dd className="mt-1 font-mono text-zinc-100">{proposal.deploymentId}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Service</dt>
          <dd className="mt-1 font-mono text-zinc-100">{proposal.service}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">From version</dt>
          <dd className="mt-1 font-mono text-zinc-100">{proposal.fromVersion}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">To version</dt>
          <dd className="mt-1 font-mono text-zinc-100">{proposal.toVersion}</dd>
        </div>
        <div className="col-span-2">
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Reason</dt>
          <dd className="mt-1 text-zinc-200">{proposal.reason}</dd>
        </div>
        <div className="col-span-2">
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Consequence</dt>
          <dd className="mt-1 text-zinc-200">{proposal.consequence}</dd>
        </div>
        <div className="col-span-2">
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Proposal ID</dt>
          <dd className="mt-1 font-mono text-zinc-100">{proposal.proposalId}</dd>
        </div>
        <div className="col-span-2">
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Status</dt>
          <dd className="mt-1 flex items-center gap-2 text-sm font-medium text-amber-300">
            <span aria-hidden="true" className="size-2 rounded-full bg-amber-400" />
            {proposal.status}
          </dd>
        </div>
        <div className="col-span-2">
          <p className="text-xs text-zinc-400">
            Day 2 cannot execute this rollback; human approval is still required.
          </p>
        </div>
      </dl>
    </section>
  );
}

export default function AgentActivity() {
  const snapshot = useSyncExternalStore(
    policyPilotRuntime.subscribe,
    getSnapshot,
    getSnapshot,
  );

  const { auditLog, currentProposal } = snapshot;
  const reversedAuditLog = [...auditLog].reverse();

  return (
    <section aria-label="Agent activity" className="flex min-w-0 flex-col gap-6 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">Agent activity</p>
        <button
          onClick={() => policyPilotRuntime.reset()}
          className="rounded-md bg-zinc-800 px-3 py-1.5 font-mono text-xs font-medium text-zinc-100 ring-1 ring-zinc-700 hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 transition-colors"
        >
          Reset demo
        </button>
      </div>

      {reversedAuditLog.length === 0 && currentProposal === null && (
        <div className="flex flex-col gap-3 text-sm leading-6 text-zinc-300">
          <p>
            Connected agents can inspect context, list deploys, and prepare—but not execute—a rollback.
          </p>
          <p className="text-xs text-zinc-400">
            Invoke <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-cyan-300 ring-1 ring-cyan-500/30">get_incident_context</code>,
            <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-cyan-300 ring-1 ring-cyan-500/30">list_recent_deploys</code>, or
            <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-cyan-300 ring-1 ring-cyan-500/30">propose_rollback</code> to populate this feed.
          </p>
        </div>
      )}

      {reversedAuditLog.length > 0 && (
        <ul className="flex flex-col gap-2" role="log" aria-live="polite" aria-label="Audit trail">
          {reversedAuditLog.map((entry) => (
            <AuditEntry key={entry.eventId} entry={entry} />
          ))}
        </ul>
      )}

      {currentProposal && <ProposalPreview proposal={currentProposal as RollbackProposal} />}
    </section>
  );
}