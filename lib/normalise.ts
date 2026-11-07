import { collectLinkedInIds, originalQueryUrls, preferredProfileUrl, readCurrentCompany, readIndustry } from "./linkedin";
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
  const groups = [record.experience, record.experiences, record.currentPositions, record.currentPosition, record.positions];
  const bits: string[] = [];
  for (const group of groups) {
    const list = Array.isArray(group) ? group : group && typeof group === "object" ? [group] : [];
    for (const item of list) {
      const entry = asRecord(item);
      if (!entry) continue;
      const bit = [
        asString(entry.title) || asString(entry.position),
        asString(entry.companyName) || asString(asRecord(entry.company)?.name) || asString(entry.company),
        asString(entry.description),
        asString(entry.industry) || asString(asRecord(entry.company)?.industry),
      ]
        .filter(Boolean)
        .join(" ");
      if (bit) bits.push(bit);
    }
  }
  return bits;
}

function tenureMonths(record: Record<string, unknown>): number | null {
  const positions = Array.isArray(record.currentPositions)
    ? record.currentPositions
    : Array.isArray(record.currentPosition)
      ? record.currentPosition
      : [];
  const primary = asRecord(positions[0]);
  if (!primary) return null;
  const tenure = asRecord(primary.tenureAtPosition) || asRecord(primary.tenureAtCompany);
  if (!tenure) return null;
  const years = typeof tenure.numYears === "number" ? tenure.numYears : 0;
  const months = typeof tenure.numMonths === "number" ? tenure.numMonths : 0;
  if (typeof tenure.numYears !== "number" && typeof tenure.numMonths !== "number") return null;
  return years * 12 + months;
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

  const positions = Array.isArray(record.currentPositions)
    ? record.currentPositions
    : Array.isArray(record.currentPosition)
      ? record.currentPosition
      : record.currentPosition
        ? [record.currentPosition]
        : [];
  const primary = asRecord(positions[0]);
  const headline = asString(record.headline) || asString(record.position);
  const title = asString(primary?.title) || asString(primary?.position) || headline || "Title not listed";
  const location =
    locationText(record.location) || asString(primary?.locationName) || locationText(primary?.location);
  const skills = collectSkills(record.skills).concat(collectSkills(record.topSkills));
  const summary = asString(record.summary) || asString(record.about);
  const experience = experienceBits(record).join("\n");
  const company = readCurrentCompany(record);
  const industry = readIndustry(record);
  const profileUrl = preferredProfileUrl(record);
  const months = tenureMonths(record);
  const snippet = clip(
    [headline, company, industry, summary, skills.length ? `Skills: ${skills.join(", ")}` : ""].filter(Boolean).join(" · "),
    420,
  );

  return {
    name,
    title: stripContactDetails(title),
    location,
    profileUrl,
    linkedinIds: collectLinkedInIds(record),
    queryUrls: originalQueryUrls(record),
    company,
    industry,
    sources: ["linkedin-profile"],
    snippet: stripContactDetails(snippet || title),
    haystack: [name, title, company, industry, location, headline, summary, skills.join("\n"), experience].join("\n"),
    recentlyChangedJobs: months !== null && months <= 3,
    detailOnRecord: Boolean(summary || skills.length || experience),
    competitorOrComplaintPost: false,
    cvFound: false,
    matchedWatchPhrases: [],
    sample: false,
    experience: readWorkRoles(record, "linkedin-profile"),
    connections: readConnections(record),
    email: asString(record.email) || asString(record.emailAddress) || null,
    photoUrl: asString(record.photo) || asString(record.profilePicture) || asString(record.pictureUrl) || null,
    openToWork: record.openToWork === true,
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
  const social = asRecord(record.socialContent);
  const postLinks = [asString(record.postUrl), asString(record.linkedinUrl), asString(record.shareLinkedinUrl), asString(social?.shareUrl), asString(record.url)].filter(
    (value) => /linkedin\.com\/(posts|feed)\//i.test(value),
  );
  const postUrl = postLinks.find((value) => /\/posts\//i.test(value)) ?? postLinks[0] ?? null;
  const announced = /open to work|looking for my next role/i.test(`${content}\n${asString(record.query)}`);
  const authorIds = author ? collectLinkedInIds(author) : [];

  return {
    name,
    title: stripContactDetails(title),
    location: author ? locationText(author.location) : "",
    profileUrl: profileUrl || null,
    linkedinIds: authorIds,
    sources: ["linkedin-post"],
    snippet: stripContactDetails(snippet || "Post matched a watched phrase."),
    haystack: [name, title, content].join("\n"),
    recentlyChangedJobs: false,
    competitorOrComplaintPost: matched.length > 0 || !announced,
    cvFound: false,
    matchedWatchPhrases: matched,
    sample: false,
    experience: [],
    connections: null,
    openToWorkPostUrl: announced ? postUrl : null,
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
    detailOnRecord: Boolean(skills.length || experience.length || highlights.length),
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
