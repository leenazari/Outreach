export type SpokenSpec = {
  jobTitle: string;
  location: string;
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: string;
  mustHave: string;
  niceToHave: string;
  seniority: string;
  yearsExperience: string;
  industry: string;
  workplace: string;
  parser: "openai" | "rules";
};

const UK_PLACES = [
  "London",
  "Manchester",
  "Birmingham",
  "Leeds",
  "Glasgow",
  "Edinburgh",
  "Bristol",
  "Liverpool",
  "Sheffield",
  "Newcastle",
  "Nottingham",
  "Cardiff",
  "Belfast",
  "Leicester",
  "Coventry",
  "Brighton",
  "Oxford",
  "Cambridge",
  "Reading",
  "Southampton",
  "Portsmouth",
  "York",
  "Bath",
  "Aberdeen",
  "Dundee",
  "Swansea",
  "Plymouth",
  "Derby",
  "Milton Keynes",
  "United Kingdom",
  "New York",
  "San Francisco",
  "Los Angeles",
  "Chicago",
  "Boston",
  "Seattle",
  "Austin",
  "Dublin",
  "Paris",
  "Berlin",
  "Munich",
  "Amsterdam",
  "Toronto",
  "Vancouver",
  "Sydney",
  "Melbourne",
  "Singapore",
  "Dubai",
  "Bangalore",
  "Mumbai",
];

const MUST_CUE = String.raw`\b(?:must(?:\s*-\s*|\s+)haves?|needs|essential|required)\b`;
const NICE_CUE = String.raw`\b(?:nice(?:\s*-\s*|\s+)to(?:\s*-\s*|\s+)haves?|ideally|bonus|preferably|preferred|a\s+plus)\b`;

const OPENAI_MODEL = "gpt-4o-mini";

type Cue = { kind: "must" | "nice"; index: number; length: number };

function cleanPhrase(value: string): string {
  return value
    .replace(/^[\s,:;.-]+|[\s,:;.-]+$/g, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function annualAmount(raw: string, unit: string | undefined, inherit: string | undefined): string {
  const amount = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(amount)) return "";
  const marker = (unit || (amount < 1000 ? inherit : "") || "").toLowerCase();
  const annual = marker.startsWith("k") || marker.startsWith("grand") ? Math.round(amount * 1000) : Math.round(amount);
  return String(annual);
}

function currencyFrom(text: string): string {
  if (text.includes("£")) return "GBP";
  if (text.includes("€")) return "EUR";
  if (text.includes("$")) return "USD";
  return "GBP";
}

export function extractSalary(text: string): { salaryMin: string; salaryMax: string; salaryCurrency: string } {
  const range =
    /(?:£|\$|€)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*(k|grand))?\s*(?:to|–|—|-)\s*(?:£|\$|€)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*(k|grand))?/i.exec(
      text,
    );
  if (range) {
    const clause = range[0];
    return {
      salaryMin: annualAmount(range[1] ?? "", range[2], range[4]),
      salaryMax: annualAmount(range[3] ?? "", range[4], range[2]),
      salaryCurrency: currencyFrom(clause),
    };
  }

  const single =
    /(?:£|\$|€)\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*(k|grand))?|\b(\d+(?:\.\d+)?)\s*(k|grand)\b/i.exec(
      text,
    );
  if (!single) return { salaryMin: "", salaryMax: "", salaryCurrency: "GBP" };
  const raw = single[1] || single[3] || "";
  const unit = single[2] || single[4];
  return {
    salaryMin: annualAmount(raw, unit, undefined),
    salaryMax: "",
    salaryCurrency: currencyFrom(single[0]),
  };
}

function matchPlace(value: string): string {
  const normalised = value.toLowerCase();
  return UK_PLACES.find((place) => place.toLowerCase() === normalised) ?? "";
}

export function extractLocation(text: string): string {
  const located = /\bin\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i.exec(text);
  if (located?.[1]) {
    const fromPhrase = matchPlace(located[1]);
    if (fromPhrase) return fromPhrase;
    const firstWord = matchPlace(located[1].split(/\s+/)[0] ?? "");
    if (firstWord) return firstWord;
  }
  for (const place of UK_PLACES) {
    const pattern = new RegExp(`\\b${place.replace(/\s+/g, String.raw`\s+`)}\\b`, "i");
    if (pattern.test(text)) return place;
  }
  return "";
}

const ROLE_WORDS =
  "executive|manager|director|engineer|designer|specialist|consultant|officer|analyst|recruiter|coordinator|associate|developer|marketer|representative|lead";
const ROLE_PHRASE = new RegExp(
  String.raw`\b((?:senior|junior|lead|principal|chief|head)\s+)?((?:[a-z]+)\s+){0,3}?(?:${ROLE_WORDS})\b`,
  "i",
);

