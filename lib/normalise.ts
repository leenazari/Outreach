import type { RawCandidate, SourceId } from "./types";
import { asRecord, asString, clip, haystackIncludes, stripContactDetails } from "./text";
import { readConnections, readWorkRoles } from "./work";

function collectSkills(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/[,|\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) names.push(trimmed);
      continue;
    }
    const record = asRecord(item);
    const name = record ? asString(record.name) || asString(record.skill) : "";
    if (name) names.push(name);
  }
  return names;
}

function locationText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  if (!record) return "";
  const direct = asString(record.linkedinText) || asString(record.default) || asString(record.text);
  if (direct) return direct;
  const parsed = asRecord(record.parsed);
  if (!parsed) return "";
  return [asString(parsed.city), asString(parsed.state), asString(parsed.country)]
    .filter(Boolean)
    .join(", ");
}

function experienceBits(record: Record<string, unknown>): string[] {
  const groups = [record.experience, record.experiences, record.currentPositions, record.positions];
  const bits: string[] = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      const entry = asRecord(item);
      if (!entry) continue;
      const bit = [
        asString(entry.title),
        asString(entry.companyName) || asString(entry.company),
        asString(entry.description),
      ]
        .filter(Boolean)
        .join(" ");
      if (bit) bits.push(bit);
    }
  }
  return bits;
}

function tenureMonths(record: Record<string, unknown>): number | null {
  const positions = Array.isArray(record.currentPositions) ? record.currentPositions : [];
  const primary = asRecord(positions[0]);
  if (!primary) return null;
  const tenure = asRecord(primary.tenureAtPosition) || asRecord(primary.tenureAtCompany);
  if (!tenure || typeof tenure.numMonths !== "number") return null;
  return tenure.numMonths;
}

function personName(first: unknown, last: unknown, fallback: string): string {
  const lastName = asString(last);
  const parts = [asString(first), lastName.toLowerCase() === "undefined" ? "" : lastName].filter(Boolean);
  return parts.join(" ") || fallback;
}

export function normaliseLinkedInProfile(item: unknown): RawCandidate | null {
  const record = asRecord(item);
  if (!record) return null;

  const name = stripContactDetails(
    personName(record.firstName, record.lastName, asString(record.fullName) || asString(record.name)),
  );
  if (!name) return null;

  const positions = Array.isArray(record.currentPositions) ? record.currentPositions : [];
  const primary = asRecord(positions[0]);
  const headline = asString(record.headline) || asString(record.position);
  const title = asString(primary?.title) || headline || "Title not listed";
  const location =
    locationText(record.location) || asString(primary?.locationName) || locationText(primary?.location);
  const skills = collectSkills(record.skills);
  const summary = asString(record.summary) || asString(record.about);
  const experience = experienceBits(record).join("\n");
  const profileUrl = asString(record.linkedinUrl) || asString(record.url) || asString(record.profileUrl) || null;
  const months = tenureMonths(record);
  const snippet = clip(
    [headline, summary, skills.length ? `Skills: ${skills.join(", ")}` : ""].filter(Boolean).join(" · "),
    420,
  );

  return {
    name,
    title: stripContactDetails(title),
    location,
    profileUrl,
    sources: ["linkedin-profile"],
    snippet: stripContactDetails(snippet || title),
    haystack: [name, title, location, headline, summary, skills.join("\n"), experience].join("\n"),
    recentlyChangedJobs: months === null ? true : months <= 3,
    competitorOrComplaintPost: false,
    cvFound: false,
    matchedWatchPhrases: [],
    sample: false,
    experience: readWorkRoles(record, "linkedin-profile"),
    connections: readConnections(record),
    email: asString(record.email) || asString(record.emailAddress) || null,
    photoUrl: asString(record.photo) || asString(record.profilePicture) || asString(record.pictureUrl) || null,
  };
}

