"use client";

import { useSyncExternalStore, useState } from "react";
import {
  policyPilotRuntime,
  type PolicyPilotSnapshot,
  type RollbackProposal,
  type ApprovalReceipt,
  type ExecutionReceipt,
} from "@/lib/operations";

const DEMO_ROLLBACK_ACTION_FINGERPRINT = "fnv1a-32:rollback-inc-1042-dep-8821-checkout-v2-checkout-v1";

function getSnapshot(): PolicyPilotSnapshot {
  return policyPilotRuntime.getSnapshot();
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} UTC`;
}

function ProposalDetails({ proposal }: { proposal: RollbackProposal }) {
  return (
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
        <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Action fingerprint</dt>
        <dd className="mt-1 font-mono text-xs text-cyan-300 break-all">{DEMO_ROLLBACK_ACTION_FINGERPRINT}</dd>
      </div>
    </dl>
  );
}

function ApprovalDialog({
  proposal,
  onApprove,
  onCancel,
}: {
  proposal: RollbackProposal;
  onApprove: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-xl">
        <h2 id="approval-dialog-title" className="text-lg font-semibold text-zinc-50">
          Review and approve rollback
        </h2>
        <p className="mt-2 text-sm text-zinc-300">
          This action requires explicit human approval. Review the exact rollback details below.
        </p>

        <ProposalDetails proposal={proposal} />

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md bg-zinc-800 px-4 py-2 font-mono text-xs font-medium text-zinc-100 ring-1 ring-zinc-700 hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="rounded-md bg-amber-500 px-4 py-2 font-mono text-xs font-medium text-zinc-950 hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 transition-colors"
          >
            Approve exact rollback
          </button>
        </div>
      </div>
    </div>
  );
}

function ApprovalRecorded({ approval }: { approval: ApprovalReceipt }) {
  return (
    <section aria-label="Approval recorded" className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
      <div className="flex items-center gap-2 mb-4">
        <span aria-hidden="true" className="size-2 rounded-full bg-emerald-500" />
        <h2 className="font-semibold text-emerald-200">Approval recorded</h2>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mb-4">
        <div>
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Approval ID</dt>
          <dd className="mt-1 font-mono text-zinc-100">{approval.approvalId}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Approved at</dt>
          <dd className="mt-1 font-mono text-zinc-100">{formatTimestamp(approval.approvedAt)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Action fingerprint</dt>
          <dd className="mt-1 font-mono text-xs text-cyan-300 break-all">{approval.actionHash}</dd>
        </div>
      </dl>
      <p className="text-xs text-zinc-400">
        Execution available only for the exact approval ID and action fingerprint.
      </p>
    </section>
  );
}

function ExecutionRecorded({ execution }: { execution: ExecutionReceipt }) {
  return (
    <section aria-label="Execution completed" className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
      <div className="flex items-center gap-2 mb-4">
        <span aria-hidden="true" className="size-2 rounded-full bg-emerald-500" />
        <h2 className="font-semibold text-emerald-200">Approved rollback completed</h2>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mb-4">
        <div>
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Execution ID</dt>
          <dd className="mt-1 font-mono text-zinc-100">{execution.executionId}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Deployment</dt>
          <dd className="mt-1 font-mono text-zinc-100">{execution.deploymentId}</dd>
        </div>
        <div className="col-span-2">
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Executed at</dt>
          <dd className="mt-1 font-mono text-zinc-100">{formatTimestamp(execution.executedAt)}</dd>
        </div>
      </dl>
    </section>
  );
}

function PolicyExplanation({ explanation }: { explanation: string }) {
  return (
    <section aria-label="Policy explanation" className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-5">
      <h3 className="font-mono text-xs uppercase tracking-wider text-cyan-300 mb-2">Why this action is allowed</h3>
      <p className="text-sm text-zinc-300">{explanation}</p>
    </section>
  );
}

export default function PolicyApproval() {
  const snapshot = useSyncExternalStore(
    policyPilotRuntime.subscribe,
    getSnapshot,
    getSnapshot,
  );

  const { currentProposal, currentApproval, currentExecution, policy } = snapshot;
  const [showDialog, setShowDialog] = useState(false);

  const handleApprove = () => {
    policyPilotRuntime.approveCurrentProposal();
    setShowDialog(false);
  };

  if (currentExecution) {
    return (
      <>
        <ExecutionRecorded execution={currentExecution} />
        <PolicyExplanation explanation={policy.explanation} />
      </>
    );
  }

  if (currentApproval) {
    return (
      <>
        <ApprovalRecorded approval={currentApproval} />
        <PolicyExplanation explanation={policy.explanation} />
      </>
    );
  }

  if (currentProposal) {
    return (
      <>
        <section aria-label="Rollback proposal awaiting approval" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="flex items-center gap-2 mb-4">
            <span aria-hidden="true" className="size-2 rounded-full bg-amber-500" />
            <h2 className="font-semibold text-amber-200">Human approval required</h2>
          </div>
          <ProposalDetails proposal={currentProposal} />
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setShowDialog(true)}
              className="rounded-md bg-amber-500 px-4 py-2 font-mono text-xs font-medium text-zinc-950 hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 transition-colors"
            >
              Review and approve rollback
            </button>
          </div>
        </section>
        {showDialog && (
          <ApprovalDialog
            proposal={currentProposal}
            onApprove={handleApprove}
            onCancel={() => setShowDialog(false)}
          />
        )}
        <PolicyExplanation explanation={policy.explanation} />
      </>
    );
  }

  return (
    <>
      <section aria-label="Policy state" className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-5">
        <p className="text-sm text-zinc-300">
          Inspect and draft are allowed. Rollback execution requires human approval.
        </p>
      </section>
      <PolicyExplanation explanation={policy.explanation} />
    </>
  );
}