function limitTitle(value: string): string {
  return cleanPhrase(value).split(/\s+/).slice(0, 6).join(" ").slice(0, 80);
}

export function extractTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const looking =
    /\blooking\s+for\s+(?:an?\s+)?(.+?)(?=\s+in\s+[A-Za-z]|\s*,|\s+must\b|\s+needs\b|\s+essential\b|\s+who\b|\s+with\b|\s+that\b|\s+and\b|$)/i.exec(
      flat,
    );
  if (looking?.[1]) {
    const captured = cleanPhrase(looking[1]);
    const roleInside = ROLE_PHRASE.exec(captured);
    if (roleInside?.[0]) return limitTitle(roleInside[0]);
    const words = captured.split(/\s+/);
    if (words.length <= 6 && captured.length <= 80) return captured;
  }
  const role = ROLE_PHRASE.exec(flat);
  if (role?.[0]) return limitTitle(role[0]);
  const stripped = flat.replace(
    /^(?:(?:i'm|i am|we're|we are)\s+)?(?:looking\s+for|searching\s+for)\s+(?:an?\s+|the\s+)?/i,
    "",
  );
  const clause = cleanPhrase((stripped.split(/[.,;\n]/)[0] ?? stripped));
  return limitTitle(clause);
}

function findCues(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const [kind, source] of [
    ["must", MUST_CUE],
    ["nice", NICE_CUE],
  ] as const) {
    for (const match of text.matchAll(new RegExp(source, "gi"))) {
      if (match.index === undefined) continue;
      cues.push({ kind, index: match.index, length: match[0].length });
    }
  }
  cues.sort((left, right) => left.index - right.index);
  return cues;
}

function withoutPay(text: string): string {
  return text
    .replace(
      /(?:£|\$|€)\s*\d[\d,]*(?:\s*(?:k|grand))?(?:\s*(?:to|–|—|-)\s*(?:£|\$|€)?\s*\d[\d,]*(?:\s*(?:k|grand))?)?/gi,
      " ",
    )
    .replace(/\b\d+(?:\.\d+)?\s*(?:k|grand)\b(?:\s*(?:to|–|—|-)\s*\d+(?:\.\d+)?\s*(?:k|grand)\b)?/gi, " ");
}

function splitRequirements(chunk: string): string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const part of chunk.split(/,|;|\band\b/i)) {
    const phrase = cleanPhrase(part);
    if (phrase.length < 2) continue;
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
  }
  return phrases;
}

export function extractRequirements(text: string): { mustHave: string[]; niceToHave: string[] } {
  const cues = findCues(text);
  const mustHave: string[] = [];
  const niceToHave: string[] = [];
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (!cue) continue;
    const next = cues[index + 1];
    const chunk = withoutPay(text.slice(cue.index + cue.length, next ? next.index : text.length));
    const phrases = splitRequirements(chunk).filter((phrase) => !/^\d+\+?\s*years?$/i.test(phrase));
    if (cue.kind === "must") mustHave.push(...phrases);
    else niceToHave.push(...phrases);
  }
  return { mustHave, niceToHave };
}

function samePhrase(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function clausesBeyondTitle(text: string, title: string, location: string): { mustHave: string[]; niceToHave: string[] } {
  const mustHave: string[] = [];
  const niceToHave: string[] = [];
  const nicePattern = new RegExp(NICE_CUE, "i");
  for (const part of text.split(/[\n,;]/)) {
    const clause = cleanPhrase(part);
    if (!clause || samePhrase(clause, title) || (location && samePhrase(clause, location))) continue;
    if (extractSalary(clause).salaryMin && clause.length < 40) continue;
    if (nicePattern.test(clause)) {
      const phrase = cleanPhrase(clause.replace(nicePattern, ""));
      if (phrase) niceToHave.push(phrase);
      continue;
    }
    mustHave.push(clause);
  }
  return { mustHave, niceToHave };
}

export function extractSeniority(text: string): string {
  const match = /\b(junior|senior|lead|principal|head|director|vp|vice president|chief)\b/i.exec(text);
  return match?.[1] ? cleanPhrase(match[1]) : "";
}

export function extractYears(text: string): string {
  const match = /\b(\d{1,2})\s*\+?\s*years?\b/i.exec(text);
  return match?.[1] ?? "";
}

export function extractWorkplace(text: string): string {
  if (/\bhybrid\b/i.test(text)) return "Hybrid";
  if (/\bremote\b/i.test(text)) return "Remote";
  if (/\b(on-?site|in the office|office based)\b/i.test(text)) return "Office";
  return "";
}

export function extractIndustry(text: string): string {
  const match = /\b(B2B SaaS|SaaS|fintech|HR tech|software)\b/i.exec(text);
  return match?.[1] ? cleanPhrase(match[1]) : "";
}

export function parseSpokenSpecRules(transcript: string): Omit<SpokenSpec, "parser"> {
  const text = transcript.replace(/\s+/g, " ").trim();
  const salary = extractSalary(text);
  const cued = extractRequirements(text);
  const title = extractTitle(text) || cleanPhrase(text.split(/[\n,]/)[0] ?? text);
  const location = extractLocation(text);
  const listed =
    !/\blooking\s+for\b/i.test(text) && cued.mustHave.length === 0
      ? clausesBeyondTitle(text, title, location)
      : { mustHave: [], niceToHave: [] };
  const mustHave = [...cued.mustHave, ...listed.mustHave];
  const niceToHave = [...cued.niceToHave, ...listed.niceToHave];
  return {
    jobTitle: title,
    location,
    salaryMin: salary.salaryMin,
    salaryMax: salary.salaryMax,
    salaryCurrency: salary.salaryCurrency,
    mustHave: mustHave.join("\n"),
    niceToHave: niceToHave.join("\n"),
    seniority: extractSeniority(title || text),
    yearsExperience: extractYears(text),
    industry: extractIndustry(text),
    workplace: extractWorkplace(text),
  };
}

function asStringList(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? cleanPhrase(item) : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "string") return splitRequirements(value).join("\n") || cleanPhrase(value);
  return "";
}

