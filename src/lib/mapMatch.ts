// Map-matching (snap-to-road) via a self-hosted Valhalla endpoint. Optional and
// per-device: the endpoint URL + bearer token live in Settings, never baked in
// (the 1.47 no-baked-secret rule). Every function returns null / {ok:false} on
// ANY failure, so a caller always falls back to the raw track — matching is a
// pure enhancement, never a dependency (offline runs keep working).
import { getSetting } from "../db";
import type { TrackPoint } from "../types";
import { decodePolyline, downsample } from "./polyline";
import { processTrack, segmentTrack } from "./runStats";

export type Costing = "pedestrian" | "bicycle";

// matched = recorded GPS stretches snapped to the network (solid). bridged = the
// routed best-guess of the path taken ACROSS a GPS dropout (dashed, inferred — a
// guess, so kept separate and out of any distance calc).
export type SnapResult = { matched: [number, number][][]; bridged: [number, number][][] };
type Piece = { kind: "matched" | "bridged"; pts: [number, number][] | null };

// Bikes snap to the road network; walk/run/hike snap to paths + roads.
export function costingForName(name?: string): Costing {
  return /\b(bike|cycl|ride|riding|spin)/i.test(name ?? "") ? "bicycle" : "pedestrian";
}

async function endpoint(): Promise<{ url: string; token: string }> {
  const url = (await getSetting<string>("mapMatchUrl", "")).trim().replace(/\/+$/, "");
  const token = (await getSetting<string>("mapMatchToken", "")).trim();
  return { url, token };
}

export async function mapMatchConfigured(): Promise<boolean> {
  const { url, token } = await endpoint();
  return !!url && !!token;
}

type TraceResponse = { trip?: { legs?: { shape?: string }[] } };

// Snap the track to roads. A GPS dropout is a discontinuity map_snap can't bridge
// (it truncates the match at the gap), so split at dropouts (`segmentTrack`, the same
// split the map draws dashed) and handle each piece: MATCH each continuous stretch on
// its own, and BRIDGE each gap by ROUTING between its two ends (the best-guess of the
// path taken while GPS was lost). Runs on the de-spiked+smoothed `processTrack` so the
// magenta corrects the same line the blue one shows. Null = nothing snapped at all.
export async function mapMatch(track: TrackPoint[], costing: Costing = "pedestrian"): Promise<SnapResult | null> {
  const { url, token } = await endpoint();
  if (!url || !token || track.length < 2) return null;
  const segs = segmentTrack(processTrack(track));
  const pieces = await Promise.all(
    segs.map((s): Promise<Piece> => {
      if (s.points.length < 2) return Promise.resolve({ kind: "matched", pts: null });
      if (s.gap) return routeGap(url, token, s.points[0], s.points[s.points.length - 1], costing).then((pts) => ({ kind: "bridged", pts }));
      return matchStretch(url, token, downsample(s.points, 1000), costing).then((pts) => ({ kind: "matched", pts }));
    }),
  );
  const matched = pieces.filter((p) => p.kind === "matched" && p.pts).map((p) => p.pts as [number, number][]);
  const bridged = pieces.filter((p) => p.kind === "bridged" && p.pts).map((p) => p.pts as [number, number][]);
  return matched.length || bridged.length ? { matched, bridged } : null;
}

// Map-match one continuous stretch. Valhalla encodes leg shapes at precision 1e6.
async function matchStretch(url: string, token: string, pts: TrackPoint[], costing: Costing): Promise<[number, number][] | null> {
  const shape = pts.map((p) => ({ lat: p.lat, lon: p.lng, time: Math.round(p.t / 1000) }));
  try {
    const res = await fetch(`${url}/trace_route`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ costing, shape_match: "map_snap", shape }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as TraceResponse;
    const p = (json.trip?.legs ?? []).flatMap((l) => (l.shape ? decodePolyline(l.shape, 1e6) : []));
    return p.length >= 2 ? p : null;
  } catch {
    return null; // offline / blocked / bad response → caller keeps the raw track
  }
}

// Best-guess the path across a GPS dropout by ROUTING (Valhalla /route) between the
// last point before and the first point after. Inferred, not recorded — the caller
// draws it dashed and keeps it out of the distance.
async function routeGap(url: string, token: string, a: TrackPoint, b: TrackPoint, costing: Costing): Promise<[number, number][] | null> {
  try {
    const res = await fetch(`${url}/route`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ costing, locations: [{ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng }] }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as TraceResponse;
    const p = (json.trip?.legs ?? []).flatMap((l) => (l.shape ? decodePolyline(l.shape, 1e6) : []));
    return p.length >= 2 ? p : null;
  } catch {
    return null;
  }
}

// Settings "Test" button — hits /status (open, no token needed) to confirm the
// endpoint is reachable and, if a token is set, that it's accepted for routing.
export async function testMapMatch(): Promise<{ ok: boolean; error?: string }> {
  const { url, token } = await endpoint();
  if (!url) return { ok: false, error: "Enter the endpoint URL first." };
  try {
    const status = await fetch(`${url}/status`);
    if (!status.ok) return { ok: false, error: `Endpoint returned HTTP ${status.status}.` };
    if (!token) return { ok: false, error: "Reachable, but no token set — routing will be refused." };
    // A tiny map-match proves the token is accepted end to end (401 = wrong token).
    const probe = await fetch(`${url}/trace_route`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ costing: "pedestrian", shape_match: "map_snap", shape: [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }] }),
    });
    if (probe.status === 401) return { ok: false, error: "Reachable, but the token was rejected (401)." };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
