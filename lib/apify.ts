import { ACTOR_TIMEOUT_SECS } from "./actors";
import { readRunSnapshot, withSettledUsageTotal, type ActorRunSnapshot } from "./charge";
import type { SourceId } from "./types";
import { asRecord, asString } from "./text";

export type ActorRunOptions = {
  timeoutSecs?: number;
  settleWaitMs?: number;
};

export type ActorRunResult = {
  items: unknown[];
  run: ActorRunSnapshot | null;
};

export type ActorRunner = (actor: string, input: Record<string, unknown>, options?: ActorRunOptions) => Promise<ActorRunResult>;

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);
const SEARCH_STORE = "interviewa-candidate-finder";

export class SourceFailure extends Error {
  readonly source: SourceId;
  readonly run: ActorRunSnapshot | null;

  constructor(source: SourceId, message: string, run: ActorRunSnapshot | null = null) {
    super(message);
    this.name = "SourceFailure";
    this.source = source;
    this.run = run;
  }
}

export function buildActorRunsUrl(actor: string, timeoutSecs: number): string {
  const actorId = actor.replaceAll("/", "~");
  const params = new URLSearchParams({
    timeout: String(timeoutSecs),
    waitForFinish: "60",
  });
  return `https://api.apify.com/v2/acts/${actorId}/runs?${params.toString()}`;
}

function redact(text: string, token: string): string {
  const clipped = text.replace(/\s+/g, " ").trim().slice(0, 280);
  if (!token) return clipped;
  return clipped.split(token).join("[redacted]");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apifyFetch(token: string, url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
}

export async function getActorRun(token: string, runId: string): Promise<ActorRunSnapshot | null> {
  const response = await apifyFetch(token, `https://api.apify.com/v2/actor-runs/${runId}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return null;
  return readRunSnapshot(await response.json());
}

async function getDatasetItems(token: string, datasetId: string): Promise<unknown[]> {
  const params = new URLSearchParams({ clean: "true", format: "json", limit: "100" });
  const response = await apifyFetch(
    token,
    `https://api.apify.com/v2/datasets/${datasetId}/items?${params.toString()}`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (!response.ok) return [];
  const payload: unknown = await response.json();
  return Array.isArray(payload) ? payload : [];
}

export function createApifyRunner(token: string, timeoutSecs = ACTOR_TIMEOUT_SECS): ActorRunner {
  return async (actor, input, options) => {
    const timeout = options?.timeoutSecs ?? timeoutSecs;
    const started = Date.now();
    const deadline = started + (timeout + 20) * 1000;
    const response = await fetch(buildActorRunsUrl(actor, timeout), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(Math.min(70_000, Math.max(5_000, deadline - Date.now()))),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(redact(`${actor} returned HTTP ${response.status}: ${text}`, token));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${actor} returned a non-JSON run.`);
    }
    let run = readRunSnapshot(parsed);
    if (!run) throw new Error(`${actor} did not return a run id.`);

    while (run.status && !TERMINAL.has(run.status) && Date.now() < deadline) {
      await sleep(3_000);
      run = (await getActorRun(token, run.id)) ?? run;
    }

    if (run.status && TERMINAL.has(run.status)) {
      const settleBy = Math.min(Date.now() + 20_000, deadline);
      let previous = "";
      while (Date.now() < settleBy) {
        const signature = `${run.usageTotalUsd ?? ""}:${JSON.stringify(run.chargedEventCounts)}`;
        const usageReady = TERMINAL.has(run.status ?? "") && run.usageTotalUsd !== null && run.usageTotalUsd > 0;
        if (usageReady && signature === previous) break;
        previous = signature;
        const pause = Math.min(2_000, settleBy - Date.now());
        if (pause <= 0) break;
        await sleep(pause);
        run = (await getActorRun(token, run.id)) ?? run;
      }
      run = withSettledUsageTotal(run, actor);
    }

    const items = run.defaultDatasetId ? await getDatasetItems(token, run.defaultDatasetId) : [];
    return { items, run };
  };
}

export type SearchGroupRecord = {
  searchId: string;
  startedAt: string;
  jobTitle: string;
  location: string;
  runIds: string[];
};

async function ensureSearchStore(token: string): Promise<void> {
  const response = await apifyFetch(token, "https://api.apify.com/v2/key-value-stores", {
    method: "POST",
    body: JSON.stringify({ name: SEARCH_STORE }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok || response.status === 409) return;
}

export async function putStoreRecord(token: string, key: string, value: unknown): Promise<void> {
  await ensureSearchStore(token);
  await apifyFetch(token, `https://api.apify.com/v2/key-value-stores/${SEARCH_STORE}/records/${key}`, {
    method: "PUT",
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(15_000),
  });
}

export async function getStoreRecord(token: string, key: string): Promise<unknown | null> {
  const response = await apifyFetch(token, `https://api.apify.com/v2/key-value-stores/${SEARCH_STORE}/records/${key}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  return response.json();
}

export async function saveSearchGroup(token: string, group: SearchGroupRecord): Promise<void> {
  await ensureSearchStore(token);
  await apifyFetch(token, `https://api.apify.com/v2/key-value-stores/${SEARCH_STORE}/records/search-${group.searchId}`, {
    method: "PUT",
    body: JSON.stringify({
      searchId: group.searchId,
      startedAt: group.startedAt,
      jobTitle: group.jobTitle,
      location: group.location,
      runIds: group.runIds,
    }),
    signal: AbortSignal.timeout(15_000),
  });
}

export async function listSearchGroups(token: string): Promise<SearchGroupRecord[]> {
  const keysResponse = await apifyFetch(
    token,
    `https://api.apify.com/v2/key-value-stores/${SEARCH_STORE}/keys?limit=100`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!keysResponse.ok) return [];
  const payload: unknown = await keysResponse.json();
  const items = asRecord(asRecord(payload)?.data)?.items;
  if (!Array.isArray(items)) return [];
  const keys = items
    .map((item) => asString(asRecord(item)?.key))
    .filter((key) => key.startsWith("search-"));
  const groups: SearchGroupRecord[] = [];
  for (const key of keys) {
    const response = await apifyFetch(token, `https://api.apify.com/v2/key-value-stores/${SEARCH_STORE}/records/${key}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) continue;
    const record = asRecord(await response.json());
    const searchId = record ? asString(record.searchId) : "";
    const runIds = record && Array.isArray(record.runIds) ? record.runIds.filter((id) => typeof id === "string") : [];
    if (!searchId || runIds.length === 0) continue;
    groups.push({
      searchId,
      startedAt: asString(record?.startedAt),
      jobTitle: asString(record?.jobTitle),
      location: asString(record?.location),
      runIds,
    });
  }
  return groups;
}

export async function listActorRuns(
  token: string,
  actor: string,
  limit = 30,
): Promise<{ runs: ActorRunSnapshot[]; status: number }> {
  const actorId = actor.replaceAll("/", "~");
  const params = new URLSearchParams({ desc: "1", limit: String(limit) });
  const response = await apifyFetch(token, `https://api.apify.com/v2/acts/${actorId}/runs?${params.toString()}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return { runs: [], status: response.status };
  const payload: unknown = await response.json();
  const items = asRecord(asRecord(payload)?.data)?.items;
  if (!Array.isArray(items)) return { runs: [], status: response.status };
  return {
    status: response.status,
    runs: items.map((item) => readRunSnapshot(item)).filter((run): run is ActorRunSnapshot => run !== null),
  };
}

export async function getDatasetItemsForRun(token: string, datasetId: string): Promise<unknown[]> {
  return getDatasetItems(token, datasetId);
}
