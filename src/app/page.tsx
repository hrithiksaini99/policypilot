import LiveIncidentDashboard from "@/components/live-incident-dashboard";
import WebMCPStatus from "@/components/webmcp-status";
import AgentActivity from "@/components/agent-activity";
import PolicyApproval from "@/components/policy-approval";
import ScenarioSelector from "@/components/scenario-selector";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <section
        aria-label="PolicyPilot introduction"
        className="mb-8 border-b border-zinc-800 pb-8 sm:mb-10"
      >
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-cyan-300">PolicyPilot / Day 4</p>
        <p className="mt-4 text-balance text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
          Human authority. Agent speed.
        </p>
        <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400 sm:text-base sm:leading-7">
          A policy-controlled operations room for the agent-native web.
        </p>
        <ScenarioSelector />
      </section>
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <LiveIncidentDashboard />
        <WebMCPStatus />
      </div>
      <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <AgentActivity />
        <PolicyApproval />
      </div>
    </main>
  );
}