function asMoney(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.round(value));
  if (typeof value !== "string") return "";
  const salary = extractSalary(value);
  if (salary.salaryMin) return salary.salaryMin;
  const digits = value.replace(/[^\d]/g, "");
  return digits ? String(Number(digits)) : "";
}

function normaliseModelSpec(value: unknown, transcript: string): Omit<SpokenSpec, "parser"> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const rules = parseSpokenSpecRules(transcript);
  const salaryRange = typeof record.salaryRange === "string" ? extractSalary(record.salaryRange) : null;
  const currency = typeof record.salaryCurrency === "string" ? record.salaryCurrency.toUpperCase() : "";
  const jobTitle = typeof record.jobTitle === "string" ? cleanPhrase(record.jobTitle) : "";
  const location = typeof record.location === "string" ? cleanPhrase(record.location) : "";
  return {
    jobTitle: jobTitle || rules.jobTitle,
    location: location || rules.location,
    salaryMin: asMoney(record.salaryMin) || salaryRange?.salaryMin || rules.salaryMin,
    salaryMax: asMoney(record.salaryMax) || salaryRange?.salaryMax || rules.salaryMax,
    salaryCurrency: currency === "GBP" || currency === "EUR" || currency === "USD" ? currency : rules.salaryCurrency,
    mustHave: asStringList(record.mustHave) || rules.mustHave,
    niceToHave: asStringList(record.niceToHave) || rules.niceToHave,
    seniority: (typeof record.seniority === "string" ? cleanPhrase(record.seniority) : "") || rules.seniority,
    yearsExperience: (typeof record.yearsExperience === "string" ? record.yearsExperience.replace(/[^\d]/g, "") : "") || rules.yearsExperience,
    industry: (typeof record.industry === "string" ? cleanPhrase(record.industry) : "") || rules.industry,
    workplace: (typeof record.workplace === "string" ? cleanPhrase(record.workplace) : "") || rules.workplace,
  };
}

async function parseWithOpenAI(transcript: string, apiKey: string): Promise<Omit<SpokenSpec, "parser"> | null> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Extract a recruiter job spec from plain English. Return JSON with jobTitle, location, salaryMin, salaryMax, salaryCurrency, mustHave, and niceToHave. salaryMin and salaryMax are annual numbers as strings, such as "45000". "45 grand" and "45k" mean 45000. salaryCurrency is GBP, EUR, or USD. mustHave and niceToHave are arrays of short phrases. Use an empty string or empty array when something was not said. Do not invent requirements.',
        },
        { role: "user", content: transcript },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) return null;
  const payload: unknown = await response.json();
  const content =
    payload &&
    typeof payload === "object" &&
    "choices" in payload &&
    Array.isArray(payload.choices) &&
    payload.choices[0] &&
    typeof payload.choices[0] === "object" &&
    "message" in payload.choices[0] &&
    payload.choices[0].message &&
    typeof payload.choices[0].message === "object" &&
    "content" in payload.choices[0].message
      ? payload.choices[0].message.content
      : "";
  if (typeof content !== "string" || !content.trim()) return null;
  try {
    return normaliseModelSpec(JSON.parse(content), transcript);
  } catch {
    return null;
  }
}

export async function interpretTranscript(transcript: string, apiKey: string | undefined): Promise<SpokenSpec> {
  const key = apiKey?.trim() ?? "";
  if (key) {
    try {
      const parsed = await parseWithOpenAI(transcript, key);
      if (parsed) return { ...parsed, parser: "openai" };
    } catch {
      // A failed model call still leaves the recruiter with the rule parser.
    }
  }
  return { ...parseSpokenSpecRules(transcript), parser: "rules" };
}
