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

console.log(fails ? `${fails} FAILURE(S)` : "ALL PASS");
process.exitCode = fails ? 1 : 0;
