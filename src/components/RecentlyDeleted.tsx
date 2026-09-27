// Settings → Backup & data → Recently deleted: workouts deleted from History, restorable
// for TRASH_DAYS (then purged at startup). Restoring also un-marks the sheet column.
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { niceDate } from "../lib/format";
import { restoreWorkout, TRASH_DAYS } from "../lib/trash";

export function RecentlyDeleted() {
  const items = useLiveQuery(() => db.trash.orderBy("deletedAt").reverse().toArray(), [], []);
  const [busy, setBusy] = useState<number | null>(null);
  if (!items.length) return null;
  const daysLeft = (deletedAt: number) => Math.max(0, TRASH_DAYS - Math.floor((Date.now() - deletedAt) / 86400000));
  return (
    <details className="recently-deleted">
      <summary>Recently deleted ({items.length})</summary>
      <p className="muted tiny">Deleted workouts are kept here for {TRASH_DAYS} days, then removed for good.</p>
      <ul className="plain-list">
        {items.map((it) => (
          <li key={it.id} className="row">
            <span>
              {it.workout.dayName} · {niceDate(it.workout.date)}
              <span className="muted tiny"> · {daysLeft(it.deletedAt)} days left</span>
            </span>
            <button
              className="mini"
              disabled={busy === it.id}
              onClick={async () => {
                setBusy(it.id!);
                try {
                  await restoreWorkout(it);
                } finally {
                  setBusy(null);
                }
              }}
            >
              Restore
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
