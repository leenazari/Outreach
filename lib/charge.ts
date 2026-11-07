import { allocateMicros, microsToUsd, usdToMicros } from "./money";
import type { CostLine } from "./types";
import { asRecord, asString } from "./text";

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

const PLATFORM_LABELS: Record<string, string> = {
  ACTOR_COMPUTE_UNITS: "Compute units",
  DATASET_READS: "Dataset reads",
  DATASET_WRITES: "Dataset writes",
  KEY_VALUE_STORE_READS: "Key-value reads",
  KEY_VALUE_STORE_WRITES: "Key-value writes",
  KEY_VALUE_STORE_LISTS: "Key-value lists",
  REQUEST_QUEUE_READS: "Request queue reads",
  REQUEST_QUEUE_WRITES: "Request queue writes",
  DATA_TRANSFER_INTERNAL_GBYTES: "Internal data transfer",
  DATA_TRANSFER_EXTERNAL_GBYTES: "External data transfer",
  PROXY_RESIDENTIAL_TRANSFER_GBYTES: "Residential proxy",
  PROXY_SERPS: "SERP proxy",
  PROXY_UNBLOCKER_UNITS: "Proxy unblocking",
};

export type EventPrice = {
  title: string;
  unitUsd: number | null;
  oneTime: boolean;
};

export type ActorRunSnapshot = {
  id: string;
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  usageTotalUsd: number | null;
  usageUsd: Record<string, number> | null;
  chargedEventCounts: Record<string, number> | null;
  accountedChargedEventCounts: Record<string, number> | null;
  eventUsage: Record<string, { eventTotalUsd: number; eventTitle: string }> | null;
  pricingModel: string | null;
  platformUsagePaidByUser: boolean | null;
  platformUsageBillingModel: string | null;
  eventPrices: Record<string, EventPrice>;
  pricePerUnitUsd: number | null;
  unitName: string | null;
  defaultDatasetId: string | null;
  consoleUrl: string | null;
};

export type MicroLine = {
  label: string;
  micros: number;
  kind: CostLine["kind"];
  allocated: boolean;
  shared: boolean;
  count?: number;
  unitMicros?: number;
};

export type ParsedCharge = {
  settled: boolean;
  totalUsd: number | null;
  totalMicros: number | null;
  lines: CostLine[];
  microLines: MicroLine[];
  note: string;
};

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function numberMap(value: unknown): Record<string, number> | null {
  const record = asRecord(value);
  if (!record) return null;
  const mapped: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    const amount = finiteNumber(entry);
    if (amount === null || amount === 0) continue;
    mapped[key] = amount;
  }
  return mapped;
}

function countMap(value: unknown): Record<string, number> | null {
  const record = asRecord(value);
  if (!record) return null;
  const mapped: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    const count = finiteNumber(entry);
    if (count === null) continue;
    mapped[key] = count;
  }
  return mapped;
}

export function readRunSnapshot(payload: unknown): ActorRunSnapshot | null {
  const root = asRecord(payload);
  if (!root) return null;
  const data = asRecord(root.data) ?? root;
  const id = asString(data.id);
  if (!id) return null;

  const pricing = asRecord(data.pricingInfo);
  const perEvent = asRecord(asRecord(pricing?.pricingPerEvent)?.actorChargeEvents);
  const eventPrices: Record<string, EventPrice> = {};
  if (perEvent) {
    for (const [name, value] of Object.entries(perEvent)) {
      const event = asRecord(value);
      if (!event) continue;
      eventPrices[name] = {
        title: asString(event.eventTitle) || name,
        unitUsd: finiteNumber(event.eventPriceUsd),
        oneTime: event.isOneTimeEvent === true || /start/i.test(name) || /actor start/i.test(asString(event.eventTitle)),
      };
    }
  }

  const usageEvents = asRecord(data.eventUsage);
  const eventUsage: ActorRunSnapshot["eventUsage"] = usageEvents ? {} : null;
  if (usageEvents && eventUsage) {
    for (const [name, value] of Object.entries(usageEvents)) {
      const entry = asRecord(value);
      const total = entry ? finiteNumber(entry.eventTotalUsd) : null;
      if (total === null) continue;
      eventUsage[name] = {
        eventTotalUsd: total,
        eventTitle: asString(entry?.eventTitle) || eventPrices[name]?.title || name,
      };
    }
  }

  const platformFlag = pricing?.isPPEPlatformUsagePaidByUser;
  return {
    id,
    status: asString(data.status) || null,
    startedAt: asString(data.startedAt) || null,
    finishedAt: asString(data.finishedAt) || null,
    usageTotalUsd: finiteNumber(data.usageTotalUsd),
    usageUsd: numberMap(data.usageUsd),
    chargedEventCounts: countMap(data.chargedEventCounts),
    accountedChargedEventCounts: countMap(data.accountedChargedEventCounts),
    eventUsage: eventUsage && Object.keys(eventUsage).length > 0 ? eventUsage : null,
    pricingModel: asString(pricing?.pricingModel) || null,
    platformUsagePaidByUser: typeof platformFlag === "boolean" ? platformFlag : null,
    platformUsageBillingModel: asString(data.platformUsageBillingModel) || null,
    eventPrices,
    pricePerUnitUsd: finiteNumber(pricing?.pricePerUnitUsd),
    unitName: asString(pricing?.unitName) || null,
    defaultDatasetId: asString(data.defaultDatasetId) || null,
    consoleUrl: asString(data.consoleUrl) || `https://console.apify.com/view/runs/${id}`,
  };
}

