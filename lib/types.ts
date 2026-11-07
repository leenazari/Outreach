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
  specText: string;
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
  watchPhrases: string;
  useSampleData: boolean;
  includeIndeed: boolean;
  includeEmail: boolean;
  recentlyChangedJobs: boolean;
  openToWork: boolean;
  lockedFields?: string[];
};

export type ParsedSpec = {
  jobTitle: string;
  location: string;
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: string;
  mustHave: string[];
  niceToHave: string[];
  seniority?: string;
  yearsExperience?: string;
  industry?: string;
  workplace?: string;
  watchPhrases: string[];
  useSampleData: boolean;
  includeIndeed?: boolean;
  recentlyChangedJobs?: boolean;
  openToWork?: boolean;
};

export type ScoreReason = {
  label: string;
  points: number;
};

export type WorkSource = SourceId | "linkedin-detail";

export type WorkRole = {
  title: string;
  company: string;
  location: string;
  start: string | null;
  end: string | null;
  detail: string;
  source: WorkSource;
};

export type RecordOrigin = {
  runId: string | null;
  actor: string;
  source: WorkSource;
  itemIndex: number;
  hasExperience: boolean;
};

export type ValidationStatus = "verified" | "review" | "risk" | "unchecked";

export type ValidationReason = {
  summary: string;
  evidence: string;
};

export type Validation = {
  status: ValidationStatus;
  label: string;
  reasons: ValidationReason[];
};

export type CostLine = {
  label: string;
  usd: number;
  kind: "event" | "platform" | "remainder";
  allocated: boolean;
  count?: number;
  unitUsd?: number;
};

export type RunSpend = {
  actor: string;
  label: string;
  runId: string | null;
  status: string | null;
  startedAt: string | null;
  settled: boolean;
  totalUsd: number | null;
  lines: CostLine[];
  consoleUrl: string | null;
  note: string;
};

export type CandidateCostLine = {
  actor: string;
  sourceLabel: string;
  field: string;
  usd: number;
  allocated: boolean;
};

export type CandidateSpend = {
  candidateId: string;
  name: string;
  totalUsd: number;
  lines: CandidateCostLine[];
};

export type SearchSpend = {
  mode: "sample" | "live";
  searchId: string | null;
  settled: boolean;
  totalUsd: number | null;
  settlingUsd: number;
  unassignedUsd: number;
  runs: RunSpend[];
  candidates: CandidateSpend[];
  note: string;
};

export type MatchCriterionKey = "title" | "skills" | "experience" | "location" | "seniority" | "recency";

export type MatchCriterion = {
  key: MatchCriterionKey;
  label: string;
  weight: number;
  score: number;
  reason: string;
  assessed: boolean;
};

export type Candidate = {
  id: string;
  name: string | null;
  title: string;
  location: string;
  locationRegion: string;
  company: string;
  experienceSummary: string;
  skills: string[];
  profileUrl: string | null;
  linkedinIds?: string[];
  sourceUrl: string | null;
  email: string | null;
  photoUrl: string | null;
  source: SourceId;
  sources: SourceId[];
  snippet: string;
  score: number;
  subscores: MatchCriterion[];
  why: ScoreReason[];
  matchedMustHaves: string[];
  matchedNiceToHaves: string[];
  matchedWatchPhrases: string[];
  recentlyChangedJobs: boolean;
  competitorOrComplaintPost: boolean;
  cvFound: boolean;
  sample: boolean;
  validation: Validation;
  openToWork: boolean;
  openToWorkPostUrl: string | null;
  firstPassScore: number;
  enriched: boolean;
  industry: string | null;
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
    searchedFor: string;
  };
  spend: SearchSpend;
};

export type RawCandidate = {
  name: string;
  title: string;
  location: string;
  profileUrl: string | null;
  linkedinIds?: string[];
  queryUrls?: string[];
  company?: string;
  industry?: string;
  enriched?: boolean;
  sources: SourceId[];
  snippet: string;
  haystack: string;
  recentlyChangedJobs: boolean;
  competitorOrComplaintPost: boolean;
  cvFound: boolean;
  matchedWatchPhrases: string[];
  sample: boolean;
  experience?: WorkRole[];
  connections?: number | null;
  origins?: RecordOrigin[];
  sourceUrl?: string | null;
  email?: string | null;
  photoUrl?: string | null;
  detailOnRecord?: boolean;
  openToWork?: boolean;
  openToWorkPostUrl?: string | null;
  firstPassScore?: number;
};
