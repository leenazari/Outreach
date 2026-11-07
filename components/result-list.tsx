"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatUsdAmount } from "@/lib/money";
import { weightedPoints } from "@/lib/identity";
import type { Candidate, SearchResponse, SourceId, ValidationStatus } from "@/lib/types";
import { SOURCE_LABELS } from "@/lib/types";

const SOURCE_ORDER: SourceId[] = ["linkedin-profile", "linkedin-post", "indeed-resume"];

function PublicNotice() {
  return (
    <p className="rounded-2xl border border-[#c9ddd9] bg-[#e7f3f1] px-4 py-3 text-sm leading-6 text-[#0b3f3b]">
      Results come from public data only. No one has been contacted.
    </p>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-3" aria-live="polite">
      <p className="font-medium">Searching three public sources in parallel.</p>
      <ul className="grid gap-2">
        {["LinkedIn profiles", "LinkedIn posts", "Indeed resumes"].map((label) => (
          <li key={label} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3">
            <span className="size-2.5 animate-pulse rounded-full bg-primary" aria-hidden />
            <span className="text-sm">{label}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm leading-6 text-muted-foreground">
        Sample data returns immediately. A live Apify run can take a minute or two and still finishes if one actor
        fails.
      </p>
    </div>
  );
}

const VALIDATION_CLASS: Record<ValidationStatus, string> = {
  verified: "border-[#c9ddd9] bg-[#e7f3f1] text-[#0b3f3b]",
  review: "border-[#efd3ae] bg-[#fbf3e6] text-[#7a4510]",
  risk: "border-[#efc7c7] bg-[#fdf2f2] text-[#8c3030]",
};

export function ResultList({
  status,
  error,
  result,
  tokenConfigured,
}: {
  status: "idle" | "loading" | "error" | "ready";
  error: string | null;
  result: SearchResponse | null;
  tokenConfigured: boolean;
}) {
  return (
    <section className="grid gap-4" aria-busy={status === "loading"} aria-live="polite">
      <PublicNotice />
      <p className="text-sm font-medium">Only 10 results are returned per search.</p>

      {status === "idle" ? (
        <div className="grid gap-3 rounded-2xl border border-dashed border-border bg-card/70 p-5">
          <h2 className="font-serif text-2xl tracking-tight">A shortlist, not a campaign</h2>
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">
            Paste a job spec and search. The server reads it into criteria, then calls Apify. The token stays on the
            server. A live search spends Apify credit, shown with the results.
          </p>
          <ul className="grid gap-2 text-sm leading-6">
            <li>LinkedIn profiles: title, location, and a recent job change.</li>
            <li>LinkedIn posts: only the competitor or complaint phrases you list.</li>
            <li>Indeed resumes: best effort. A miss here does not wipe the other results.</li>
          </ul>
        </div>
      ) : null}

      {status === "loading" ? <LoadingState /> : null}

      {!tokenConfigured ? (
        <p className="rounded-2xl border border-[#efc7c7] bg-[#fdf2f2] px-4 py-3 text-sm leading-6 text-[#8c3030]" role="alert">
          APIFY_TOKEN is not set, so a live search cannot run. Add it on the server and reload.
        </p>
      ) : null}

      {status === "error" ? (
        <p className="rounded-2xl border border-[#efc7c7] bg-[#fdf2f2] px-4 py-3 text-sm leading-6 text-[#8c3030]" role="alert">
          {error ?? "The search could not be completed."}
        </p>
      ) : null}

      {status === "ready" && result ? <Ready result={result} /> : null}
    </section>
  );
}

function Ready({ result }: { result: SearchResponse }) {
  return (
    <div className="grid gap-4">
      {result.mode === "sample" ? (
        <p className="rounded-2xl border border-[#efd3ae] bg-[#fbf3e6] px-4 py-3 text-sm leading-6 text-[#7a4510]">
          Sample data. These profiles are fictional, labelled so they cannot be mistaken for a live shortlist. No
          Apify actors ran.
        </p>
      ) : (
        <p className="rounded-2xl border border-border bg-card px-4 py-3 text-sm leading-6 text-muted-foreground">
          Live public data for {result.spec.jobTitle} in {result.spec.location}. Salary band {result.spec.salaryLabel}{" "}
          was not scored.
        </p>
      )}

      <p className="text-sm leading-6 text-muted-foreground">
        {result.stats.collected} records collected · {result.stats.afterDedupe} after dedupe ·{" "}
        {result.stats.droppedForMustHave} dropped for a country contradiction · {result.stats.returned} ranked
        {result.spec.salaryLabel !== "Not specified" ? ` · Salary ${result.spec.salaryLabel} not scored` : ""}
      </p>
      <p className="text-sm leading-6">
        <a className="font-medium underline decoration-[#c9ddd9] underline-offset-4" href="/api/candidates/export">
          Interviewa JSON export
        </a>
        <span aria-hidden> · </span>
        <a className="font-medium underline decoration-[#c9ddd9] underline-offset-4" href="/api/candidates/export?format=csv">
          CSV of all candidates
        </a>
      </p>

      <SearchCost result={result} />

      {result.notices.length > 0 ? (
        <ul className="grid gap-2">
          {result.notices.map((notice) => (
            <li
              key={`${notice.source}-${notice.message}`}
              className={
                notice.level === "warning"
                  ? "rounded-xl border border-[#efd3ae] bg-[#fbf6ee] px-3 py-2 text-sm leading-6 text-[#7a4510]"
                  : "rounded-xl border border-border bg-card px-3 py-2 text-sm leading-6 text-muted-foreground"
              }
            >
              {notice.message}
            </li>
          ))}
        </ul>
      ) : null}

      {result.candidates.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-serif text-2xl tracking-tight">No one was left in this search</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {result.stats.droppedForMustHave} profile{result.stats.droppedForMustHave === 1 ? "" : "s"} listed a
            different country from the spec. Everyone else is scored, including people whose short profile did not
            mention a requirement.
          </p>
        </div>
      ) : (
        <ol className="grid gap-3">
          {result.candidates.map((candidate, index) => (
            <CandidateCard key={candidate.id} candidate={candidate} index={index} result={result} />
          ))}
        </ol>
      )}

      <details className="rounded-2xl border border-border bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">Actor inputs for this spec</summary>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {result.mode === "sample"
            ? "Not sent. This response was not a live Apify search."
            : "Sent from the server to the Apify API. The token stays on the server."}
        </p>
        <div className="mt-3 grid gap-3">
          {result.plannedRuns.map((plan) => (
            <div key={plan.actor}>
              <p className="text-sm font-medium">{plan.actor}</p>
              <p className="text-sm leading-6 text-muted-foreground">{plan.purpose}</p>
              {plan.skipped || !plan.input ? (
                <p className="mt-1 text-sm">Skipped.</p>
              ) : (
                <pre className="mt-2 overflow-x-auto rounded-xl bg-[#1c1916] p-3 text-xs leading-5 text-[#f3efe7]">
                  {JSON.stringify(plan.input, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </details>

      <p className="text-xs leading-5 text-muted-foreground">
        Signals: recent job change +15, watched-phrase post +15, resume snippet +10. Validation adjusts the score
        after that. Source order checked: {SOURCE_ORDER.map((source) => SOURCE_LABELS[source]).join(", ")}.
      </p>
    </div>
  );
}

function CandidateCard({
  candidate,
  index,
  result,
}: {
  candidate: Candidate;
  index: number;
  result: SearchResponse;
}) {
  return (
    <li className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">{index + 1}</p>
          {candidate.profileUrl && candidate.name ? (
            <a
              href={candidate.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-serif text-2xl tracking-tight text-foreground underline decoration-[#c9ddd9] underline-offset-4 hover:decoration-primary"
            >
              {candidate.name}
            </a>
          ) : (
            <p className="font-serif text-2xl tracking-tight">{candidate.name ?? "Name not published"}</p>
          )}
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {candidate.title}
            {candidate.company ? (
              <>
                <span aria-hidden> · </span>
                {candidate.company}
              </>
            ) : null}
            <span aria-hidden> · </span>
            {candidate.location}
          </p>
        </div>
        <p className="shrink-0 text-right">
          <span className="font-serif text-3xl tabular-nums tracking-tight">{candidate.score}%</span>
          <span className="mt-1 block text-xs text-muted-foreground">match</span>
        </p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
        <div className="h-full rounded-full bg-primary" style={{ width: `${candidate.score}%` }} />
      </div>
      <ul className="mt-3 grid gap-1">
        {candidate.subscores.map((item) => (
          <li key={item.key} className="flex items-baseline justify-between gap-3 text-sm leading-6">
            <span>
              {item.label}
              <span className="text-muted-foreground"> · {item.reason}</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {item.assessed ? `${item.score} · ${weightedPoints(item)}/${item.weight}` : "not assessed"}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm leading-6">{candidate.experienceSummary}</p>
      {candidate.skills.length > 0 ? (
        <p className="mt-1 text-sm leading-6 text-muted-foreground">Skills: {candidate.skills.join(", ")}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge className={VALIDATION_CLASS[candidate.validation.status]}>{candidate.validation.label}</Badge>
        {candidate.sources.map((source) => (
          <Badge key={source} variant="outline">
            {SOURCE_LABELS[source]}
          </Badge>
        ))}
      </div>
      {candidate.sourceUrl ? (
        <p className="mt-2 text-sm leading-6">
          <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline decoration-[#c9ddd9] underline-offset-4">
            Open source page
          </a>
        </p>
      ) : null}
      <p className="mt-3 text-sm leading-6">{candidate.snippet}</p>
      <ul className="mt-3 grid gap-2">
        {candidate.validation.reasons.map((reason) => (
          <li key={reason.summary} className="text-sm leading-6">
            <span className="font-medium">{reason.summary}</span>{" "}
            <span className="text-muted-foreground">{reason.evidence}</span>
          </li>
        ))}
      </ul>
      <CandidateCost result={result} candidateId={candidate.id} />
    </li>
  );
}

function SearchCost({ result }: { result: SearchResponse }) {
  const spend = result.spend;
  return (
    <div className="grid gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-2xl tracking-tight">Apify charge</h2>
        <p className="font-serif text-3xl tabular-nums tracking-tight">{formatUsdAmount(spend.totalUsd)}</p>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{spend.note}</p>
      {spend.settlingUsd > 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">
          Still settling, and included in the figure above: {formatUsdAmount(spend.settlingUsd)}. The spend log reads
          those runs again.
        </p>
      ) : null}
      <ul className="grid gap-3">
        {spend.runs.map((run) => (
          <li key={`${run.actor}-${run.runId ?? "none"}`} className="text-sm leading-6">
            <p className="font-medium">
              {run.label}
              <span className="ml-2 tabular-nums text-muted-foreground">{formatUsdAmount(run.totalUsd)}</span>
            </p>
            {run.lines.length > 0 ? (
              <ul className="mt-1 grid gap-1 text-muted-foreground">
                {run.lines.map((line) => (
                  <li key={`${line.label}-${line.usd}`}>
                    {line.label}
                    {line.count ? ` × ${line.count}` : ""} · {formatUsdAmount(line.usd)}
                    {line.allocated ? " · allocated" : ""}
                    {line.kind === "platform" ? " · platform usage" : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{run.note}</p>
            )}
          </li>
        ))}
      </ul>
      {spend.unassignedUsd > 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">
          Not on the shortlist: {formatUsdAmount(spend.unassignedUsd)}
          {spend.mode === "live" ? " · allocated to records that were filtered out or could not be tied to a person" : ""}
        </p>
      ) : null}
      <Link href="/spend" className="text-sm font-medium underline decoration-[#c9ddd9] underline-offset-4">
        Review every Apify charge
      </Link>
    </div>
  );
}

function CandidateCost({ result, candidateId }: { result: SearchResponse; candidateId: string }) {
  if (result.mode === "sample") {
    return <p className="mt-3 text-sm text-muted-foreground">Apify charge for this person: $0.00. Sample data is not spend.</p>;
  }
  const spend = result.spend.candidates.find((candidate) => candidate.candidateId === candidateId);
  if (!spend) {
    return <p className="mt-3 text-sm text-muted-foreground">No settled Apify charge was tied to this person.</p>;
  }
  return (
    <div className="mt-3 grid gap-1">
      <p className="text-sm font-medium">Apify charge for this person: {formatUsdAmount(spend.totalUsd)}</p>
      <ul className="grid gap-1">
        {spend.lines.map((line) => (
          <li key={`${line.actor}-${line.field}-${line.allocated}-${line.usd}`} className="text-sm leading-6 text-muted-foreground">
            {line.field} from {line.sourceLabel}: {formatUsdAmount(line.usd)}
            {line.allocated ? " · allocated" : " · per-event charge"}
          </li>
        ))}
      </ul>
    </div>
  );
}

