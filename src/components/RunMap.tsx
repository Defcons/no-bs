// Leaflet map of a recorded GPS route: the path as a polyline over a topographic
// basemap, with green start / red end markers. Tiles are fetched over the network
// (self-host from the Valhalla elevation DEM later if you'd rather not hit OSM).
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { TrackPoint, WorkoutBreak } from "../types";
import { processTrack, segmentTrack } from "../lib/runStats";
import { mmss } from "../lib/format";

// OpenTopoMap: topographic base (contours + hillshade) that shows TRAILS/paths
// prominently — the right basemap for trail runs and hikes. Free tiles, fair-use;
// self-host from the same DEM as the Valhalla elevation build later for full privacy.
export const TILE_URL = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
export const TILE_MAX_ZOOM = 17; // OpenTopoMap's max native zoom
export const TILE_ATTRIBUTION = "© OpenStreetMap · SRTM | © OpenTopoMap (CC-BY-SA)";

// Only rests at least this long are worth marking on the route (skip quick skips).
const LONG_BREAK_SEC = 60;
// Ignore a break whose nearest track point is further off in time than this — it
// means GPS wasn't actually covering that moment, so any placement would be bogus.
const MATCH_TOLERANCE_MS = 120_000;

export function RunMap({ track, breaks }: { track: TrackPoint[]; breaks?: WorkoutBreak[] }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current || track.length < 2) return;
    // De-spike the line so a stray multipath fix doesn't draw a teleport spike.
    // Draw the clean + Kalman-smoothed route; computeRun measures distance from this
    // SAME processed track, so the reported distance matches the line drawn.
    let processed = processTrack(track);
    if (processed.length < 2) processed = track; // pathological — better a raw line than none
    const pts = processed.map((p) => [p.lat, p.lng] as [number, number]);
    const map = L.map(el.current, { attributionControl: true, zoomControl: true });
    L.tileLayer(TILE_URL, { maxZoom: TILE_MAX_ZOOM, attribution: TILE_ATTRIBUTION }).addTo(map);
    // Draw recorded stretches solid; draw GPS-dropout connectors dashed + faded so a
    // lost-signal gap doesn't read as a confident straight line across the water.
    for (const seg of segmentTrack(processed)) {
      if (seg.points.length < 2) continue;
      L.polyline(
        seg.points.map((p) => [p.lat, p.lng] as [number, number]),
        { color: "#4f8cff", weight: 4, opacity: seg.gap ? 0.45 : 0.9, dashArray: seg.gap ? "3 9" : undefined },
      ).addTo(map);
    }
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
    map.fitBounds(L.latLngBounds(pts), { padding: [24, 24] });
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
