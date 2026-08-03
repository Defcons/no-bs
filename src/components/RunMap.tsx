// Leaflet map of a recorded GPS route: the path as a polyline over an OpenStreetMap
// basemap, with green start / red end markers. Tiles are fetched over the network
// (swap TILE_URL for a self-hosted tileserver later if you'd rather not hit OSM).
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { TrackPoint, WorkoutBreak } from "../types";
import { mmss } from "../lib/format";

export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

// Only rests at least this long are worth marking on the route (skip quick skips).
const LONG_BREAK_SEC = 60;
// Ignore a break whose nearest track point is further off in time than this — it
// means GPS wasn't actually covering that moment, so any placement would be bogus.
const MATCH_TOLERANCE_MS = 120_000;

export function RunMap({ track, breaks }: { track: TrackPoint[]; breaks?: WorkoutBreak[] }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current || track.length < 2) return;
    const pts = track.map((p) => [p.lat, p.lng] as [number, number]);
    const map = L.map(el.current, { attributionControl: true, zoomControl: true });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    const line = L.polyline(pts, { color: "#4f8cff", weight: 4, opacity: 0.9 }).addTo(map);
    L.circleMarker(pts[0], { radius: 6, color: "#34d399", fillColor: "#34d399", fillOpacity: 1 }).addTo(map);
    L.circleMarker(pts[pts.length - 1], { radius: 6, color: "#ef4444", fillColor: "#ef4444", fillOpacity: 1 }).addTo(map);
    // Amber markers where a long rest was taken, placed at the track point closest in
    // time to the break (tap for the duration).
    for (const b of breaks ?? []) {
      if (b.sec < LONG_BREAK_SEC) continue;
      let near = track[0];
      for (const p of track) if (Math.abs(p.t - b.at) < Math.abs(near.t - b.at)) near = p;
      if (Math.abs(near.t - b.at) > MATCH_TOLERANCE_MS) continue;
      L.circleMarker([near.lat, near.lng], { radius: 6, color: "#0b0b0c", weight: 2, fillColor: "#f59e0b", fillOpacity: 1 })
        .addTo(map)
        .bindPopup(`⏸ ${mmss(b.sec)} rest`);
    }
    map.fitBounds(line.getBounds(), { padding: [24, 24] });
    // The container is inside a collapsible row; make sure Leaflet measures it once
    // it's actually laid out.
    const id = window.setTimeout(() => map.invalidateSize(), 60);
    return () => {
      window.clearTimeout(id);
      map.remove();
    };
  }, [track, breaks]);

  if (track.length < 2) return null;
  return <div ref={el} className="run-map" />;
}
