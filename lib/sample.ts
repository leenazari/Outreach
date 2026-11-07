import type { ParsedSpec, RawCandidate, WorkRole } from "./types";

function listed(phrases: string[], fallback: string): string {
  return phrases.length > 0 ? phrases.join(", ") : fallback;
}

function withoutFirst(phrases: string[]): string {
  return phrases.length > 1 ? phrases.slice(1).join(", ") : "a neighbouring craft skill";
}

function role(input: Omit<WorkRole, "detail" | "source"> & { detail?: string; source: WorkRole["source"] }): WorkRole {
  return { detail: "", ...input };
}

export function buildSampleCandidates(spec: ParsedSpec): RawCandidate[] {
  const title = spec.jobTitle;
  const location = spec.location;
  const must = listed(spec.mustHave, "the core craft of the role");
  const nice = listed(spec.niceToHave.slice(0, 2), "cross-functional product work");
  const allNice = listed(spec.niceToHave, "cross-functional product work");
  const oneNice = spec.niceToHave[0] ?? "cross-functional product work";
  const hasWatch = spec.watchPhrases.length > 0;
  const watch = spec.watchPhrases[0] ?? "the current hiring tool";
  const watchLine = hasWatch
    ? spec.watchPhrases.join(". ")
    : "The internal tools are slowing the team down";
  const profileUrl = "https://www.linkedin.com/in/sample-avery-lang";
  const watched = hasWatch
    ? spec.watchPhrases.filter((phrase) => watchLine.toLowerCase().includes(phrase.toLowerCase()))
    : [];

  return [
    {
      name: "Avery Lang",
      title,
      location,
      profileUrl,
      sources: ["linkedin-profile"],
      snippet: `${title} in ${location}. Recently moved teams. Practice covers ${must}. Also ${nice}.`,
      haystack: `${title}\n${location}\n${must}\n${nice}\nRecently changed jobs.`,
      recentlyChangedJobs: true,
      competitorOrComplaintPost: false,
      cvFound: false,
      matchedWatchPhrases: [],
      sample: true,
      connections: 480,
      experience: [
        role({
          title,
          company: "Northwind",
          location,
          start: "2018-01",
          end: "2023-12",
          detail: "B2B sales",
          source: "linkedin-profile",
        }),
        role({
          title,
          company: "Harbor",
          location,
          start: "2024-01",
          end: null,
          detail: "B2B sales",
          source: "linkedin-profile",
        }),
      ],
    },
    {
      name: "Avery Lang",
      title,
      location,
      profileUrl: `${profileUrl}?miniProfileUrn=sample`,
      sources: ["linkedin-post"],
      snippet: `The ${watch} rollout has been rough for hiring managers. Still looking for a team that cares about the craft.`,
      haystack: `${title}\n${location}\n${must}\n${watchLine}`,
      recentlyChangedJobs: false,
      competitorOrComplaintPost: hasWatch,
      cvFound: false,
      matchedWatchPhrases: watched,
      sample: true,
    },
    {
      name: "Riley Chen",
      title,
      location,
      profileUrl: null,
      sources: ["indeed-resume"],
      snippet: `Resume skills: ${must}. Also lists ${allNice}. Led this work at a Series B product company in ${location}.`,
      haystack: `${title}\n${location}\n${must}\n${allNice}\nResume skills and experience.`,
      recentlyChangedJobs: false,
      competitorOrComplaintPost: false,
      cvFound: true,
      matchedWatchPhrases: [],
      sample: true,
      experience: [
        role({
          title: `${title}, B2B sales`,
          company: "Lumen",
          location,
          start: "2024-01",
          end: "2024-03",
          source: "indeed-resume",
        }),
        role({
          title: `${title}, B2B sales`,
          company: "Keel",
          location,
          start: "2024-04",
          end: "2024-06",
          source: "indeed-resume",
        }),
        role({
          title: `${title}, B2B sales`,
          company: "Plover",
          location,
          start: "2024-07",
          end: "2024-09",
          source: "indeed-resume",
        }),
      ],
    },
    {
      name: "Priya Shah",
      title,
      location,
      profileUrl: "https://www.linkedin.com/in/sample-priya-shah",
      sources: ["linkedin-profile"],
      snippet: `${title} who started a new role in ${location} this quarter. Strengths: ${must}. ${oneNice}.`,
      haystack: `${title}\n${location}\n${must}\n${oneNice}`,
      recentlyChangedJobs: true,
      competitorOrComplaintPost: false,
      cvFound: false,
      matchedWatchPhrases: [],
      sample: true,
      connections: 35,
      experience: [
        role({
          title: "Retail assistant",
          company: "Harbor Labs",
          location,
          start: "2018-01",
          end: "2020-06",
          source: "linkedin-profile",
        }),
        role({
          title: `${title}, B2B sales`,
          company: "Harbor Labs",
          location,
          start: "2026-09",
          end: null,
          source: "linkedin-profile",
        }),
      ],
    },
    {
      name: "Priya Shah",
      title,
      location: "Manchester",
      profileUrl: null,
      sources: ["indeed-resume"],
      snippet: `Resume lists ${must}. Current employer is Northwind Goods in Manchester.`,
      haystack: `${title}\nManchester\n${must}`,
      recentlyChangedJobs: false,
      competitorOrComplaintPost: false,
      cvFound: true,
      matchedWatchPhrases: [],
      sample: true,
      experience: [
        role({
          title: `${title}, B2B sales`,
          company: "Northwind Goods",
          location: "Manchester",
          start: "2024-01",
          end: null,
          source: "indeed-resume",
        }),
      ],
    },
    {
      name: "Morgan Adeyemi",
      title,
      location,
      profileUrl: "https://www.linkedin.com/in/sample-morgan-adeyemi",
      sources: ["linkedin-post"],
      snippet: `Posted this month: "${watchLine}." Their own practice is ${must}.`,
      haystack: `${title}\n${location}\n${must}\n${watchLine}`,
      recentlyChangedJobs: false,
      competitorOrComplaintPost: hasWatch,
      cvFound: false,
      matchedWatchPhrases: watched,
      sample: true,
      connections: 8,
      experience: [
        role({
          title: "VP of Sales",
          company: "Alpha",
          location,
          start: "2026-06",
          end: "2026-01",
          source: "linkedin-post",
        }),
        role({
          title: "VP of Sales",
          company: "Alpha",
          location,
          start: "2026-03",
          end: null,
          source: "linkedin-post",
        }),
        role({
          title: "VP of Sales",
          company: "Beta",
          location: "Manchester",
          start: "2026-04",
          end: null,
          source: "linkedin-post",
        }),
      ],
    },
    {
      name: "Jonah Ellis",
      title: "Visual designer",
      location,
      profileUrl: "https://www.linkedin.com/in/sample-jonah-ellis",
      sources: ["linkedin-profile"],
      snippet:
        spec.mustHave.length > 0
          ? `Exploring the field in ${location}. Mentions ${withoutFirst(spec.mustHave)}, and recently changed jobs. Does not list ${spec.mustHave[0]}.`
          : `Exploring the field in ${location} and recently changed jobs.`,
      haystack: `${location}\n${withoutFirst(spec.mustHave)}\nRecently changed jobs.`,
      recentlyChangedJobs: true,
      competitorOrComplaintPost: false,
      cvFound: false,
      matchedWatchPhrases: [],
      sample: true,
    },
    {
      name: "Chris Hale",
      title: "Marketing coordinator",
      location,
      profileUrl: "https://www.linkedin.com/in/sample-chris-hale",
      sources: ["linkedin-profile"],
      snippet: `Writes case studies in ${location}. No overlap with the must-have list.`,
      haystack: `Marketing coordinator\n${location}\ncase studies and campaign reporting`,
      recentlyChangedJobs: false,
      competitorOrComplaintPost: false,
      cvFound: false,
      matchedWatchPhrases: [],
      sample: true,
    },
  ];
}
