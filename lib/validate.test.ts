import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkRole } from "./types";
import { validateProfile } from "./validate";

const now = new Date("2026-11-07T12:00:00.000Z");

function role(overrides: Partial<WorkRole> & Pick<WorkRole, "title" | "company" | "start" | "end">): WorkRole {
  return {
    location: "London",
    detail: "B2B sales",
    source: "linkedin-profile",
    ...overrides,
  };
}

describe("profile validation", () => {
  it("marks a consistent dated history as verified", () => {
    const result = validateProfile(
      {
        title: "Sales Executive",
        location: "London",
        connections: 400,
        experience: [
          role({ title: "Sales Executive", company: "Northwind", start: "2018-01", end: "2023-12" }),
          role({ title: "Sales Executive", company: "Harbor", start: "2024-01", end: null }),
        ],
      },
      { mustHave: ["at least 2 years B2B sales experience"] },
      now,
    );
    assert.equal(result.status, "verified");
    assert.equal(result.label, "Verified consistent");
  });

  it("flags overlapping employers, short tenures, and a years gap as needs review", () => {
    const result = validateProfile(
      {
        title: "Sales Executive",
        location: "London",
        connections: 35,
        experience: [
          role({ title: "Sales Executive", company: "Harbor Labs", start: "2026-09", end: null }),
          role({
            title: "Sales Executive",
            company: "Northwind Goods",
            location: "Manchester",
            start: "2024-01",
            end: null,
            source: "indeed-resume",
          }),
        ],
      },
      { mustHave: ["at least 2 years B2B sales experience"] },
      now,
    );
    assert.equal(result.status, "review");
    assert.equal(result.label, "Needs review");
    assert.match(result.reasons.map((reason) => reason.evidence).join(" "), /Northwind Goods/);
    assert.equal(JSON.stringify(result).toLowerCase().includes("scam"), false);
  });

  it("marks impossible dates as high risk without calling anyone a fraud", () => {
    const result = validateProfile(
      {
        title: "VP of Sales",
        location: "London",
        connections: 8,
        experience: [
          role({ title: "VP of Sales", company: "Alpha", start: "2026-06", end: "2026-01" }),
          role({ title: "VP of Sales", company: "Beta", start: "2026-04", end: null }),
        ],
      },
      { mustHave: [] },
      now,
    );
    assert.equal(result.status, "risk");
    assert.equal(result.label, "High risk");
    assert.match(result.reasons.map((reason) => reason.summary).join(" "), /ends before it starts/);
    assert.equal(JSON.stringify(result).toLowerCase().includes("fraud"), false);
  });
});