export function normaliseLinkedInPost(item: unknown, watchPhrases: string[]): RawCandidate | null {
  const record = asRecord(item);
  if (!record) return null;
  const type = asString(record.type);
  if (type && type !== "post") return null;

  const author = asRecord(record.author);
  const authorType = author ? asString(author.type) : "";
  const profileUrl =
    (author ? asString(author.linkedinUrl) || asString(author.url) : "") ||
    asString(record.authorProfileUrl) ||
    "";
  if (authorType === "company" || profileUrl.includes("/company/")) return null;
  if (profileUrl && !profileUrl.includes("/in/") && authorType && authorType !== "profile") return null;

  const name = stripContactDetails(author ? asString(author.name) : asString(record.authorName));
  if (!name) return null;

  const content = asString(record.content) || asString(record.text);
  const title = (author ? asString(author.info) : "") || "LinkedIn member";
  const matched = watchPhrases.filter((phrase) => haystackIncludes(`${content}\n${title}`, phrase));
  const snippet = clip(content, 420);

  return {
    name,
    title: stripContactDetails(title),
    location: author ? locationText(author.location) : "",
    profileUrl: profileUrl || null,
    sources: ["linkedin-post"],
    snippet: stripContactDetails(snippet || "Post matched a watched phrase."),
    haystack: [name, title, content].join("\n"),
    recentlyChangedJobs: false,
    competitorOrComplaintPost: true,
    cvFound: false,
    matchedWatchPhrases: matched,
    sample: false,
    experience: [],
    connections: null,
  };
}

export function normaliseIndeedResume(item: unknown): RawCandidate | null {
  const record = asRecord(item);
  if (!record) return null;

  const currentTitle = asString(record.currentTitle) || asString(record.title) || "Resume";
  const explicitName =
    asString(record.candidateName) ||
    asString(record.fullName) ||
    personName(record.firstName, record.lastName, "");
  const rawName = asString(record.name);
  let name = explicitName;
  if (!name && rawName && rawName.toLowerCase() !== currentTitle.toLowerCase()) name = rawName;
  if (!name) name = "Name not published";

  const skills = collectSkills(record.skills);
  const highlights = Array.isArray(record.highlights)
    ? record.highlights.map((entry) => asString(entry)).filter(Boolean)
    : [];
  const experience = experienceBits(record);
  const education = asString(record.educationText);
  const credentials = collectSkills(record.credentials);
  const snippet = clip(
    [
      skills.length ? `Skills: ${skills.join(", ")}` : "",
      highlights.join("; "),
      experience[0] ?? "",
      education,
    ]
      .filter(Boolean)
      .join(" · "),
    420,
  );
  if (!snippet && currentTitle === "Resume") return null;

  const rawUrl =
    asString(record.profileUrl) ||
    asString(record.resumeUrl) ||
    asString(record.publicProfileUrl) ||
    asString(record.url);
  const profileUrl = rawUrl && !rawUrl.includes("/search?") ? rawUrl : null;

  return {
    name: stripContactDetails(name),
    title: stripContactDetails(currentTitle),
    location: locationText(record.location) || asString(record.location),
    profileUrl,
    sourceUrl: profileUrl,
    sources: ["indeed-resume"],
    snippet: stripContactDetails(snippet || currentTitle),
    haystack: [
      name,
      currentTitle,
      asString(record.location),
      skills.join("\n"),
      highlights.join("\n"),
      experience.join("\n"),
      education,
      credentials.join("\n"),
      snippet,
    ].join("\n"),
    recentlyChangedJobs: false,
    competitorOrComplaintPost: false,
    cvFound: true,
    matchedWatchPhrases: [],
    sample: false,
    experience: readWorkRoles(record, "indeed-resume"),
    connections: null,
  };
}

export function normaliseItems(
  source: SourceId,
  items: unknown[],
  watchPhrases: string[],
): RawCandidate[] {
  const candidates: RawCandidate[] = [];
  for (const item of items) {
    const candidate =
      source === "linkedin-profile"
        ? normaliseLinkedInProfile(item)
        : source === "linkedin-post"
          ? normaliseLinkedInPost(item, watchPhrases)
          : normaliseIndeedResume(item);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}