function accountingLag(run: ActorRunSnapshot): boolean {
  const charged = run.chargedEventCounts;
  const accounted = run.accountedChargedEventCounts;
  if (!charged || !accounted) return false;
  return Object.entries(charged).some(([name, count]) => count > (accounted[name] ?? 0));
}

function userPaysPlatform(run: ActorRunSnapshot): boolean {
  if (run.pricingModel === "PAY_PER_EVENT") {
    if (run.platformUsagePaidByUser === false) return false;
    if (run.platformUsagePaidByUser === true) return true;
    return run.platformUsageBillingModel === "USER" && run.usageUsd !== null;
  }
  return run.usageUsd !== null;
}

function eventLines(run: ActorRunSnapshot, itemCount: number): MicroLine[] {
  const counts = run.chargedEventCounts ?? {};
  if (run.eventUsage) {
    return Object.entries(run.eventUsage).map(([name, usage]) => {
      const meta = run.eventPrices[name];
      const count = counts[name];
      const oneTime = meta?.oneTime === true || /start/i.test(name) || /actor start/i.test(usage.eventTitle);
      const micros = Math.max(0, usdToMicros(usage.eventTotalUsd));
      return {
        label: usage.eventTitle || meta?.title || name,
        micros,
        kind: "event" as const,
        allocated: false,
        shared: oneTime || count === undefined || itemCount === 0 || count !== itemCount,
        count,
        unitMicros: count && count > 0 ? Math.round(micros / count) : undefined,
      };
    });
  }

  const lines: MicroLine[] = [];
  for (const [name, count] of Object.entries(counts)) {
    const meta = run.eventPrices[name];
    if (!meta || meta.unitUsd === null || count <= 0) continue;
    const micros = usdToMicros(meta.unitUsd) * count;
    lines.push({
      label: meta.title || name,
      micros,
      kind: "event",
      allocated: false,
      shared: meta.oneTime || itemCount === 0 || count !== itemCount,
      count,
      unitMicros: usdToMicros(meta.unitUsd),
    });
  }
  return lines;
}

function platformLines(run: ActorRunSnapshot): MicroLine[] {
  if (!userPaysPlatform(run) || !run.usageUsd) return [];
  return Object.entries(run.usageUsd)
    .filter(([, amount]) => amount > 0)
    .map(([key, amount]) => ({
      label: PLATFORM_LABELS[key] ?? key.replaceAll("_", " ").toLowerCase(),
      micros: Math.max(0, usdToMicros(amount)),
      kind: "platform" as const,
      allocated: false,
      shared: true,
    }));
}

function reconcile(lines: MicroLine[], totalMicros: number): MicroLine[] {
  const present = lines.filter((line) => line.micros > 0);
  const sum = present.reduce((total, line) => total + line.micros, 0);
  if (sum === totalMicros) return present;
  if (sum < totalMicros) {
    return [
      ...present,
      {
        label: present.length === 0 ? "Apify reported run cost" : "Remainder of usageTotalUsd",
        micros: totalMicros - sum,
        kind: "remainder",
        allocated: true,
        shared: true,
      },
    ];
  }
  const scaled = allocateMicros(
    totalMicros,
    present.map((line) => line.micros),
  );
  return present.map((line, index) => ({
    ...line,
    micros: scaled[index] ?? 0,
    allocated: true,
    shared: true,
  }));
}

function toCostLine(line: MicroLine): CostLine {
  return {
    label: line.label,
    usd: microsToUsd(line.micros),
    kind: line.kind,
    allocated: line.allocated,
    count: line.count,
    unitUsd: line.unitMicros === undefined ? undefined : microsToUsd(line.unitMicros),
  };
}

export function parseRunCharge(run: ActorRunSnapshot | null, itemCount: number): ParsedCharge {
  if (!run) {
    return {
      settled: false,
      totalUsd: null,
      totalMicros: null,
      lines: [],
      microLines: [],
      note: "Apify did not return a run object, so no charge was recorded.",
    };
  }

  const terminal = run.status ? TERMINAL.has(run.status) : false;
  const total = run.usageTotalUsd;
  if (!terminal || total === null) {
    return {
      settled: false,
      totalUsd: total,
      totalMicros: total === null ? null : usdToMicros(total),
      lines: [],
      microLines: [],
      note: terminal
        ? "The run finished, but usageTotalUsd is not on it yet. The spend log reads the run again."
        : "The run has not finished, so the charge is not final. The spend log reads the run again.",
    };
  }

  const totalMicros = Math.max(0, usdToMicros(total));
  let microLines = [...eventLines(run, itemCount), ...platformLines(run)];
  if (
    microLines.length === 0 &&
    run.pricingModel === "PRICE_PER_DATASET_ITEM" &&
    run.pricePerUnitUsd !== null &&
    itemCount > 0
  ) {
    const perItem = usdToMicros(run.pricePerUnitUsd) * itemCount;
    if (perItem === totalMicros) {
      microLines = [
        {
          label: run.unitName ? `Per ${run.unitName}` : "Per result",
          micros: perItem,
          kind: "event",
          allocated: false,
          shared: false,
          count: itemCount,
          unitMicros: usdToMicros(run.pricePerUnitUsd),
        },
      ];
    }
  }
  microLines = reconcile(microLines, totalMicros);
  const settled = !accountingLag(run);
  return {
    settled,
    totalUsd: microsToUsd(totalMicros),
    totalMicros,
    lines: microLines.map(toCostLine),
    microLines,
    note: settled
      ? "Total is usageTotalUsd, the amount Apify says this run costs you."
      : "usageTotalUsd is on the run, but accountedChargedEventCounts is still behind chargedEventCounts. The spend log reads the run again.",
  };
}
