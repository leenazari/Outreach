import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commuteDecision } from "./location-fit";

const london = { location: "London", workplace: "" };

describe("commute", () => {
  it("keeps a nearby UK city and drops a distant one", () => {
    assert.equal(commuteDecision("Reading, United Kingdom", london), "match");
    assert.equal(commuteDecision("Manchester, United Kingdom", london), "excluded");
    assert.equal(commuteDecision("Paris, France", london), "excluded");
  });

  it("keeps an unknown location and uses the country when the spec is remote", () => {
    assert.equal(commuteDecision("", london), "unknown");
    assert.equal(commuteDecision("United Kingdom", london), "unknown");
    assert.equal(commuteDecision("Edinburgh", { location: "London", workplace: "Remote" }), "match");
    assert.equal(commuteDecision("Paris, France", { location: "London", workplace: "Remote" }), "excluded");
    assert.equal(commuteDecision("Manchester", { location: "London", workplace: "Hybrid" }), "excluded");
  });
});
