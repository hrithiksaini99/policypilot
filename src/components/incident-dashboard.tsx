import type { IncidentContext } from "@/lib/incident";

function formatStartedAt(startedAt: string): string {
  const iso = new Date(startedAt).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function getStatusStyles(status: IncidentContext["status"]) {
  if (status === "healthy") {
    return {
      badge: "rounded-full bg-emerald-500/15 px-3 py-1 font-mono text-xs font-semibold tracking-wide text-emerald-300 ring-1 ring-emerald-500/40",
      dot: "size-2 rounded-full bg-emerald-400",
      signalBorder: "border-l-2 border-emerald-500/70 bg-black/30 px-3 py-2 text-sm leading-6 text-zinc-200",
    };
  }
  if (status === "mitigated") {
    return {
      badge: "rounded-full bg-emerald-500/15 px-3 py-1 font-mono text-xs font-semibold tracking-wide text-emerald-300 ring-1 ring-emerald-500/40",
      dot: "size-2 rounded-full bg-emerald-400",
      signalBorder: "border-l-2 border-emerald-500/70 bg-black/30 px-3 py-2 text-sm leading-6 text-zinc-200",
    };
  }
  return {
    badge: "rounded-full bg-amber-500/15 px-3 py-1 font-mono text-xs font-semibold tracking-wide text-amber-300 ring-1 ring-amber-500/40",
    dot: "size-2 rounded-full bg-amber-400",
    signalBorder: "border-l-2 border-amber-500/70 bg-black/30 px-3 py-2 text-sm leading-6 text-zinc-200",
  };
}

export default function IncidentDashboard({ incident }: { incident: IncidentContext }) {
  const styles = getStatusStyles(incident.status);

  return (
    <section
      aria-label="Incident context"
      className="flex min-w-0 flex-col gap-6 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-7"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">
          Incident context
        </p>
        <span className={styles.badge}>
          {incident.severity}
        </span>
      </div>

      <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight text-zinc-50 sm:text-3xl">
        {incident.summary}
      </h1>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 min-[420px]:grid-cols-3 lg:grid-cols-2">
        <div className="min-w-0">
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Incident</dt>
          <dd className="mt-1 font-mono text-sm font-medium text-zinc-100">{incident.incidentId}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Service</dt>
          <dd className="mt-1 break-words font-mono text-sm font-medium text-zinc-100">{incident.service}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Status</dt>
          <dd className="mt-1 flex items-center gap-2 text-sm font-medium text-zinc-100">
            <span aria-hidden="true" className={styles.dot} />
            {incident.status === "healthy" ? (
              <span className={styles.badge}>Healthy</span>
            ) : (
              incident.status
            )}
          </dd>
        </div>
        <div className="min-w-0 col-span-2 min-[420px]:col-span-3 lg:col-span-1">
          <dt className="font-mono text-xs uppercase tracking-wider text-zinc-400">Started</dt>
          <dd className="mt-1 font-mono text-sm font-medium text-zinc-100">
            <time dateTime={incident.startedAt}>{formatStartedAt(incident.startedAt)}</time>
          </dd>
        </div>
      </dl>

      <div>
        <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">Health signals</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {incident.signals.map((signal) => (
            <li
              key={signal}
              className={styles.signalBorder}
            >
              {signal}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
