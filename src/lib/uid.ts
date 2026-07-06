// Tiny unique-id generator for stable React keys on exercises/sets, so reordering
// or removing a row doesn't bleed a component's local state onto its neighbour.
let n = 0;
export const uid = (): string => `${Date.now().toString(36)}-${(n++).toString(36)}`;
