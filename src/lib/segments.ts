// Automatic interval detection: break a movement time-series into RUN / WALK / STOP
// segments. The engine is fed a speed-over-time profile as simple {t0,t1,dist} steps —
// an OUTDOOR run derives them from the GPS track (per-point speed, here); a treadmill /
// indoor session will derive them from the step-cadence stream (× stride) once the
// native counter batches timestamped samples (step Phase 2b). Same classifier both ways.
import type { StepSample, TrackPoint, WorkoutBreak } from "../types";
import { distanceM } from "./geofence";
import { processTrack } from "./runStats";

export type MoveKind = "run" | "walk" | "stop";
export type MoveSegment = { kind: MoveKind; startMs: number; endMs: number; distanceM: number };

// One measured interval between two samples: how far you moved over how long.
export type MoveStep = { t0: number; t1: number; dist: number };

// Speed thresholds (m/s): stop < STOP_MS ≤ walk < WALK_MS ≤ run.
//   STOP_MS 0.6 m/s ≈ 2.2 km/h — below this you're standing / shuffling in place.
//   WALK_MS 2.2 m/s ≈ 7.9 km/h ≈ 7:35/km — the brisk-walk ↔ jog boundary.
const STOP_MS = 0.6;
const WALK_MS = 2.2;
// A segment shorter than this is absorbed into a neighbour, so a few noisy seconds (a
// cornering wobble, one dropped sample) can't mint a fake interval. Tunable per feel.
const MIN_SEG_SEC = 25;
// Beyond this a "step" is a GPS teleport (multipath), not movement — drop it, matching
// runStats' own MAX_SEGMENT_SPEED_MS gate so distance and segments agree.
const MAX_SPEED_MS = 20;

function kindOf(speedMs: number): MoveKind {
  if (speedMs < STOP_MS) return "stop";
  if (speedMs < WALK_MS) return "walk";
  return "run";
}

const durSec = (s: MoveSegment) => (s.endMs - s.startMs) / 1000;

// Fuse neighbouring same-kind segments into one.
function coalesce(segs: MoveSegment[]): MoveSegment[] {
  const out: MoveSegment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.kind === s.kind) {
      last.endMs = s.endMs;
      last.distanceM += s.distanceM;
    } else out.push({ ...s });
  }
  return out;
}

// Classify each step, coalesce by kind, then repeatedly absorb any too-short segment
// into its longer neighbour (whose kind wins) until every surviving segment clears
// MIN_SEG_SEC — hysteresis so momentary noise doesn't fragment the run into confetti.
export function classifySteps(steps: MoveStep[]): MoveSegment[] {
  const usable = steps.filter((s) => s.t1 > s.t0);
  if (!usable.length) return [];
  let segs = coalesce(
    usable.map((s) => ({
      kind: kindOf(s.dist / ((s.t1 - s.t0) / 1000)),
      startMs: s.t0,
      endMs: s.t1,
      distanceM: s.dist,
    })),
  );
  while (segs.length > 1) {
    let idx = -1;
    for (let i = 0; i < segs.length; i++) {
      if (durSec(segs[i]) < MIN_SEG_SEC && (idx < 0 || durSec(segs[i]) < durSec(segs[idx]))) idx = i;
    }
    if (idx < 0) break; // every segment is long enough
    const left = idx > 0 ? segs[idx - 1] : null;
    const right = idx < segs.length - 1 ? segs[idx + 1] : null;
    // Absorb into the longer-lasting neighbour (its kind is the more established one).
    const into = !left ? right! : !right ? left : durSec(left) >= durSec(right) ? left : right;
    into.startMs = Math.min(into.startMs, segs[idx].startMs);
    into.endMs = Math.max(into.endMs, segs[idx].endMs);
    into.distanceM += segs[idx].distanceM;
    segs.splice(idx, 1);
    segs = coalesce(segs);
  }
  return segs;
}

// Outdoor adapter: per-point speed from the clean+smoothed GPS track (the same track
// RunMap draws and computeRun measures), teleport spikes dropped.
export function segmentsFromTrack(track: TrackPoint[] | undefined): MoveSegment[] {
  if (!track || track.length < 2) return [];
  const t = processTrack(track);
  const steps: MoveStep[] = [];
  for (let i = 1; i < t.length; i++) {
    const dt = (t[i].t - t[i - 1].t) / 1000;
    if (dt <= 0) continue;
    const d = distanceM(t[i - 1], t[i]);
    if (d / dt > MAX_SPEED_MS) continue; // teleport spike
    steps.push({ t0: t[i - 1].t, t1: t[i].t, dist: d });
  }
  return classifySteps(steps);
}

// Auto-pause: turn detected STOP segments into rest breaks, skipping any that overlap a
// break the user already banked manually (so a real, tapped rest isn't double-counted).
// The result feeds the moving-pace + "⏱ Intervals" machinery exactly like a manual break.
// Gated by the `autoDetectBreaks` setting; the caller supplies the segments + existing breaks.
export function autoBreaksFromSegments(segs: MoveSegment[], existing: WorkoutBreak[] | undefined): WorkoutBreak[] {
  const manual = (existing ?? []).map((b) => ({ start: b.at, end: b.at + b.sec * 1000 }));
  const out: WorkoutBreak[] = [];
  for (const s of segs) {
    if (s.kind !== "stop") continue;
    const sec = Math.round((s.endMs - s.startMs) / 1000);
    if (sec < MIN_SEG_SEC) continue; // too short to count as a rest
    if (manual.some((m) => s.startMs < m.end && s.endMs > m.start)) continue; // already a manual break here
    out.push({ at: s.startMs, sec });
  }
  return out;
}

// Indoor / treadmill adapter: build the speed profile from the step-CADENCE stream
// (cumulative steps at each sample × stride) so walk/run/stop fall out of the same
// classifier when there's no GPS. Samples are cumulative + monotonic; a counter reset or
// out-of-order sample (dSteps<0 / dt≤0) is skipped. Feeds History's TreadmillDetail.
export function segmentsFromCadence(samples: StepSample[] | undefined, strideM: number): MoveSegment[] {
  if (!samples || samples.length < 2 || !(strideM > 0)) return [];
  const steps: MoveStep[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    const dSteps = samples[i].steps - samples[i - 1].steps;
    if (dt <= 0 || dSteps < 0) continue;
    steps.push({ t0: samples[i - 1].t, t1: samples[i].t, dist: dSteps * strideM });
  }
  return classifySteps(steps);
}

// Total moving/stopped seconds per kind (for a compact "Ran 21:10 · Walked 4:20" line).
export function segmentTotals(segs: MoveSegment[]): Record<MoveKind, { sec: number; distanceM: number }> {
  const z = { sec: 0, distanceM: 0 };
  const totals: Record<MoveKind, { sec: number; distanceM: number }> = {
    run: { ...z },
    walk: { ...z },
    stop: { ...z },
  };
  for (const s of segs) {
    totals[s.kind].sec += durSec(s);
    totals[s.kind].distanceM += s.distanceM;
  }
  return totals;
}
