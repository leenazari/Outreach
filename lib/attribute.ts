import { actorLabel, ENRICH_ACTOR, INDEED_ACTOR, POST_ACTOR, PROFILE_ACTOR } from "./actors";
import type { ActorRunSnapshot, MicroLine } from "./charge";
import { parseRunCharge } from "./charge";
import { allocateMicros, microsToUsd } from "./money";
import { candidateKey, dedupeCandidates } from "./rank";
import type {
  ActorPlan,
  CandidateCostLine,
  CandidateSpend,
  RawCandidate,
  RecordOrigin,
  RunSpend,
  SearchSpend,
  WorkSource,
} from "./types";

export type SpendRunInput = {
  actor: string;
  items: unknown[];
  run: ActorRunSnapshot | null;
  cached?: boolean;
};

type FieldShare = {
  field: string;
  micros: number;
  allocated: boolean;
};

function sourceLabel(source: WorkSource, actor: string): string {
  if (source === "linkedin-detail" || actor === ENRICH_ACTOR) return "LinkedIn profile detail";
  if (source === "linkedin-post" || actor === POST_ACTOR) return "LinkedIn post search";
  if (source === "indeed-resume" || actor === INDEED_ACTOR) return "Indeed resumes";
  if (actor === PROFILE_ACTOR) return "LinkedIn profile search";
  return actorLabel(actor);
}

function fieldsFor(origin: RecordOrigin): string[] {
  if (origin.source === "linkedin-detail" || origin.actor === ENRICH_ACTOR) return ["Work history"];
  if (origin.source === "linkedin-post") return ["Recent activity"];
  if (origin.source === "indeed-resume") return origin.hasExperience ? ["CV", "Work history"] : ["CV"];
  return origin.hasExperience ? ["Profile", "Work history"] : ["Profile"];
}

function emptySpend(mode: SearchSpend["mode"], note: string, runs: RunSpend[] = []): SearchSpend {
  return {
    mode,
    searchId: null,
    settled: mode === "sample",
    totalUsd: mode === "sample" ? 0 : null,
    settlingUsd: 0,
    unassignedUsd: 0,
    runs,
    candidates: [],
    note,
  };
}

export function sampleSpend(plans: ActorPlan[]): SearchSpend {
  const runs = plans
    .filter((plan) => !plan.skipped)
    .map((plan) => ({
      actor: plan.actor,
      label: actorLabel(plan.actor),
      runId: null,
      status: null,
      startedAt: null,
      settled: true,
      totalUsd: 0,
      lines: [],
      consoleUrl: null,
      note: "Sample data. No Apify run.",
    }));
  return {
    ...emptySpend("sample", "Sample data costs $0 and is not listed on the spend log.", runs),
    settled: true,
    totalUsd: 0,
  };
}

function runSpend(input: SpendRunInput, chargeLines: MicroLine[], chargeNote: string, settled: boolean, totalUsd: number | null, startedAt: string | null): RunSpend {
  return {
    actor: input.actor,
    label: actorLabel(input.actor),
    runId: input.run?.id ?? null,
    status: input.run?.status ?? null,
    startedAt,
    settled,
    totalUsd,
    lines: chargeLines.map((line) => ({
      label: line.label,
      usd: microsToUsd(line.micros),
      kind: line.kind,
      allocated: line.allocated,
      count: line.count,
      unitUsd: line.unitMicros === undefined ? undefined : microsToUsd(line.unitMicros),
    })),
    consoleUrl: input.run?.consoleUrl ?? null,
    note: chargeNote,
  };
}

