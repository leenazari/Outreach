import type { ParsedSpec } from "./types";

export const COMMUTE_MILES = 50;

export type LocationStatus = "match" | "unknown" | "excluded";

type Place = {
  names: string[];
  lat: number;
  lon: number;
  country: string;
};

const PLACES: Place[] = [
  { names: ["london", "greater london", "city of london", "croydon", "westminster", "canary wharf", "shoreditch"], lat: 51.5074, lon: -0.1278, country: "United Kingdom" },
  { names: ["reading"], lat: 51.4543, lon: -0.9781, country: "United Kingdom" },
  { names: ["slough"], lat: 51.5105, lon: -0.595, country: "United Kingdom" },
  { names: ["watford"], lat: 51.6565, lon: -0.3903, country: "United Kingdom" },
  { names: ["brighton", "brighton and hove"], lat: 50.8225, lon: -0.1372, country: "United Kingdom" },
  { names: ["oxford"], lat: 51.752, lon: -1.2577, country: "United Kingdom" },
  { names: ["cambridge"], lat: 52.2053, lon: 0.1218, country: "United Kingdom" },
  { names: ["milton keynes"], lat: 52.0406, lon: -0.7594, country: "United Kingdom" },
  { names: ["luton"], lat: 51.8787, lon: -0.42, country: "United Kingdom" },
  { names: ["guildford"], lat: 51.2362, lon: -0.5704, country: "United Kingdom" },
  { names: ["southampton"], lat: 50.9097, lon: -1.4044, country: "United Kingdom" },
  { names: ["portsmouth"], lat: 50.8198, lon: -1.088, country: "United Kingdom" },
  { names: ["bristol"], lat: 51.4545, lon: -2.5879, country: "United Kingdom" },
  { names: ["cardiff"], lat: 51.4816, lon: -3.1791, country: "United Kingdom" },
  { names: ["birmingham"], lat: 52.4862, lon: -1.8904, country: "United Kingdom" },
  { names: ["coventry"], lat: 52.4068, lon: -1.5197, country: "United Kingdom" },
  { names: ["leicester"], lat: 52.6369, lon: -1.1398, country: "United Kingdom" },
  { names: ["nottingham"], lat: 52.9548, lon: -1.1581, country: "United Kingdom" },
  { names: ["manchester", "salford", "stockport"], lat: 53.4808, lon: -2.2426, country: "United Kingdom" },
  { names: ["liverpool"], lat: 53.4084, lon: -2.9916, country: "United Kingdom" },
  { names: ["leeds"], lat: 53.8008, lon: -1.5491, country: "United Kingdom" },
  { names: ["sheffield"], lat: 53.3811, lon: -1.4701, country: "United Kingdom" },
  { names: ["newcastle", "newcastle upon tyne"], lat: 54.9783, lon: -1.6178, country: "United Kingdom" },
  { names: ["edinburgh"], lat: 55.9533, lon: -3.1883, country: "United Kingdom" },
  { names: ["glasgow"], lat: 55.8642, lon: -4.2518, country: "United Kingdom" },
  { names: ["belfast"], lat: 54.5973, lon: -5.9301, country: "United Kingdom" },
  { names: ["aberdeen"], lat: 57.1497, lon: -2.0943, country: "United Kingdom" },
  { names: ["dublin", "cork"], lat: 53.3498, lon: -6.2603, country: "Ireland" },
  { names: ["paris", "lyon"], lat: 48.8566, lon: 2.3522, country: "France" },
  { names: ["berlin", "munich", "hamburg"], lat: 52.52, lon: 13.405, country: "Germany" },
  { names: ["amsterdam"], lat: 52.3676, lon: 4.9041, country: "Netherlands" },
  { names: ["new york"], lat: 40.7128, lon: -74.006, country: "United States" },
  { names: ["san francisco", "los angeles", "chicago", "boston", "seattle", "austin"], lat: 37.7749, lon: -122.4194, country: "United States" },
  { names: ["toronto", "vancouver", "montreal"], lat: 43.6532, lon: -79.3832, country: "Canada" },
  { names: ["sydney", "melbourne"], lat: -33.8688, lon: 151.2093, country: "Australia" },
  { names: ["bangalore", "bengaluru", "mumbai", "delhi"], lat: 12.9716, lon: 77.5946, country: "India" },
  { names: ["singapore"], lat: 1.3521, lon: 103.8198, country: "Singapore" },
  { names: ["dubai", "abu dhabi"], lat: 25.2048, lon: 55.2708, country: "United Arab Emirates" },
];

const COUNTRIES: { name: string; pattern: RegExp }[] = [
  { name: "United Kingdom", pattern: /\b(united kingdom|great britain|england|scotland|wales|northern ireland|uk)\b/i },
  { name: "United States", pattern: /\b(united states|usa|u\.s\.a?\.|texas|california)\b/i },
  { name: "Ireland", pattern: /\bireland\b/i },
  { name: "France", pattern: /\bfrance\b/i },
  { name: "Germany", pattern: /\bgermany\b/i },
  { name: "Netherlands", pattern: /\b(netherlands|holland)\b/i },
  { name: "Canada", pattern: /\bcanada\b/i },
  { name: "Australia", pattern: /\baustralia\b/i },
  { name: "India", pattern: /\bindia\b/i },
  { name: "Singapore", pattern: /\bsingapore\b/i },
  { name: "United Arab Emirates", pattern: /\b(united arab emirates|uae)\b/i },
];

function milesBetween(left: Place, right: Place): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(right.lat - left.lat);
  const dLon = toRad(right.lon - left.lon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(left.lat)) * Math.cos(toRad(right.lat)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function placesIn(location: string): Place[] {
  const text = location.toLowerCase();
  const found: Place[] = [];
  for (const place of PLACES) {
    if (place.names.some((name) => new RegExp(`\\b${name}\\b`, "i").test(text))) found.push(place);
  }
  return found;
}

export function countryOf(location: string): string | null {
  const places = placesIn(location);
  if (places[0]) return places[0].country;
  for (const country of COUNTRIES) {
    if (country.pattern.test(location)) return country.name;
  }
  return null;
}

export function specIsRemote(spec: Pick<ParsedSpec, "workplace">): boolean {
  const workplace = spec.workplace ?? "";
  return /\bremote\b/i.test(workplace) && !/\bhybrid\b/i.test(workplace);
}

export function commuteDecision(candidateLocation: string, spec: Pick<ParsedSpec, "location" | "workplace">): LocationStatus {
  const wanted = spec.location.trim();
  const theirs = candidateLocation.trim();
  if (!wanted) return "match";
  if (!theirs || /^location not listed$/i.test(theirs)) return "unknown";

  const wantedCountry = countryOf(wanted);
  const theirCountry = countryOf(theirs);
  if (specIsRemote(spec)) {
    if (!theirCountry || !wantedCountry) return "unknown";
    return theirCountry === wantedCountry ? "match" : "excluded";
  }

  const wantedPlaces = placesIn(wanted);
  const theirPlaces = placesIn(theirs);
  if (wantedPlaces.length > 0 && theirPlaces.length > 0) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const from of wantedPlaces) {
      for (const to of theirPlaces) nearest = Math.min(nearest, milesBetween(from, to));
    }
    return nearest <= COMMUTE_MILES ? "match" : "excluded";
  }
  if (theirCountry && wantedCountry && theirCountry !== wantedCountry) return "excluded";
  if (theirPlaces.length === 0 || wantedPlaces.length === 0) return "unknown";
  return "unknown";
}
