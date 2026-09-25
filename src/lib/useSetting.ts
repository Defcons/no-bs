import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getSetting } from "../db";

// Robust reactive setting read — a cold-start-safe replacement for
// `useLiveQuery(() => getSetting(key, fallback), [], fallback)`.
//
// Why: on a COLD start on the Android WebView, that live query can hand back the FALLBACK
// and never deliver the persisted value until a WRITE occurs — the bug behind "a toggle
// shows ON but doesn't take effect until I re-toggle / restart" (root-caused 2026-09-25,
// fixed for the break toggles in 1.75.1; this generalises it app-wide).
//
// How: we read the value FRESH (authoritative) and use the live query ONLY as a change
// SIGNAL — re-reading fresh whenever the settings table changes (writes fire reliably even
// on the WebView). The live query's own (possibly stale) value is never returned, so it
// can't leak a stale reading through.
export function useSetting<T>(key: string, fallback: T): T {
  const [val, setVal] = useState<T>(fallback);
  // Signal only: its VALUE is intentionally unused — it just re-runs the effect on writes.
  const signal = useLiveQuery(() => getSetting<T>(key, fallback), [key]);
  useEffect(() => {
    let on = true;
    void getSetting<T>(key, fallback).then((v) => {
      if (on) setVal(v);
    });
    return () => {
      on = false;
    };
    // Re-read fresh on mount, on key change, and whenever the live query fires (a write).
    // `fallback` is a stable primitive per call site; excluded deliberately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, signal]);
  return val;
}
