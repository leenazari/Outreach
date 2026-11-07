export type SpeechResultSlice = {
  transcript: string;
  isFinal: boolean;
};

export type SpeechEventLike = {
  resultIndex: number;
  results: SpeechResultSlice[];
};

export type TranscriptState = {
  finalText: string;
  interim: string;
};

export function emptyTranscript(): TranscriptState {
  return { finalText: "", interim: "" };
}

function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function mergeFinal(previous: string, incoming: string): string {
  const next = tidy(incoming);
  const prior = tidy(previous);
  if (!next) return prior;
  if (!prior) return next;
  const priorKey = prior.toLowerCase();
  const nextKey = next.toLowerCase();
  if (nextKey.startsWith(priorKey) || priorKey.startsWith(nextKey)) {
    return nextKey.length >= priorKey.length ? next : prior;
  }
  const limit = Math.min(priorKey.length, nextKey.length);
  for (let size = limit; size >= 8; size -= 1) {
    if (priorKey.endsWith(nextKey.slice(0, size))) {
      return tidy(`${prior}${next.slice(size)}`);
    }
  }
  return tidy(`${prior} ${next}`);
}

export function applySpeechEvent(state: TranscriptState, event: SpeechEventLike): TranscriptState {
  const start = Number.isFinite(event.resultIndex) ? Math.max(0, event.resultIndex) : 0;
  let finalText = state.finalText;
  let interim = "";
  for (let index = start; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (!result) continue;
    if (result.isFinal) {
      finalText = mergeFinal(finalText, result.transcript);
      interim = "";
    } else {
      interim = tidy(result.transcript);
    }
  }
  return { finalText, interim };
}

export function transcriptPreview(state: TranscriptState): string {
  return tidy([state.finalText, state.interim].filter(Boolean).join(" "));
}
