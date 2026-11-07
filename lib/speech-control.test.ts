import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyUtterance, foldSpeech } from "./speech-control";

describe("pause words", () => {
  it("drops pause commands and ignores speech until a resume word", () => {
    const paused = applyUtterance("looking for a pause bot sales executive in London", false);
    assert.equal(paused.text, "looking for a");
    assert.equal(paused.paused, true);

    const resumed = applyUtterance("ignore this continue London", true);
    assert.equal(resumed.text, "London");
    assert.equal(resumed.paused, false);
  });

  it("never keeps the trigger words, including unpause inside a longer command", () => {
    const once = applyUtterance("sales pause executive unpause bot designer", false);
    assert.equal(once.text, "sales designer");
    assert.equal(once.paused, false);
    assert.equal(once.text.includes("pause"), false);
    assert.equal(once.text.includes("unpause"), false);
  });

  it("folds final and interim chunks without writing a paused interim", () => {
    const folded = foldSpeech([
      { text: "looking for a pause", isFinal: true },
      { text: "bot keep talking", isFinal: false },
    ]);
    assert.equal(folded.paused, true);
    assert.equal(folded.text.includes("keep talking"), false);
    assert.equal(folded.text.includes("pause"), false);
  });
});
