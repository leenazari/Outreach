import type { SearchRequest } from "@/lib/types";

export const DEMO_REQUEST: SearchRequest = {
  jobTitle: "Sales Executive",
  location: "London",
  salaryMin: "40000",
  salaryMax: "50000",
  salaryCurrency: "GBP",
  mustHave: "based in London\nat least 2 years B2B sales experience\nholds a full UK driving licence",
  niceToHave: "SaaS or tech sales background\nhas used CRM tools\nrecently changed jobs in the last 6 months",
  watchPhrases: "Greenhouse\nATS is painful\nLever",
  useSampleData: true,
};

export const CURRENCIES = ["GBP", "EUR", "USD"] as const;
