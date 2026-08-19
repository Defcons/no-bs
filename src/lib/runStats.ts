// Derived stats for a recorded GPS route (distance, pace/speed, HR).
import type { TrackPoint } from "../types";
import { distanceM } from "./geofence";

export type RunStats = {
  distanceM: number;
  durationSec: number;
  avgSpeedKmh: number;
  avgPaceSecPerKm: number;
  avgHr: number | null;
  maxHr: number | null;
  points: number;
};

// A segment implying more than this speed is a GPS teleport (multipath spike), not
// movement — 72 km/h is beyond any running/cycling this app records. Without the
// gate one out-and-back spike inflates a run by hundreds of metres and mints a
// permanent fake pace PB (runPBs keeps the minimum forever).
const MAX_SEGMENT_SPEED_MS = 20;

export function computeRun(track: TrackPoint[] | undefined): RunStats | null {
  if (!track || track.length < 2) return null;
  let dist = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    const d = distanceM(a, b);
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0 || d / dt > MAX_SEGMENT_SPEED_MS) continue; // teleport → drop the segment
    dist += d;
  }
  const durationSec = Math.max(1, (track[track.length - 1].t - track[0].t) / 1000);
  const hrs = track.map((p) => p.hr).filter((h): h is number => h != null);
  return {
    distanceM: dist,
    durationSec,
    avgSpeedKmh: (dist / durationSec) * 3.6,
    avgPaceSecPerKm: dist > 0 ? durationSec / (dist / 1000) : 0,
    avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    points: track.length,
  };
}

export function fmtPace(secPerKm: number): string {
  if (!secPerKm || !Number.isFinite(secPerKm)) return "—";
  const total = Math.round(secPerKm); // round first so 59.6s carries to the minute
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

export function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}
