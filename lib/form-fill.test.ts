import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_REQUEST } from "../components/demo-spec";
import { applyParsedSpec, pickCurrency, pickParsedField } from "./form-fill";

describe("parsed form fields", () => {
  it("fills empty fields and leaves a field the user edited", () => {
    const current = { ...EMPTY_REQUEST, specText: "I'm looking for a marketing executive in London", jobTitle: "Brand lead" };
    const next = applyParsedSpec(
      current,
      {
        jobTitle: "marketing executive",
        location: "London",
        industry: "B2B SaaS",
        yearsExperience: "3",
      },
      new Set(["jobTitle"]),
    );
    assert.equal(next.jobTitle, "Brand lead");
    assert.equal(next.location, "London");
    assert.equal(next.industry, "B2B SaaS");
    assert.equal(next.yearsExperience, "3");
    assert.equal(next.specText, current.specText);
  });

  it("keeps a cleared field when it was edited and fills one that was not", () => {
    assert.equal(pickParsedField("", "marketing executive", true), "");
    assert.equal(pickParsedField("", "marketing executive", false), "marketing executive");
    assert.equal(pickParsedField("Brand lead", "marketing executive", false), "Brand lead");
    assert.equal(pickCurrency("GBP", "USD", false), "USD");
    assert.equal(pickCurrency("GBP", "USD", true), "GBP");
  });
});
