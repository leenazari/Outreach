export const SOURCE_IDS = [
  "linkedin-profile",
  "linkedin-post",
  "indeed-resume",
] as const;

export type SourceId = (typeof SOURCE_IDS)[number];

export const SOURCE_LABELS: Record<SourceId, string> = {
  "linkedin-profile": "LinkedIn profile",
  "linkedin-post": "LinkedIn post",
  "indeed-resume": "Indeed resume",
};

export type SearchRequest = {
  jobTitle: string;
  location: string;
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: string;
  mustHave: string;
  niceToHave: string;
  watchPhrases: string;
  useSampleData: boolean;
};

export type ParsedSpec = {
  jobTitle: string;
  location: string;
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: string;
  mustHave: string[];
  niceToHave: string[];
  watchPhrases: string[];
  useSampleData: boolean;
};

export type ScoreReason = {
  label: string;
  points: number;
};

export type Candidate = {
  id: string;
  name: string;
  title: string;
  location: string;
  profileUrl: string | null;
  source: SourceId;
  sources: SourceId[];
  snippet: string;
  score: number;
  why: ScoreReason[];
  matchedMustHaves: string[];
  matchedNiceToHaves: string[];
  matchedWatchPhrases: string[];
  recentlyChangedJobs: boolean;
  competitorOrComplaintPost: boolean;
  cvFound: boolean;
  sample: boolean;
};

export type SourceNotice = {
  source: SourceId | "apify";
  level: "info" | "warning";
  message: string;
};

export type ActorPlan = {
  actor: string;
  purpose: string;
  skipped: boolean;
  input: Record<string, unknown> | null;
};

export type SearchStats = {
  collected: number;
  afterDedupe: number;
  droppedForMustHave: number;
  matched: number;
  returned: number;
};

export type SearchResponse = {
  mode: "sample" | "live";
  tokenConfigured: boolean;
  candidates: Candidate[];
  notices: SourceNotice[];
  plannedRuns: ActorPlan[];
  stats: SearchStats;
  spec: {
    jobTitle: string;
    location: string;
    salaryLabel: string;
    mustHave: string[];
    niceToHave: string[];
    watchPhrases: string[];
  };
};

export type RawCandidate = {
  name: string;
  title: string;
  location: string;
  profileUrl: string | null;
  sources: SourceId[];
  snippet: string;
  haystack: string;
  recentlyChangedJobs: boolean;
  competitorOrComplaintPost: boolean;
  cvFound: boolean;
  matchedWatchPhrases: string[];
  sample: boolean;
};
