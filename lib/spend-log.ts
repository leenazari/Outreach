import { ENRICH_ACTOR, INDEED_ACTOR, POST_ACTOR, PROFILE_ACTOR } from "./actors";
import { buildSearchSpend, type SpendRunInput } from "./attribute";
import {
  getActorRun,
  getDatasetItemsForRun,
  listActorRuns,
  listParseSpends,
  listSearchGroups,
  type ParseSpendRecord,
  type SearchGroupRecord,
} from "./apify";
import type { ActorRunSnapshot } from "./charge";
import { parseRunCharge } from "./charge";
import { microsToUsd, usdToMicros } from "./money";
import { normaliseIndeedResume, normaliseLinkedInPost, normaliseLinkedInProfile } from "./normalise";
import type { CandidateSpend, RawCandidate, RunSpend, WorkRole } from "./types";

const ACTORS = [PROFILE_ACTOR, POST_ACTOR, INDEED_ACTOR, ENRICH_ACTOR];
const CLUSTER_MS = 25_000;

export type SpendSearchGroup = {
  searchId: string | null;
  jobTitle: string;
  location: string;
  startedAt: string | null;
  totalUsd: number | null;
  settlingUsd: number;
  settled: boolean;
  unassignedUsd: number;
  runs: RunSpend[];
  candidates: CandidateSpend[];
  note: string;
};

export type SpendLog = {
  configured: boolean;
  error: string | null;
  settledUsd: number;
  todayUsd: number;
  monthUsd: number;
  settlingUsd: number;
  pendingCount: number;
  searches: SpendSearchGroup[];
  note: string;
};

type TaggedRun = { actor: string; run: ActorRunSnapshot };

function londonParts(iso: string): { day: string; month: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return null;
  return { day: `${year}-${month}-${day}`, month: `${year}-${month}` };
}

function peopleFor(actor: string, run: ActorRunSnapshot, items: unknown[]): RawCandidate[] {
  const people: RawCandidate[] = [];
  items.forEach((item, itemIndex) => {
    const candidate =
      actor === INDEED_ACTOR
        ? normaliseIndeedResume(item)
        : actor === POST_ACTOR
          ? normaliseLinkedInPost(item, [])
          : normaliseLinkedInProfile(item);
    if (!candidate) return;
    const source = actor === ENRICH_ACTOR ? "linkedin-detail" : actor === POST_ACTOR ? "linkedin-post" : actor === INDEED_ACTOR ? "indeed-resume" : "linkedin-profile";
    if (source === "linkedin-detail") {
      candidate.experience = (candidate.experience ?? []).map(
        (role): WorkRole => ({ ...role, source: "linkedin-detail" }),
      );
    }
    candidate.origins = [
      {
        runId: run.id,
        actor,
        source,
        itemIndex,
        hasExperience: (candidate.experience?.length ?? 0) > 0,
      },
    ];
    people.push(candidate);
  });
  return people;
}

function cluster(runs: TaggedRun[]): TaggedRun[][] {
  const ordered = [...runs].sort((a, b) => (a.run.startedAt ?? "").localeCompare(b.run.startedAt ?? ""));
  const groups: TaggedRun[][] = [];
  for (const entry of ordered) {
    const started = entry.run.startedAt ? new Date(entry.run.startedAt).getTime() : Number.NaN;
    const current = groups[groups.length - 1];
    const first = current?.[0]?.run.startedAt ? new Date(current[0].run.startedAt).getTime() : Number.NaN;
    if (!current || !Number.isFinite(started) || !Number.isFinite(first) || started - first > CLUSTER_MS) {
      groups.push([entry]);
    } else {
      current.push(entry);
    }
  }
  return groups;
}

