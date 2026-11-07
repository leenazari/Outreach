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
  watchPhrases: "",
  useSampleData: false,
  includeIndeed: true,
  includeEmail: false,
  unlockThreshold: 80,
};

export const CURRENCIES = ["GBP", "EUR", "USD"] as const;
