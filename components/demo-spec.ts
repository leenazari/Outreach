import type { SearchRequest } from "@/lib/types";

export const EMPTY_REQUEST: SearchRequest = {
  specText: "",
  jobTitle: "",
  location: "",
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "GBP",
  mustHave: "",
  niceToHave: "",
  seniority: "",
  yearsExperience: "",
  industry: "",
  workplace: "",
  watchPhrases: "",
  useSampleData: false,
  includeIndeed: false,
  includeEmail: false,
  recentlyChangedJobs: false,
  openToWork: true,
};

export const CURRENCIES = ["GBP", "EUR", "USD"] as const;
