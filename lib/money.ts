const SCALE = 1_000_000;

export function usdToMicros(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const negative = value < 0;
  const [whole, frac = ""] = Math.abs(value).toFixed(6).split(".");
  const micros = Number(whole) * SCALE + Number(frac.padEnd(6, "0").slice(0, 6));
  return negative ? -micros : micros;
}

export function microsToUsd(micros: number): number {
  return micros / SCALE;
}

export function formatUsd(micros: number): string {
  const sign = micros < 0 ? "-" : "";
  const abs = Math.abs(micros);
  const whole = Math.floor(abs / SCALE);
  const frac = String(abs % SCALE)
    .padStart(6, "0")
    .replace(/0+$/, "");
  if (!frac) return `${sign}$${whole}.00`;
  const shown = frac.length < 2 ? frac.padEnd(2, "0") : frac;
  return `${sign}$${whole}.${shown}`;
}

export function formatUsdAmount(usd: number | null): string {
  if (usd === null) return "Not settled";
  return formatUsd(usdToMicros(usd));
}

export function allocateMicros(total: number, weights: number[]): number[] {
  if (weights.length === 0 || total <= 0) return weights.map(() => 0);
  const safe = weights.map((weight) => (weight > 0 ? weight : 0));
  const weightSum = safe.reduce((sum, weight) => sum + weight, 0);
  const basis = weightSum > 0 ? safe : safe.map(() => 1);
  const basisSum = basis.reduce((sum, weight) => sum + weight, 0);
  const exact = basis.map((weight) => (total * weight) / basisSum);
  const floors = exact.map((value) => Math.floor(value));
  let left = total - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - (floors[index] ?? 0) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const entry of order) {
    if (left <= 0) break;
    floors[entry.index] = (floors[entry.index] ?? 0) + 1;
    left -= 1;
  }
  return floors;
}
