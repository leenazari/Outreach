import { ACTOR_TIMEOUT_SECS } from "./actors";

export type ActorRunner = (actor: string, input: Record<string, unknown>) => Promise<unknown[]>;

export class SourceFailure extends Error {
  readonly source: "linkedin-profile" | "linkedin-post" | "indeed-resume";

  constructor(source: SourceFailure["source"], message: string) {
    super(message);
    this.name = "SourceFailure";
    this.source = source;
  }
}

export function buildSyncDatasetUrl(actor: string, timeoutSecs: number): string {
  const actorId = actor.replaceAll("/", "~");
  const params = new URLSearchParams({
    timeout: String(timeoutSecs),
    format: "json",
    clean: "true",
    limit: "100",
  });
  return `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?${params.toString()}`;
}

function redact(text: string, token: string): string {
  const clipped = text.replace(/\s+/g, " ").trim().slice(0, 280);
  if (!token) return clipped;
  return clipped.split(token).join("[redacted]");
}

export function createApifyRunner(token: string, timeoutSecs = ACTOR_TIMEOUT_SECS): ActorRunner {
  return async (actor, input) => {
    const response = await fetch(buildSyncDatasetUrl(actor, timeoutSecs), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((timeoutSecs + 15) * 1000),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(redact(`${actor} returned HTTP ${response.status}: ${text}`, token));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${actor} returned a non-JSON payload.`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`${actor} did not return a dataset item list.`);
    }
    return parsed;
  };
}