async function mapPool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await task(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function groupSpend(searchId: string | null, meta: SearchGroupRecord | null, inputs: SpendRunInput[]): SpendSearchGroup {
  const spend = buildSearchSpend({
    mode: "live",
    searchId,
    runs: inputs,
    records: inputs.flatMap((input) => (input.run ? peopleFor(input.actor, input.run, input.items) : [])),
    returnedIds: null,
  });
  const startedAt = meta?.startedAt || inputs.map((input) => input.run?.startedAt).find(Boolean) || null;
  return {
    searchId,
    jobTitle: meta?.jobTitle || "Apify run",
    location: meta?.location || "",
    startedAt,
    totalUsd: llmTotal(spend.totalUsd, meta?.llm?.usd ?? 0),
    settlingUsd: spend.settlingUsd,
    settled: spend.settled,
    unassignedUsd: spend.unassignedUsd,
    runs: meta?.llm ? [...spend.runs, llmRun(meta.llm)] : spend.runs,
    candidates: spend.candidates,
    note: spend.note,
  };
}

function llmTotal(apifyUsd: number | null, llmUsd: number): number | null {
  if (apifyUsd === null) return llmUsd > 0 ? llmUsd : null;
  return Math.round((apifyUsd + llmUsd) * 1_000_000) / 1_000_000;
}

function llmRun(llm: NonNullable<SearchGroupRecord["llm"]>): RunSpend {
  return {
    actor: "ai-gateway",
    label: "AI match",
    runId: null,
    status: "SUCCEEDED",
    startedAt: null,
    settled: true,
    totalUsd: llm.usd,
    lines: [
      {
        label: `${llm.model}: ${llm.inputTokens} input tokens, ${llm.outputTokens} output tokens, ${llm.calls} calls`,
        usd: llm.usd,
        kind: "event",
        allocated: false,
        count: llm.calls,
      },
    ],
    consoleUrl: null,
    note: "Token cost for the AI match on this search.",
  };
}

export async function loadSpendLog(token: string | undefined, now = new Date()): Promise<SpendLog> {
  const trimmed = token?.trim() ?? "";
  if (!trimmed) {
    return {
      configured: false,
      error: null,
      settledUsd: 0,
      todayUsd: 0,
      monthUsd: 0,
      settlingUsd: 0,
      pendingCount: 0,
      searches: [],
      note: "APIFY_TOKEN is not set, so there is no Apify spend to read. Offline demo searches are not stored.",
    };
  }

  try {
    const listed = await Promise.all(ACTORS.map(async (actor) => ({ actor, ...(await listActorRuns(trimmed, actor)) })));
    if (listed.some((entry) => entry.status === 401 || entry.status === 403)) {
      return {
        configured: true,
        error: "Apify rejected APIFY_TOKEN. Check the token on the server.",
        settledUsd: 0,
        todayUsd: 0,
        monthUsd: 0,
        settlingUsd: 0,
        pendingCount: 0,
        searches: [],
        note: "",
      };
    }

    const byId = new Map<string, TaggedRun>();
    for (const entry of listed) {
      for (const run of entry.runs) byId.set(run.id, { actor: entry.actor, run });
    }
    const groups = await listSearchGroups(trimmed).catch(() => [] as SearchGroupRecord[]);
    const used = new Set<string>();
    const grouped: { meta: SearchGroupRecord | null; runs: TaggedRun[] }[] = [];
    for (const meta of groups) {
      const runs = meta.runIds.map((id) => byId.get(id)).filter((run): run is TaggedRun => Boolean(run));
      if (runs.length === 0) continue;
      for (const run of runs) used.add(run.run.id);
      grouped.push({ meta, runs });
    }
    const loose = [...byId.values()].filter((entry) => !used.has(entry.run.id));
    for (const runs of cluster(loose)) grouped.push({ meta: null, runs });

    grouped.sort((a, b) => {
      const left = a.meta?.startedAt || a.runs[0]?.run.startedAt || "";
      const right = b.meta?.startedAt || b.runs[0]?.run.startedAt || "";
      return right.localeCompare(left);
    });

    const hydrateIds = new Set(grouped.slice(0, 8).flatMap((group) => group.runs.map((entry) => entry.run.id)));
    const hydrated = new Map<string, { run: ActorRunSnapshot; items: unknown[] }>();
    await mapPool([...hydrateIds], 4, async (runId) => {
      const tagged = byId.get(runId);
      if (!tagged) return;
      const fresh = (await getActorRun(trimmed, runId)) ?? tagged.run;
      const items = fresh.defaultDatasetId ? await getDatasetItemsForRun(trimmed, fresh.defaultDatasetId) : [];
      hydrated.set(runId, { run: fresh, items });
    });

    const searches = grouped.map((group) => {
      const inputs: SpendRunInput[] = group.runs.map((entry) => {
        const fresh = hydrated.get(entry.run.id);
        return { actor: entry.actor, run: fresh?.run ?? entry.run, items: fresh?.items ?? [] };
      });
      return groupSpend(group.meta?.searchId ?? null, group.meta, inputs);
    });

    const today = londonParts(now.toISOString());
    let settled = 0;
    let todayMicros = 0;
    let monthMicros = 0;
    let settling = 0;
    let pendingCount = 0;
    for (const entry of byId.values()) {
      const fresh = hydrated.get(entry.run.id)?.run ?? entry.run;
      const charge = parseRunCharge(fresh, 0);
      if (charge.totalMicros === null) {
        pendingCount += 1;
        continue;
      }
      if (!charge.settled) settling += charge.totalMicros;
      else {
        settled += charge.totalMicros;
        const parts = fresh.startedAt ? londonParts(fresh.startedAt) : null;
        if (today && parts?.day === today.day) todayMicros += charge.totalMicros;
        if (today && parts?.month === today.month) monthMicros += charge.totalMicros;
      }
    }
    for (const meta of groups) {
      const llmUsd = meta.llm?.usd ?? 0;
      if (llmUsd <= 0) continue;
      const micros = usdToMicros(llmUsd);
      settled += micros;
      const parts = meta.startedAt ? londonParts(meta.startedAt) : null;
      if (today && parts?.day === today.day) todayMicros += micros;
      if (today && parts?.month === today.month) monthMicros += micros;
    }
    const parses = await listParseSpends(trimmed).catch(() => [] as ParseSpendRecord[]);
    for (const parse of parses) {
      if (parse.usd <= 0) continue;
      const micros = usdToMicros(parse.usd);
      settled += micros;
      const parts = parse.startedAt ? londonParts(parse.startedAt) : null;
      if (today && parts?.day === today.day) todayMicros += micros;
      if (today && parts?.month === today.month) monthMicros += micros;
      searches.push({
        searchId: parse.id,
        jobTitle: parse.jobTitle ? `Spec reading: ${parse.jobTitle}` : "Spec reading",
        location: "",
        startedAt: parse.startedAt,
        totalUsd: parse.usd,
        settlingUsd: 0,
        settled: true,
        unassignedUsd: 0,
        runs: [
          {
            actor: "ai-gateway",
            label: "Spec reading",
            runId: null,
            status: "SUCCEEDED",
            startedAt: parse.startedAt,
            settled: true,
            totalUsd: parse.usd,
            lines: [
              {
                label: `${parse.model}: ${parse.inputTokens} input tokens, ${parse.outputTokens} output tokens`,
                usd: parse.usd,
                kind: "event",
                allocated: false,
              },
            ],
            consoleUrl: null,
            note: "Token cost for reading the job spec into the form.",
          },
        ],
        candidates: [],
        note: "Token cost for reading the job spec into the form.",
      });
    }
    searches.sort((left, right) => (right.startedAt || "").localeCompare(left.startedAt || ""));

    return {
      configured: true,
      error: null,
      settledUsd: microsToUsd(settled),
      todayUsd: microsToUsd(todayMicros),
      monthUsd: microsToUsd(monthMicros),
      settlingUsd: microsToUsd(settling),
      pendingCount,
      searches,
      note: "Totals use usageTotalUsd on the most recent 30 runs of each actor this app calls. Today and this month follow Europe/London. Open the page again to re-read runs whose charge was still settling. Sample demo searches are not included.",
    };
  } catch {
    return {
      configured: true,
      error: "The Apify spend log could not be read. Reload the page to try again.",
      settledUsd: 0,
      todayUsd: 0,
      monthUsd: 0,
      settlingUsd: 0,
      pendingCount: 0,
      searches: [],
      note: "",
    };
  }
}

export function sumMicros(values: number[]): number {
  return values.reduce((total, value) => total + usdToMicros(value), 0);
}
