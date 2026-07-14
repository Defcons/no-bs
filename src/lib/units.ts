// Weight units. kg is ALWAYS the stored/canonical value; lb is a display+entry
// convenience. Convert at the edges (input parse, output format) — never store lb.
export type WeightUnit = "kg" | "lb";

const LB_PER_KG = 2.2046226218;
const roundTo = (n: number, step: number) => Math.round(n / step) * step;

// kg → the number shown in the user's unit (lb rounded to 0.5).
export function toDisplayWeight(kg: number, u: WeightUnit): number {
  return u === "lb" ? roundTo(kg * LB_PER_KG, 0.5) : kg;
}
// a display-unit number the user typed → kg to store.
export function fromDisplayWeight(v: number, u: WeightUnit): number {
  return u === "lb" ? Math.round((v / LB_PER_KG) * 100) / 100 : v;
}
// A tidy string of the display value (no trailing ".0").
export function weightStr(kg: number, u: WeightUnit): string {
  const v = toDisplayWeight(kg, u);
  return Number.isInteger(v) ? String(v) : String(v);
}
// kg + " kg" (or lb), rounded to a whole number — for records/summaries.
export function fmtWeight(kg: number, u: WeightUnit): string {
  return `${Math.round(toDisplayWeight(kg, u))} ${u}`;
}
// The ± stepper increment in the display unit (kg steps map to round lb steps).
export function displayStep(kgStep: number, u: WeightUnit): number {
  if (u === "kg") return kgStep;
  return ({ 1.25: 2.5, 2.5: 5, 5: 10 } as Record<number, number>)[kgStep] ?? roundTo(kgStep * LB_PER_KG, 0.5);
}
