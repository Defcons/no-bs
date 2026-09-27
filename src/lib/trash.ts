// "Recently deleted": deleting a workout moves it here instead of erasing it, so a
// mis-tap is recoverable for TRASH_DAYS. The sheet is never cleared either — the
// workout's column is only marked deleted (greyed out, values kept).
import { db, type StoredWorkout, type TrashItem } from "../db";
import { markInSheet, tombstoneForSheet, untombstone } from "./sheetSync";

export const TRASH_DAYS = 30;

export async function deleteWorkout(w: StoredWorkout): Promise<void> {
  if (w.id == null) return;
  await tombstoneForSheet(w); // its sheet copy mustn't re-import on the next "Import from sheet"
  await db.transaction("rw", db.workouts, db.trash, async () => {
    await db.trash.add({ deletedAt: Date.now(), workout: w });
    await db.workouts.delete(w.id!);
  });
  void markInSheet(w, true);
}

export async function restoreWorkout(item: TrashItem): Promise<void> {
  await db.transaction("rw", db.workouts, db.trash, async () => {
    await db.workouts.put(item.workout); // same id as before, so History stays stable
    await db.trash.delete(item.id!);
  });
  await untombstone(item.workout);
  void markInSheet(item.workout, false);
}

// Called at startup: items older than TRASH_DAYS are gone for good.
export async function purgeOldTrash(): Promise<void> {
  await db.trash.where("deletedAt").below(Date.now() - TRASH_DAYS * 86400000).delete();
}