export function buildSearchSpend(args: {
  mode: "sample" | "live";
  searchId?: string | null;
  runs: SpendRunInput[];
  records: RawCandidate[];
  returnedIds: Set<string> | null;
}): SearchSpend {
  if (args.mode === "sample") {
    return emptySpend("sample", "Sample data costs $0 and is not listed on the spend log.");
  }

  const deduped = dedupeCandidates(args.records);
  const owners = new Map<string, RawCandidate>();
  for (const record of deduped) {
    for (const origin of record.origins ?? []) {
      if (!origin.runId) continue;
      owners.set(`${origin.runId}:${origin.itemIndex}`, record);
    }
  }

  const buckets = new Map<string, { name: string; lines: CandidateCostLine[]; micros: number }>();
  let unassigned = 0;
  let known = 0;
  let settling = 0;
  let allSettled = true;
  let anyKnown = false;
  const runs: RunSpend[] = [];

  for (const input of args.runs) {
    if (input.cached) {
      runs.push({
        actor: input.actor,
        label: `${actorLabel(input.actor)} (cached)`,
        runId: null,
        status: "SUCCEEDED",
        startedAt: null,
        settled: true,
        totalUsd: 0,
        lines: [{ label: "cached", usd: 0, kind: "event", allocated: false }],
        consoleUrl: null,
        note: "cached",
      });
      anyKnown = true;
      continue;
    }
    const charge = parseRunCharge(input.run, input.items.length);
    runs.push(
      runSpend(input, charge.microLines, charge.note, charge.settled, charge.totalUsd, input.run?.startedAt ?? null),
    );
    if (charge.totalMicros === null) {
      allSettled = false;
      continue;
    }
    anyKnown = true;
    known += charge.totalMicros;
    if (!charge.settled) {
      allSettled = false;
      settling += charge.totalMicros;
    }
    if (input.items.length === 0) {
      unassigned += charge.totalMicros;
      continue;
    }

    const direct = input.items.map(() => 0);
    const shared = input.items.map(() => 0);
    for (const line of charge.microLines) {
      const shares = allocateMicros(
        line.micros,
        input.items.map(() => 1),
      );
      shares.forEach((micros, index) => {
        if (line.shared || line.allocated) shared[index] = (shared[index] ?? 0) + micros;
        else direct[index] = (direct[index] ?? 0) + micros;
      });
    }

    input.items.forEach((_, itemIndex) => {
      const itemDirect = direct[itemIndex] ?? 0;
      const itemShared = shared[itemIndex] ?? 0;
      const itemTotal = itemDirect + itemShared;
      const owner = input.run ? owners.get(`${input.run.id}:${itemIndex}`) : undefined;
      const origin = owner?.origins?.find((entry) => entry.runId === input.run?.id && entry.itemIndex === itemIndex);
      const key = owner ? candidateKey(owner) : "";
      const shown = Boolean(owner) && (args.returnedIds === null || args.returnedIds.has(key));
      if (!owner || !origin || !shown) {
        unassigned += itemTotal;
        return;
      }
      const fields = fieldsFor(origin);
      const directShares = allocateMicros(itemDirect, fields.map(() => 1));
      const sharedShares = allocateMicros(itemShared, fields.map(() => 1));
      const bucket = buckets.get(key) ?? { name: owner.name, lines: [], micros: 0 };
      fields.forEach((field, index) => {
        const directMicros = directShares[index] ?? 0;
        const sharedMicros = sharedShares[index] ?? 0;
        const fieldAllocated = fields.length > 1;
        if (directMicros > 0) {
          bucket.lines.push({
            actor: input.actor,
            sourceLabel: sourceLabel(origin.source, input.actor),
            field,
            usd: microsToUsd(directMicros),
            allocated: fieldAllocated,
          });
          bucket.micros += directMicros;
        }
        if (sharedMicros > 0) {
          bucket.lines.push({
            actor: input.actor,
            sourceLabel: sourceLabel(origin.source, input.actor),
            field,
            usd: microsToUsd(sharedMicros),
            allocated: true,
          });
          bucket.micros += sharedMicros;
        }
      });
      buckets.set(key, bucket);
    });
  }

  const candidates: CandidateSpend[] = [...buckets.entries()]
    .map(([candidateId, bucket]) => ({
      candidateId,
      name: bucket.name,
      totalUsd: microsToUsd(bucket.micros),
      lines: bucket.lines,
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd || a.name.localeCompare(b.name));

  const note = !anyKnown
    ? "Apify has not reported usageTotalUsd for these runs yet. The spend log reads them again."
    : allSettled
      ? "Candidate amounts and the unassigned remainder add up to usageTotalUsd on each settled run."
      : "Some runs are still being accounted. Amounts use the latest usageTotalUsd, and the spend log reads them again.";

  return {
    mode: "live",
    searchId: args.searchId ?? null,
    settled: anyKnown && allSettled,
    totalUsd: anyKnown ? microsToUsd(known) : null,
    settlingUsd: microsToUsd(settling),
    unassignedUsd: microsToUsd(unassigned),
    runs,
    candidates,
    note,
  };
}
