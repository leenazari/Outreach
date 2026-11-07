import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRunCharge, readRunSnapshot } from "./charge";
import { usdToMicros } from "./money";

function run(extra: Record<string, unknown>) {
  return readRunSnapshot({
    id: "run-1",
    status: "SUCCEEDED",
    startedAt: "2026-11-07T10:00:00.000Z",
    finishedAt: "2026-11-07T10:01:00.000Z",
    ...extra,
  });
}

describe("Apify run charge", () => {
  it("uses usageTotalUsd and eventUsage dollars, and ignores platform usage the user does not pay", () => {
    const charge = parseRunCharge(
      run({
        usageTotalUsd: 0.11,
        usageUsd: { ACTOR_COMPUTE_UNITS: 0.2, PROXY_RESIDENTIAL_TRANSFER_GBYTES: 0.5 },
        chargedEventCounts: { "search-page": 1, "actor-start": 1 },
        accountedChargedEventCounts: { "search-page": 1, "actor-start": 1 },
        eventUsage: {
          "search-page": { eventTotalUsd: 0.1, eventTitle: "Search page results" },
          "actor-start": { eventTotalUsd: 0.01, eventTitle: "Actor start" },
        },
        pricingInfo: {
          pricingModel: "PAY_PER_EVENT",
          isPPEPlatformUsagePaidByUser: false,
          pricingPerEvent: { actorChargeEvents: {} },
        },
      }),
      10,
    );
    assert.equal(charge.settled, true);
    assert.equal(charge.totalUsd, 0.11);
    assert.equal(
      charge.lines.reduce((sum, line) => sum + usdToMicros(line.usd), 0),
      usdToMicros(0.11),
    );
    assert.equal(charge.lines.some((line) => line.label === "Residential proxy"), false);
    assert.equal(charge.lines.find((line) => line.label === "Search page results")?.usd, 0.1);
  });

  it("adds a remainder so the lines match usageTotalUsd exactly", () => {
    const charge = parseRunCharge(
      run({
        usageTotalUsd: 0.2654,
        eventUsage: {
          result: { eventTotalUsd: 0.25, eventTitle: "Result" },
        },
        chargedEventCounts: { result: 10 },
        pricingInfo: { pricingModel: "PAY_PER_EVENT", isPPEPlatformUsagePaidByUser: false },
      }),
      10,
    );
    assert.equal(
      charge.lines.reduce((sum, line) => sum + usdToMicros(line.usd), 0),
      usdToMicros(0.2654),
    );
    assert.equal(charge.lines.some((line) => line.kind === "remainder"), true);
  });

  it("scales event lines down when they exceed usageTotalUsd and labels them allocated", () => {
    const charge = parseRunCharge(
      run({
        usageTotalUsd: 0.05,
        chargedEventCounts: { result: 2 },
        pricingInfo: {
          pricingModel: "PAY_PER_EVENT",
          isPPEPlatformUsagePaidByUser: false,
          pricingPerEvent: {
            actorChargeEvents: { result: { eventTitle: "Result", eventPriceUsd: 0.049 } },
          },
        },
      }),
      2,
    );
    assert.equal(
      charge.lines.reduce((sum, line) => sum + usdToMicros(line.usd), 0),
      usdToMicros(0.05),
    );
    assert.equal(charge.lines.every((line) => line.allocated), true);
  });

  it("does not invent a total when usageTotalUsd is missing or events are not fully accounted", () => {
    const missing = parseRunCharge(run({ usageTotalUsd: null, status: "SUCCEEDED" }), 1);
    assert.equal(missing.settled, false);
    assert.equal(missing.totalUsd, null);

    const lagging = parseRunCharge(
      run({
        usageTotalUsd: 0.1,
        chargedEventCounts: { result: 2 },
        accountedChargedEventCounts: { result: 1 },
        eventUsage: { result: { eventTotalUsd: 0.1, eventTitle: "Result" } },
        pricingInfo: { pricingModel: "PAY_PER_EVENT", isPPEPlatformUsagePaidByUser: false },
      }),
      2,
    );
    assert.equal(lagging.settled, false);
    assert.equal(lagging.totalUsd, 0.1);
  });

  it("includes usageUsd when the run says the user pays platform usage", () => {
    const charge = parseRunCharge(
      run({
        usageTotalUsd: 0.134,
        usageUsd: { PROXY_RESIDENTIAL_TRANSFER_GBYTES: 0.034 },
        eventUsage: { resume: { eventTotalUsd: 0.1, eventTitle: "Resume" } },
        chargedEventCounts: { resume: 2 },
        pricingInfo: { pricingModel: "PAY_PER_EVENT", isPPEPlatformUsagePaidByUser: true },
      }),
      2,
    );
    assert.equal(charge.lines.some((line) => line.label === "Residential proxy"), true);
    assert.equal(
      charge.lines.reduce((sum, line) => sum + usdToMicros(line.usd), 0),
      usdToMicros(0.134),
    );
  });
});
