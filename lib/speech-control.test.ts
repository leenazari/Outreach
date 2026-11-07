import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySpeechEvent, emptyTranscript, transcriptPreview, type SpeechEventLike, type TranscriptState } from "./speech-control";

function play(events: SpeechEventLike[]): TranscriptState {
  return events.reduce(applySpeechEvent, emptyTranscript());
}

describe("speech transcript", () => {
  it("replaces cumulative Android interim results instead of appending them", () => {
    const state = play([
      { resultIndex: 0, results: [{ transcript: "I'm", isFinal: false }] },
      { resultIndex: 0, results: [{ transcript: "I'm looking", isFinal: false }] },
      { resultIndex: 0, results: [{ transcript: "I'm looking for", isFinal: false }] },
      { resultIndex: 0, results: [{ transcript: "I'm looking for a", isFinal: false }] },
    ]);
    assert.equal(state.finalText, "");
    assert.equal(state.interim, "I'm looking for a");
    assert.equal(transcriptPreview(state), "I'm looking for a");
    assert.equal(transcriptPreview(state).includes("I'm I'm"), false);
  });

  it("commits only final results and keeps the latest interim separate", () => {
    const state = play([
      { resultIndex: 0, results: [{ transcript: "I'm looking for a", isFinal: true }] },
      {
        resultIndex: 1,
        results: [
          { transcript: "I'm looking for a", isFinal: true },
          { transcript: "marketing", isFinal: false },
        ],
      },
      {
        resultIndex: 1,
        results: [
          { transcript: "I'm looking for a", isFinal: true },
          { transcript: "marketing executive", isFinal: false },
        ],
      },
    ]);
    assert.equal(state.finalText, "I'm looking for a");
    assert.equal(state.interim, "marketing executive");
    assert.equal(transcriptPreview(state), "I'm looking for a marketing executive");
  });

  it("starts from resultIndex so earlier finals in the list are not added again", () => {
    const state = play([
      { resultIndex: 0, results: [{ transcript: "I'm looking for a", isFinal: true }] },
      {
        resultIndex: 1,
        results: [
          { transcript: "I'm looking for a", isFinal: true },
          { transcript: "marketing executive", isFinal: true },
        ],
      },
    ]);
    assert.equal(state.finalText, "I'm looking for a marketing executive");
    assert.equal(state.interim, "");
  });

  it("replaces the transcript when a restarted session repeats the previous final", () => {
    const started = play([
      { resultIndex: 0, results: [{ transcript: "I'm looking for a marketing executive", isFinal: true }] },
    ]);
    const restarted = applySpeechEvent(started, {
      resultIndex: 0,
      results: [{ transcript: "I'm looking for a marketing executive in London", isFinal: true }],
    });
    assert.equal(restarted.finalText, "I'm looking for a marketing executive in London");
    assert.equal(transcriptPreview(restarted).includes("executive I'm looking"), false);
  });
});
