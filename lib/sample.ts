import type { ParsedSpec, RawCandidate } from "./types";

function listed(phrases: string[], fallback: string): string {
  return phrases.length > 0 ? phrases.join(", ") : fallback;
}

function withoutFirst(phrases: string[]): string {
  return phrases.length > 1 ? phrases.slice(1).join(", ") : "a neighbouring craft skill";
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
