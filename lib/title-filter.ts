import { normaliseForMatch } from "./text";

const GENERIC = new Set([
  "senior",
  "junior",
  "lead",
  "principal",
  "head",
  "manager",
  "director",
  "executive",
  "officer",
  "specialist",
  "consultant",
  "associate",
  "assistant",
  "intern",
  "staff",
  "chief",
]);

const FAMILIES: string[][] = [
  ["sales", "seller", "account executive", "business development", "bdm"],
  ["marketing", "growth", "brand", "demand"],
  ["design", "designer", "ux", "ui"],
  ["engineer", "developer", "software", "programmer"],
  ["product"],
  ["recruit", "recruiter", "talent"],
  ["accountant", "accounting", "finance", "bookkeep"],
  ["nurse", "clinical", "doctor"],
  ["teacher", "lecturer"],
  ["lawyer", "solicitor"],
  ["chef", "cook"],
  ["analyst", "data"],
];

function tokens(value: string): string[] {
  return normaliseForMatch(value)
    .split(" ")
    .filter((token) => token.length > 2 && !GENERIC.has(token));
}

function families(value: string): number[] {
  const text = value.toLowerCase();
  return FAMILIES.map((family, index) => (family.some((phrase) => text.includes(phrase)) ? index : -1)).filter((index) => index >= 0);
}

export function titleClearlyUnrelated(candidateTitle: string, specTitle: string): boolean {
  const candidate = candidateTitle.trim().toLowerCase();
  const wanted = specTitle.trim().toLowerCase();
  if (!candidate || !wanted) return false;
  if (candidate === "title not listed" || candidate === "linkedin member") return false;
  if (candidate.includes(wanted) || wanted.includes(candidate)) return false;
  const specTokens = tokens(wanted);
  if (specTokens.some((token) => candidate.includes(token))) return false;
  const specFamilies = families(wanted);
  const candidateFamilies = families(candidate);
  if (specFamilies.length === 0 || candidateFamilies.length === 0) return false;
  return specFamilies.every((index) => !candidateFamilies.includes(index));
}
