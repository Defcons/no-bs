// Map-matching (snap-to-road) via a self-hosted Valhalla endpoint. Optional and
// per-device: the endpoint URL + bearer token live in Settings, never baked in
// (the 1.47 no-baked-secret rule). Every function returns null / {ok:false} on
// ANY failure, so a caller always falls back to the raw track — matching is a
// pure enhancement, never a dependency (offline runs keep working).
import { getSetting } from "../db";
import type { TrackPoint } from "../types";
import { decodePolyline, downsample } from "./polyline";

export type Costing = "pedestrian" | "bicycle";

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

// POST the track to Valhalla /trace_route and return the snapped path as
// [lat,lng] points. Valhalla encodes leg shapes at precision 1e6.
export async function mapMatch(track: TrackPoint[], costing: Costing = "pedestrian"): Promise<[number, number][] | null> {
  const { url, token } = await endpoint();
  if (!url || !token || track.length < 2) return null;
  // Valhalla map-matches the SHAPE, so thinning a long track keeps the request
  // small without changing which roads it snaps to.
  const shape = downsample(track, 1000).map((p) => ({ lat: p.lat, lon: p.lng, time: Math.round(p.t / 1000) }));
  try {
    const res = await fetch(`${url}/trace_route`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ costing, shape_match: "map_snap", shape }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as TraceResponse;
    const pts = (json.trip?.legs ?? []).flatMap((l) => (l.shape ? decodePolyline(l.shape, 1e6) : []));
    return pts.length >= 2 ? pts : null;
  } catch {
    return null; // offline / blocked / bad response → caller keeps the raw track
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
