// Derived stats for a recorded GPS route (distance, pace/speed, HR).
import type { TrackPoint } from "../types";
import { distanceM } from "./geofence";

export type RunStats = {
  distanceM: number; // measured from the clean+smoothed route (matches what RunMap draws)
  rawDistanceM: number; // measured from the raw GPS fixes — for the History before/after
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

// Sum segment distances, skipping teleport segments (multipath spikes) so one bad
// fix can't inflate the total.
function sumDistance(track: TrackPoint[]): number {
  let dist = 0;
  for (let i = 1; i < track.length; i++) {
    const d = distanceM(track[i - 1], track[i]);
    const dt = (track[i].t - track[i - 1].t) / 1000;
    if (dt <= 0 || d / dt > MAX_SEGMENT_SPEED_MS) continue; // teleport → drop the segment
    dist += d;
  }
  return dist;
}

// The clean + smoothed track — what RunMap draws AND what distance is measured from,
// so the reported distance matches the line you see (de-spike, then Kalman-smooth).
export function processTrack(track: TrackPoint[]): TrackPoint[] {
  return smoothTrack(cleanTrack(track));
}

export function computeRun(track: TrackPoint[] | undefined): RunStats | null {
  if (!track || track.length < 2) return null;
  const rawDistanceM = sumDistance(track); // raw GPS — kept for the History before/after
  const dist = sumDistance(processTrack(track)); // distance from the SMOOTHED route
  const durationSec = Math.max(1, (track[track.length - 1].t - track[0].t) / 1000);
  const hrs = track.map((p) => p.hr).filter((h): h is number => h != null);
  return {
    distanceM: dist,
    rawDistanceM,
    durationSec,
    avgSpeedKmh: (dist / durationSec) * 3.6,
    avgPaceSecPerKm: dist > 0 ? durationSec / (dist / 1000) : 0,
    avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    points: track.length,
  };
}

// Drop GPS spikes from a track for DRAWING: a point implying more than
// MAX_SEGMENT_SPEED_MS from the last kept point is multipath, not movement, so it
// would draw as a teleport spike on the map. (computeRun already skips such segments
// for distance; this cleans the polyline itself.) The first point is always kept.
export function cleanTrack(track: TrackPoint[]): TrackPoint[] {
  if (track.length < 2) return track;
  const out: TrackPoint[] = [track[0]];
  for (let i = 1; i < track.length; i++) {
    const a = out[out.length - 1];
    const b = track[i];
    const dt = (b.t - a.t) / 1000;
    if (dt > 0 && distanceM(a, b) / dt > MAX_SEGMENT_SPEED_MS) continue; // spike → skip
    out.push(b);
  }
  return out;
}

// Kalman-smooth a track for DRAWING. A constant-velocity filter (state = position +
// velocity, covariance Pxx/Pxv/Pvv) runs independently on the two axes in local
// metres, each fix weighted by its reported accuracy (`acc`) — so noisy fixes pull
// the line less. This is the smoothing every serious tracker does; it turns jittery
// raw fixes into a clean trajectory. DISTANCE/records deliberately stay on the raw
// track (computeRun), so this only changes how the route is drawn.
const ACCEL_NOISE = 1.5; // process noise σ_a (m/s²) — lower = smoother, higher = hugs turns tighter
const DEFAULT_ACC_M = 20; // assumed accuracy for fixes recorded before `acc` was stored
const MIN_ACC_M = 4; // floor so a fix claiming 1 m can't dominate the filter
export function smoothTrack(track: TrackPoint[]): TrackPoint[] {
  if (track.length < 3) return track;
  const lat0 = track[0].lat;
  const lng0 = track[0].lng;
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const q = ACCEL_NOISE * ACCEL_NOISE;
  const accOf = (p: TrackPoint) => Math.max(MIN_ACC_M, p.acc ?? DEFAULT_ACC_M);
  const ts = track.map((p) => p.t);
  const rs = track.map((p) => accOf(p) ** 2);

  // One forward constant-velocity pass over an axis (local metres): state = position
  // + velocity, covariance Pxx/Pxv/Pvv, each fix weighted by its variance rArr[i].
  const cvPass = (vals: number[], tArr: number[], rArr: number[]): number[] => {
    const out = new Array<number>(vals.length);
    let X = vals[0];
    let V = 0;
    let Pxx = rArr[0];
    let Pxv = 0;
    let Pvv = 100;
    out[0] = X;
    for (let i = 1; i < vals.length; i++) {
      const dt = Math.max(0.1, Math.abs(tArr[i] - tArr[i - 1]) / 1000);
      X += V * dt; // predict (constant velocity + white-noise-acceleration process noise)
      const pxx = Pxx + 2 * dt * Pxv + dt * dt * Pvv + (q * dt ** 3) / 3;
      const pxv = Pxv + dt * Pvv + (q * dt * dt) / 2;
      const pvv = Pvv + q * dt;
      const S = pxx + rArr[i]; // update against the scalar position measurement
      const K0 = pxx / S;
      const K1 = pxv / S;
      const inno = vals[i] - X;
      X += K0 * inno;
      V += K1 * inno;
      Pxx = (1 - K0) * pxx;
      Pvv = pvv - K1 * pxv;
      Pxv = (1 - K0) * pxv;
      out[i] = X;
    }
    return out;
  };
  // Bidirectional: average a forward and a backward pass so neither the constant-
  // velocity lag nor its corner overshoot survives (we have the whole track offline,
  // so we can look both ways — a forward-only filter would lag into every turn).
  const bidi = (vals: number[]): number[] => {
    const f = cvPass(vals, ts, rs);
    const b = cvPass(vals.slice().reverse(), ts.slice().reverse(), rs.slice().reverse()).reverse();
    return vals.map((_, i) => (f[i] + b[i]) / 2);
  };

  const sx = bidi(track.map((p) => (p.lng - lng0) * mPerLng));
  const sy = bidi(track.map((p) => (p.lat - lat0) * mPerLat));
  return track.map((p, i) => ({ ...p, lat: lat0 + sy[i] / mPerLat, lng: lng0 + sx[i] / mPerLng }));
}

const GAP_SEC = 20; // a jump over MORE time than this...
const GAP_DIST_M = 50; // ...AND more distance than this = a GPS dropout, not real movement
export type TrackSegment = { points: TrackPoint[]; gap: boolean };
// Split a track into contiguous drawable segments, flagging the connectors that span a
// GPS DROPOUT (you moved far with no fixes for a while) so the map can draw those dashed
// — an honest "path unknown here" instead of a confident straight line across the water.
// A long PAUSE (many seconds but tiny distance — standing still) is NOT a gap.
export function segmentTrack(track: TrackPoint[]): TrackSegment[] {
  if (track.length < 2) return track.length ? [{ points: track.slice(), gap: false }] : [];
  const segs: TrackSegment[] = [];
  let run: TrackPoint[] = [track[0]];
  for (let i = 1; i < track.length; i++) {
    const dt = (track[i].t - track[i - 1].t) / 1000;
    if (dt > GAP_SEC && distanceM(track[i - 1], track[i]) > GAP_DIST_M) {
      segs.push({ points: run, gap: false });
      segs.push({ points: [track[i - 1], track[i]], gap: true }); // the dropout connector
      run = [track[i]];
    } else {
      run.push(track[i]);
    }
  }
  segs.push({ points: run, gap: false });
  return segs;
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
