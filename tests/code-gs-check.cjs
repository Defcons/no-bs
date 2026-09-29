// Regression checks for the Google Apps Script (apps-script/Code.gs): runs its doPost
// against an in-memory fake spreadsheet — secret handling, which block a session is
// written into, same-day columns, and the bodyweight/profile writers.
// Run: node tests/code-gs-check.cjs   (CODE_GS=<path> to test another copy)
const { makeSheet, runDoPost, TEST_SECRET } = require("./code-gs-harness.cjs");

let fails = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name} ${cond ? "" : detail}`);
  if (!cond) fails++;
};

// --- secret handling ---
{
  const s = makeSheet("2026", [["Push", "01.09.26"], ["3x5 Bench", "80-80-80"]]);
  check("placeholder secret refuses everything", runDoPost([s], { secret: "CHANGE_ME", ping: true }, { secretProp: null }).ok === false);
  check("script property secret works", runDoPost([s], { secret: TEST_SECRET, ping: true }).ok === true);
  check("wrong secret refused", runDoPost([s], { secret: "nope", ping: true }).ok === false);
}

// --- header prefers a dated block over a same-named exercise row ---
{
  const s = makeSheet("2026", [
    ["Legs", "01.09.26"],
    ["Running", "5 km"], // an exercise row named like the custom session
    ["Note", ""],
    [""],
    ["Running", "03.09.26"], // the real custom "Running" block
    ["Distance", "4.20 km"],
    ["Note", ""],
  ]);
  const res = runDoPost([s], { year: 2026, dayName: "Running", date: "10.09.26", exercises: [], note: "easy", distance: "6.00 km", allowCreate: true });
  check("writes into the dated Running block", res.ok && res.row === 5, JSON.stringify(res));
  check("the Legs block's Running row is untouched", s.grid[1][2] == null || s.grid[1][2] === "", JSON.stringify(s.grid[1]));
}

// --- no dated block: an exercise row with the name must NOT be used; create a block instead ---
{
  const s = makeSheet("2026", [["Legs", "01.09.26"], ["Running", "5 km"], ["Note", ""]]);
  const res = runDoPost([s], { year: 2026, dayName: "Running", date: "10.09.26", exercises: [], note: "first run", allowCreate: true });
  check("creates a new block instead of writing into Legs", res.ok && res.created === true, JSON.stringify(res));
  check("Legs block untouched", s.grid[0].length === 2 && (s.grid[1][2] == null || s.grid[1][2] === ""), JSON.stringify(s.grid.slice(0, 3)));
}

// --- fresh year tab: undated template block after a spacer still matches ---
{
  const s = makeSheet("2027", [["Push"], ["3x5 Bench"], ["Note"], [""], ["Pull"], ["3x8 Row"], ["Note"]]);
  const res = runDoPost([s], { year: 2027, dayName: "Pull", date: "02.01.27", exercises: [{ name: "Row", cell: "60-60-60" }] });
  check("fresh-year Pull block found", res.ok && res.row === 5 && res.written[0] === "Row", JSON.stringify(res));
  check("first block (row 1) also matches", runDoPost([s], { year: 2027, dayName: "Push", date: "03.01.27", exercises: [{ name: "Bench", cell: "80" }] }).row === 1);
}

// --- same-day second cardio session gets its own column; a retry reuses its column ---
{
  const s = makeSheet("2026", [["Walk", "20.09.26"], ["Distance", "2.00 km"], ["Route", "https://x/#route=a"], ["Note", "morning"]]);
  const second = runDoPost([s], { year: 2026, dayName: "Walk", date: "20.09.26", exercises: [], distance: "3.10 km", route: "https://x/#route=b", note: "evening" });
  check("second same-day walk gets a new column", second.ok && second.column === 3, JSON.stringify(second));
  check("first walk's note kept", s.grid[3][1] === "morning", JSON.stringify(s.grid[3]));
  const retry = runDoPost([s], { year: 2026, dayName: "Walk", date: "20.09.26", exercises: [], distance: "3.10 km", route: "https://x/#route=b", note: "evening" });
  check("a retry reuses its own column", retry.ok && retry.column === 3, JSON.stringify(retry));
}

// --- bodyweight/profile: fixed tabs, validated values ---
{
  const book = [makeSheet("2026", [["Push", "01.09.26"]])];
  const bwRes = runDoPost(book, { action: "bodyweight", tab: "2026", entries: [{ year: "=HYPERLINK(1)", kg: 80 }, { year: 2025, kg: 82 }] });
  check("bodyweight writes only the valid entry", bwRes.ok && bwRes.count === 1, JSON.stringify(bwRes));
  const pr = runDoPost(book, { action: "profile", tab: "2026", age: "=1+1", sex: "@evil" });
  check("profile rejects formula-like values", pr.ok && pr.count === 0, JSON.stringify(pr));
  check("caller-chosen tab ignored (year tab untouched)", book[0].grid.length === 1 && book[0].grid[0].length === 2);
}

// --- session Id: update in place, mark deleted (never clear) ---
{
  const s = makeSheet("2026", [["Push", "20.09.26"], ["3x5 Bench Press", "75-75-75"], ["3x8 Row", "60-60-60"], ["Note", "old session"]]);
  const id = "id-2026-09-27T17:00:00.000Z";
  const first = runDoPost([s], { year: 2026, dayName: "Push", date: "27.09.26", id, note: "felt good", exercises: [{ name: "Bench Press", cell: "80-80-80" }, { name: "Row", cell: "65-65-65" }] });
  check("first push writes the Id row", first.ok && first.idWritten && !first.updated && s.grid.some((r) => r[0] === "Id" && r[2] === id), JSON.stringify(first));
  const retry = runDoPost([s], { year: 2026, dayName: "Push", date: "27.09.26", id, note: "felt good", exercises: [{ name: "Bench Press", cell: "80-80-80" }, { name: "Row", cell: "65-65-65" }] });
  check("a retry updates its own column", retry.ok && retry.updated && retry.column === first.column, JSON.stringify(retry));
  const edit = runDoPost([s], { year: 2026, dayName: "Push", date: "27.09.26", id, note: "", exercises: [{ name: "Bench Press", cell: "82,5-80-80" }] });
  const col = first.column - 1;
  const rowOf = (label) => s.grid.findIndex((r) => r[0] === label);
  check("an edit updates the same column", edit.ok && edit.updated && edit.column === first.column, JSON.stringify(edit));
  check("…with the new bench cell", s.grid[rowOf("3x5 Bench Press")][col] === "82,5-80-80", JSON.stringify(s.grid));
  check("…the removed exercise cleared", s.grid[rowOf("3x8 Row")][col] === "", JSON.stringify(s.grid[rowOf("3x8 Row")]));
  check("…the emptied note cleared", s.grid[rowOf("Note")][col] === "", JSON.stringify(s.grid[rowOf("Note")]));
  check("…and the older session untouched", s.grid[rowOf("3x5 Bench Press")][1] === "75-75-75" && s.grid[rowOf("Note")][1] === "old session");
  const del = runDoPost([s], { action: "markDeleted", year: 2026, dayName: "Push", id, deleted: true });
  check("delete MARKS the column", del.ok && del.found && s.grid[rowOf("Id")][col] === "deleted " + id, JSON.stringify(del));
  check("…values are kept", s.grid[rowOf("3x5 Bench Press")][col] === "82,5-80-80");
  check("…and greyed out", s.fmt[`${rowOf("3x5 Bench Press")},${col}`]?.line === "line-through");
  const undo = runDoPost([s], { action: "markDeleted", year: 2026, dayName: "Push", id, deleted: false });
  check("restore unmarks it", undo.ok && s.grid[rowOf("Id")][col] === id && s.fmt[`${rowOf("3x5 Bench Press")},${col}`]?.line === "none", JSON.stringify(s.fmt));
  const other = runDoPost([s], { year: 2026, dayName: "Push", date: "27.09.26", id: "id-2026-09-27T19:00:00.000Z", exercises: [{ name: "Bench Press", cell: "60-60-60" }] });
  check("another same-day session gets its own column", other.ok && !other.updated && other.column !== first.column, JSON.stringify(other));
  const unknown = runDoPost([s], { action: "markDeleted", year: 2026, dayName: "Push", id: "id-1999-01-01T00:00:00.000Z", deleted: true });
  check("marking an unknown id changes nothing", unknown.ok && unknown.found === false);
}

// --- an exercise the block has no row for gets its own row (no more stuck "pending") ---
{
  const s = makeSheet("2026", [
    ["Legs & Shoulder", "24.09.26"], ["3x5 Squat", "60-60-60"], ["3x10 Calves", "237-237-237"],
    ["Note", "old"], ["Mood", "4→7"], ["Time", "1:17:50"], [""],
    ["Chest & Arms", "26.09.26"], ["3x5 Bench", "80-90-90"],
  ]);
  const res = runDoPost([s], { year: 2026, dayName: "Legs & Shoulder", date: "27.09.26", id: "id-2026-09-27T10:00:00.000Z", note: "calves pump", time: "1:05:00",
    exercises: [{ name: "Squat", cell: "70-70-70" }, { name: "Calves", cell: "240-240-240" }, { name: "Drop calves lighter", cell: "180-160-140" }] });
  const labels = s.grid.map((r) => String(r[0] ?? ""));
  const at = (label) => labels.indexOf(label);
  check("nothing is skipped", res.ok && (res.skipped || []).length === 0 && res.written.includes("Drop calves lighter"), JSON.stringify(res));
  check("the new row sits after the last exercise, above Note", at("Drop calves lighter") === at("3x10 Calves") + 1 && at("Note") === at("Drop calves lighter") + 1, JSON.stringify(labels));
  check("…with the logged sets in this session's column", s.grid[at("Drop calves lighter")]?.[2] === "180-160-140");
  check("note and time still land in their own (shifted) rows", s.grid[at("Note")][2] === "calves pump" && s.grid[at("Time")][2] === "1:05:00", JSON.stringify(s.grid));
  check("the next block is untouched", s.grid[at("Chest & Arms")][1] === "26.09.26" && labels[at("Chest & Arms") - 1] === "", JSON.stringify(labels));
  const again = runDoPost([s], { year: 2026, dayName: "Legs & Shoulder", date: "28.09.26", id: "id-2026-09-28T10:00:00.000Z", exercises: [{ name: "Drop calves lighter", cell: "170-150" }] });
  check("a later session reuses that row (no second one)", again.ok && s.grid.filter((r) => r[0] === "Drop calves lighter").length === 1 && s.grid[at("Drop calves lighter")]?.[3] === "170-150", JSON.stringify(s.grid.map((r) => r[0])));
}
{
  // A block with no meta rows, followed by the spacer and the next block.
  const s = makeSheet("2026", [["Push", "01.09.26"], ["3x5 Bench", "80"], [""], ["Pull", "02.09.26"], ["3x5 Deadlift", "100"]]);
  runDoPost([s], { year: 2026, dayName: "Push", date: "03.09.26", exercises: [{ name: "Bench", cell: "82" }, { name: "Cable fly", cell: "20-20" }] });
  const labels = s.grid.map((r) => String(r[0] ?? ""));
  check("with no meta rows, the new row still stays inside its block (above the spacer)", labels.indexOf("Cable fly") === 2 && labels[3] === "" && labels[4] === "Pull", JSON.stringify(labels));
}

// --- two different same-day sessions never share a column (Legs 25.09, 2026-09-27) ---
{
  const s = makeSheet("2026", [["Legs & Shoulder", "25.09.26"], ["3x5 Squat", ""], ["Time", "0:02:16"], ["Time of day", "10:08"]]);
  const later = runDoPost([s], { year: 2026, dayName: "Legs & Shoulder", date: "25.09.26", id: "id-2026-09-25T09:54:57.214Z", time: "0:45:05", timeOfDay: "11:54",
    exercises: [{ name: "Squat", cell: "100-105-110" }] });
  const row = (label) => s.grid.find((r) => r[0] === label);
  check("a later same-day session gets its own column", later.ok && later.column === 3, JSON.stringify(later));
  check("…and the earlier session's time is not overwritten", row("Time")[1] === "0:02:16" && row("Time of day")[1] === "10:08", JSON.stringify(s.grid));
  const retry = runDoPost([s], { year: 2026, dayName: "Legs & Shoulder", date: "25.09.26", time: "0:02:16", timeOfDay: "10:08", exercises: [] });
  check("a retry of the earlier (pre-Id) session still reuses its column", retry.ok && retry.column === 2, JSON.stringify(retry));
  const s2 = makeSheet("2026", [["Push", "01.10.26"], ["3x5 Bench", ""], ["Time of day", "18:00"], ["Id", "id-2026-10-01T16:00:00.000Z"]]);
  const other = runDoPost([s2], { year: 2026, dayName: "Push", date: "01.10.26", id: "id-2026-10-01T16:00:05.000Z", timeOfDay: "18:00", exercises: [{ name: "Bench", cell: "80" }] });
  check("a column carrying another session's Id is never reused", other.ok && other.column === 3, JSON.stringify(other));
}

// --- set/exercise notes ride on the exercise's cell as a cell note, highlighted ---
{
  const NOTE_COLOR = "#c55a11";
  const s = makeSheet("2026", [["Push", "20.09.26"], ["3x5 Bench Press", "75-75-75"], ["3x8 Row", "60-60-60"], ["3x8 Fly", "20-20"], ["Note", ""]]);
  const id = "id-2026-09-28T17:00:00.000Z";
  const push = (exercises) => runDoPost([s], { year: 2026, dayName: "Push", date: "28.09.26", id, exercises });
  const res = push([
    { name: "Bench Press", cell: "80-80-80", note: "Set 2: left shoulder" },
    { name: "Row", cell: "65-65-65" },
    { name: "Fly", cell: "", note: "machine taken" },
  ]);
  const at = (label) => s.grid.findIndex((r) => r[0] === label);
  const col = res.column - 1;
  const key = (label) => `${at(label)},${col}`;
  check("a noted exercise's cell carries the note", s.notes[key("3x5 Bench Press")] === "Set 2: left shoulder", JSON.stringify(s.notes));
  check("…and is highlighted (bold, coloured text)", s.fmt[key("3x5 Bench Press")]?.color === NOTE_COLOR && s.fmt[key("3x5 Bench Press")]?.weight === "bold", JSON.stringify(s.fmt));
  check("a cell without a note stays plain", !s.notes[key("3x8 Row")] && s.fmt[key("3x8 Row")]?.color == null);
  check("a note-only exercise keeps its note on an empty cell", res.written.includes("Fly") && s.notes[key("3x8 Fly")] === "machine taken" && s.grid[at("3x8 Fly")][col] === "", JSON.stringify(res));
  check("the older session's cells are untouched", !s.notes[`${at("3x5 Bench Press")},1`] && s.fmt[`${at("3x5 Bench Press")},1`] == null);
  push([{ name: "Bench Press", cell: "80-80-80" }, { name: "Row", cell: "65-65-65", note: "grip slipped" }]);
  check("an edit that drops a note clears the note and its highlight", !s.notes[key("3x5 Bench Press")] && s.fmt[key("3x5 Bench Press")]?.color == null && s.fmt[key("3x5 Bench Press")]?.weight == null, JSON.stringify(s.fmt));
  check("…a note added in the edit lands", s.notes[key("3x8 Row")] === "grip slipped" && s.fmt[key("3x8 Row")]?.color === NOTE_COLOR);
  check("…and an exercise removed in the edit loses its note", !s.notes[key("3x8 Fly")] && s.fmt[key("3x8 Fly")]?.color == null);
  runDoPost([s], { action: "markDeleted", year: 2026, dayName: "Push", id, deleted: true });
  check("delete greys a noted cell like the rest", s.fmt[key("3x8 Row")]?.color === "#9e9e9e");
  runDoPost([s], { action: "markDeleted", year: 2026, dayName: "Push", id, deleted: false });
  check("restore brings the highlight back (only on noted cells)", s.fmt[key("3x8 Row")]?.color === NOTE_COLOR && s.fmt[key("3x5 Bench Press")]?.color == null, JSON.stringify(s.fmt));
}
{
  // A row inserted below a noted cell inherits its formatting in Sheets; it must not look noted.
  const s = makeSheet("2026", [["Push", "20.09.26"], ["3x5 Bench", "75"], ["Note", ""]]);
  runDoPost([s], { year: 2026, dayName: "Push", date: "21.09.26", exercises: [{ name: "Bench", cell: "80", note: "PR" }] });
  runDoPost([s], { year: 2026, dayName: "Push", date: "22.09.26", exercises: [{ name: "Bench", cell: "82" }, { name: "Cable fly", cell: "20-20" }] });
  const fly = s.grid.findIndex((r) => r[0] === "Cable fly");
  check("a new row does not inherit a noted cell's highlight", fly === 2 && s.fmt[`${fly},2`]?.color == null && s.fmt[`${fly},2`]?.weight == null, JSON.stringify(s.fmt));
  check("…while the noted cell keeps its note and highlight", s.notes["1,2"] === "PR" && s.fmt["1,2"]?.color === "#c55a11", JSON.stringify(s.notes));
  const s2 = makeSheet("2026", [["Push", "20.09.26"], ["3x5 Bench", "75"]]);
  const made = runDoPost([s2], { year: 2026, dayName: "Boxing", date: "23.09.26", allowCreate: true, exercises: [{ name: "Bag work", cell: "", note: "3 rounds" }] });
  const bag = s2.grid.findIndex((r) => r[0] === "Bag work");
  check("a newly created block's exercise cell gets its note", made.created && s2.notes[`${bag},1`] === "3 rounds" && s2.fmt[`${bag},1`]?.weight === "bold", JSON.stringify(s2.notes));
}

console.log(fails ? `${fails} FAILURE(S)` : "ALL PASS");
process.exitCode = fails ? 1 : 0;
