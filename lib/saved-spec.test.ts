import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readLastSearch, readStoredRequest } from "./saved-spec";

describe("stored spec", () => {
  it("reads a saved form and ignores a record with no spec", () => {
    const request = readStoredRequest({
      specText: "Marketing executive in London",
      jobTitle: "Brand lead",
      location: "London",
      includeIndeed: false,
      openToWork: true,
      lockedFields: ["jobTitle"],
    });
    assert.equal(request?.jobTitle, "Brand lead");
    assert.equal(request?.location, "London");
    assert.deepEqual(request?.lockedFields, ["jobTitle"]);
    assert.equal(request?.openToWork, true);
    assert.equal(readStoredRequest({ location: "London" }), null);
    assert.equal(readLastSearch('{"specText":"Sales executive in Manchester","jobTitle":"Sales executive"}')?.location, "");
    assert.equal(readLastSearch("not json"), null);
  });
});
