import Link from "next/link";
import { formatUsdAmount } from "@/lib/money";
import type { SpendLog } from "@/lib/spend-log";

function when(iso: string | null): string {
  if (!iso) return "Time not reported";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Time not reported";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function SpendView({ log }: { log: SpendLog }) {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-4xl tracking-tight">Apify spend</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Charges come from each actor run’s <span className="font-medium text-foreground">usageTotalUsd</span>, the
            amount Apify says you pay. This page reads the runs again on every visit.
          </p>
        </div>
        <Link href="/spend" className="text-sm font-medium underline decoration-[#c9ddd9] underline-offset-4">
          Refresh
        </Link>
      </div>

      {log.error ? (
        <p className="rounded-2xl border border-[#efc7c7] bg-[#fdf2f2] px-4 py-3 text-sm leading-6 text-[#8c3030]" role="alert">
          {log.error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Settled total", formatUsdAmount(log.settledUsd)],
          ["Today", formatUsdAmount(log.todayUsd)],
          ["This month", formatUsdAmount(log.monthUsd)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 font-serif text-3xl tabular-nums tracking-tight">{value}</p>
          </div>
        ))}
      </div>
      {log.settlingUsd > 0 || log.pendingCount > 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">
          Still settling: {formatUsdAmount(log.settlingUsd)}. Runs with no usageTotalUsd yet: {log.pendingCount}. Those
          figures are not in the settled total.
        </p>
      ) : null}
      {log.note ? <p className="text-sm leading-6 text-muted-foreground">{log.note}</p> : null}

      {log.searches.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card/70 p-5 text-sm leading-6 text-muted-foreground">
          No actor runs to show yet.
        </p>
      ) : (
        <ol className="grid gap-4">
          {log.searches.map((search) => (
            <li key={`${search.searchId ?? "loose"}-${search.startedAt}-${search.runs.map((run) => run.runId).join("-")}`} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-serif text-2xl tracking-tight">
                    {search.jobTitle}
                    {search.location ? ` · ${search.location}` : ""}
                  </p>
                  <p className="text-sm text-muted-foreground">{when(search.startedAt)}</p>
                </div>
                <p className="font-serif text-3xl tabular-nums tracking-tight">{formatUsdAmount(search.totalUsd)}</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{search.note}</p>
              <ul className="mt-3 grid gap-3">
                {search.runs.map((run) => (
                  <li key={`${run.runId ?? run.actor}`} className="text-sm leading-6">
                    <p className="font-medium">
                      {run.label}
                      <span className="ml-2 tabular-nums">{formatUsdAmount(run.totalUsd)}</span>
                      {run.settled ? "" : " · not final"}
                    </p>
                    {run.runId ? (
                      <a
                        href={run.consoleUrl ?? `https://console.apify.com/view/runs/${run.runId}`}
                        className="text-muted-foreground underline decoration-[#c9ddd9] underline-offset-4"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Run {run.runId}
                      </a>
                    ) : null}
                    {run.lines.length > 0 ? (
                      <ul className="mt-1 text-muted-foreground">
                        {run.lines.map((line) => (
                          <li key={`${run.runId}-${line.label}-${line.usd}`}>
                            {line.label}
                            {line.count ? ` × ${line.count}` : ""} · {formatUsdAmount(line.usd)}
                            {line.allocated ? " · allocated" : ""}
                            {line.kind === "platform" ? " · platform usage" : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
              {search.candidates.length > 0 ? (
                <ul className="mt-4 grid gap-2">
                  {search.candidates.map((candidate) => (
                    <li key={candidate.candidateId} className="text-sm leading-6">
                      <span className="font-medium">{candidate.name}</span>
                      <span className="ml-2 tabular-nums text-muted-foreground">{formatUsdAmount(candidate.totalUsd)}</span>
                      <ul className="text-muted-foreground">
                        {candidate.lines.map((line) => (
                          <li key={`${candidate.candidateId}-${line.field}-${line.actor}-${line.allocated}-${line.usd}`}>
                            {line.field} from {line.sourceLabel}: {formatUsdAmount(line.usd)}
                            {line.allocated ? " · allocated" : " · per-event charge"}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : null}
              {search.unassignedUsd > 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Not tied to a returned profile: {formatUsdAmount(search.unassignedUsd)} · allocated
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      <p className="text-sm leading-6 text-muted-foreground">
        <Link href="/" className="font-medium underline decoration-[#c9ddd9] underline-offset-4">
          Back to the shortlist
        </Link>
      </p>
    </div>
  );
}
