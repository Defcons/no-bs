// Full-screen route viewer opened from a sheet "Route" link (#route=<encoded>).
// Decodes the polyline and draws the actual traced path on a map. Self-hosted +
// behind Cloudflare Access, so the route stays private.
import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { decodePolyline } from "../lib/polyline";
import { distanceM } from "../lib/geofence";
import { fmtDist } from "../lib/runStats";
import { TILE_URL } from "./RunMap";

export function RouteViewer({ encoded, onClose }: { encoded: string; onClose: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const pts = useMemo(() => {
    try {
      return decodePolyline(encoded);
    } catch {
      return [];
    }
  }, [encoded]);

  const dist = useMemo(() => {
    let d = 0;
    for (let i = 1; i < pts.length; i++) {
      d += distanceM({ lat: pts[i - 1][0], lng: pts[i - 1][1] }, { lat: pts[i][0], lng: pts[i][1] });
    }
    return d;
  }, [pts]);

  useEffect(() => {
    if (!el.current || pts.length < 2) return;
    const map = L.map(el.current, { attributionControl: true });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    const line = L.polyline(pts, { color: "#4f8cff", weight: 4, opacity: 0.9 }).addTo(map);
    L.circleMarker(pts[0], { radius: 6, color: "#34d399", fillColor: "#34d399", fillOpacity: 1 }).addTo(map);
    L.circleMarker(pts[pts.length - 1], { radius: 6, color: "#ef4444", fillColor: "#ef4444", fillOpacity: 1 }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [30, 30] });
    const id = window.setTimeout(() => map.invalidateSize(), 60);
    return () => {
      window.clearTimeout(id);
      map.remove();
    };
  }, [pts]);

  return (
    <div className="route-viewer">
      <header className="route-viewer-bar">
        <button className="mini" onClick={onClose}>
          ← Back
        </button>
        <span className="route-viewer-title">Route · {fmtDist(dist)}</span>
      </header>
      {pts.length < 2 ? (
        <p className="pad muted">Couldn't read this route link.</p>
      ) : (
        <div ref={el} className="route-viewer-map" />
      )}
    </div>
  );
}
