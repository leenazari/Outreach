import { Badge } from "@/components/ui/badge";
import type { SearchResponse, SourceId } from "@/lib/types";
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

export function ResultList({
  status,
  error,
  result,
}: {
  status: "idle" | "loading" | "error" | "ready";
  error: string | null;
  result: SearchResponse | null;
}) {
  return (
    <section className="grid gap-4" aria-busy={status === "loading"} aria-live="polite">
      <PublicNotice />
      <p className="text-sm font-medium">Only 10 results are returned per search.</p>

      {status === "idle" ? (
        <div className="grid gap-3 rounded-2xl border border-dashed border-border bg-card/70 p-5">
          <h2 className="font-serif text-2xl tracking-tight">A shortlist, not a campaign</h2>
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">
            The spec on the left is sent to the server. With sample data on, you get fictional people scored by the
            same rules as a live run. With it off, the server calls three Apify actors and never shows the token to
            this page.
          </p>
          <ul className="grid gap-2 text-sm leading-6">
            <li>LinkedIn profiles: title, location, and a recent job change.</li>
            <li>LinkedIn posts: only the competitor or complaint phrases you list.</li>
            <li>Indeed resumes: best effort. A miss here does not wipe the other results.</li>
          </ul>
        </div>
      ) : null}

      {status === "loading" ? <LoadingState /> : null}

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
        {result.stats.droppedForMustHave} dropped for a missing must-have · {result.stats.returned} ranked
        {result.spec.salaryLabel !== "Not specified" ? ` · Salary ${result.spec.salaryLabel} not scored` : ""}
      </p>

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
          <h2 className="font-serif text-2xl tracking-tight">No one matched every must-have</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {result.stats.droppedForMustHave} profile{result.stats.droppedForMustHave === 1 ? "" : "s"} failed the
            keyword gate. Broaden a must-have, or move it to nice-to-have, and search again.
          </p>
        </div>
      ) : (
        <ol className="grid gap-3">
          {result.candidates.map((candidate, index) => (
            <li key={candidate.id} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                    {index + 1}
                  </p>
                  {candidate.profileUrl ? (
                    <a
                      href={candidate.profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-serif text-2xl tracking-tight text-foreground underline decoration-[#c9ddd9] underline-offset-4 hover:decoration-primary"
                    >
                      {candidate.name}
                    </a>
                  ) : (
                    <p className="font-serif text-2xl tracking-tight">{candidate.name}</p>
                  )}
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {candidate.title}
                    <span aria-hidden> · </span>
                    {candidate.location}
                  </p>
                </div>
                <p className="shrink-0 text-right">
                  <span className="font-serif text-3xl tabular-nums tracking-tight">{candidate.score}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">out of 100</span>
                </p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {candidate.sample ? (
                  <Badge className="border-[#efd3ae] bg-[#fbf3e6] text-[#7a4510]">Sample data</Badge>
                ) : null}
                {candidate.sources.map((source) => (
                  <Badge key={source} variant="outline">
                    {SOURCE_LABELS[source]}
                  </Badge>
                ))}
                {candidate.profileUrl ? null : <Badge variant="secondary">No public profile link</Badge>}
              </div>

              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
                <div className="h-full rounded-full bg-primary" style={{ width: `${candidate.score}%` }} />
              </div>

              <p className="mt-3 text-sm leading-6">{candidate.snippet}</p>

              <ul className="mt-3 grid gap-1">
                {candidate.why.map((reason) => (
                  <li key={reason.label} className="flex items-baseline justify-between gap-3 text-sm leading-6">
                    <span>{reason.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {reason.points > 0 ? `+${reason.points}` : "required"}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}

      <details className="rounded-2xl border border-border bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">Actor inputs for this spec</summary>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {result.mode === "sample"
            ? "Not sent. Sample data is on, or the server has no APIFY_TOKEN."
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
        Signals: recent job change +15, watched-phrase post +15, resume snippet +10. Source order checked:{" "}
        {SOURCE_ORDER.map((source) => SOURCE_LABELS[source]).join(", ")}.
      </p>
    </div>
  );
}
