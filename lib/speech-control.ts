export type SpeechChunk = {
  text: string;
  isFinal: boolean;
};

type SpeechAction = "pause" | "resume";

const COMMANDS: { source: string; action: SpeechAction }[] = [
  { source: String.raw`\bunpause bot\b[.,!?]*`, action: "resume" },
  { source: String.raw`\bpause bot\b[.,!?]*`, action: "pause" },
  { source: String.raw`\bunpause\b[.,!?]*`, action: "resume" },
  { source: String.raw`\bcontinue\b[.,!?]*`, action: "resume" },
  { source: String.raw`\bpause\b[.,!?]*`, action: "pause" },
];

function findCommand(
  text: string,
  from: number,
): { index: number; length: number; action: SpeechAction } | null {
  const slice = text.slice(from);
  let best: { index: number; length: number; action: SpeechAction } | null = null;
  for (const command of COMMANDS) {
    const match = new RegExp(command.source, "i").exec(slice);
    if (!match || match.index === undefined) continue;
    const found = { index: from + match.index, length: match[0].length, action: command.action };
    if (
      !best ||
      found.index < best.index ||
      (found.index === best.index && found.length > best.length)
    ) {
      best = found;
    }
  }
  return best;
}

export function applyUtterance(
  raw: string,
  startPaused: boolean,
): { text: string; paused: boolean } {
  let paused = startPaused;
  let cursor = 0;
  let kept = "";
  while (cursor < raw.length) {
    const command = findCommand(raw, cursor);
    if (!command) {
      if (!paused) kept += raw.slice(cursor);
      break;
    }
    if (!paused) kept += raw.slice(cursor, command.index);
    paused = command.action === "pause";
    cursor = command.index + command.length;
  }
  return { text: kept.replace(/\s+/g, " ").trim(), paused };
}

export function foldSpeech(chunks: SpeechChunk[]): { text: string; paused: boolean } {
  let paused = false;
  const finals: string[] = [];
  let interim = "";
  for (const chunk of chunks) {
    const applied = applyUtterance(chunk.text, paused);
    paused = applied.paused;
    if (chunk.isFinal) {
      if (applied.text) finals.push(applied.text);
      interim = "";
    } else {
      interim = applied.text;
    }
  }
  const text = [...finals, interim].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return { text, paused };
}
