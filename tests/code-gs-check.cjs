// Regression checks for the Google Apps Script (apps-script/Code.gs): runs its doPost
// against an in-memory fake spreadsheet — secret handling, which block a session is
// written into, same-day columns, and the bodyweight/profile writers.
// Run: node tests/code-gs-check.cjs [path-to-Code.gs]
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const src = fs.readFileSync(process.argv[2] || path.join(__dirname, "..", "apps-script", "Code.gs"), "utf8");

function makeSheet(name, grid) {
  const g = grid.map((r) => r.slice());
  const width = () => Math.max(1, ...g.map((r) => r.length));
  const cell = (r, c) => (g[r] && g[r][c] != null ? g[r][c] : "");
  const ensure = (r, c) => {
    while (g.length <= r) g.push([]);
    while (g[r].length <= c) g[r].push("");
  };
  const range = (row, col, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(row - 1 + i, col - 1 + j))),
    getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => String(cell(row - 1 + i, col - 1 + j)).replace(/^'/, ""))),
    setValue: (v) => {
      ensure(row - 1, col - 1);
      g[row - 1][col - 1] = v;
    },
    setValues: (vals) =>
      vals.forEach((rv, i) =>
        rv.forEach((v, j) => {
          ensure(row - 1 + i, col - 1 + j);
          g[row - 1 + i][col - 1 + j] = v;
        }),
      ),
  });
  return {
    grid: g,
    getName: () => name,
    getDataRange: () => range(1, 1, Math.max(1, g.length), width()),
    getRange: range,
    getLastRow: () => g.length,
    getLastColumn: () => width(),
    insertRowAfter: (n) => g.splice(n, 0, []),
  };
}

function run(sheets, body, secretProp) {
  const book = Object.fromEntries(sheets.map((s) => [s.getName(), s]));
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => book[n] || null,
        getSheets: () => Object.values(book),
        insertSheet: (n) => (book[n] = makeSheet(n, [])),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === "SECRET" ? secretProp || null : null) }) },
    Utilities: {
      computeDigest: (_a, s) => [...crypto.createHash("sha256").update(s, "utf8").digest()].map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 0 },
      Charset: { UTF_8: 0 },
    },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }), MimeType: { JSON: 0 } },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.doPost({ postData: { contents: JSON.stringify(body) } });
}

let fails = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name} ${cond ? "" : detail}`);
  if (!cond) fails++;
};

// --- secret handling ---
{
  const s = makeSheet("2026", [["Push", "01.09.26"], ["3x5 Bench", "80-80-80"]]);
  check("placeholder secret refuses everything", run([s], { secret: "CHANGE_ME", ping: true }).ok === false);
  check("script property secret works", run([s], { secret: "prop-secret-123", ping: true }, "prop-secret-123").ok === true);
  check("wrong secret refused", run([s], { secret: "nope", ping: true }, "prop-secret-123").ok === false);
}
const S = "prop-secret-123";

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
  const res = run([s], { secret: S, year: 2026, dayName: "Running", date: "10.09.26", exercises: [], note: "easy", distance: "6.00 km", allowCreate: true }, S);
  check("writes into the dated Running block", res.ok && res.row === 5, JSON.stringify(res));
  check("the Legs block's Running row is untouched", s.grid[1][2] == null || s.grid[1][2] === "", JSON.stringify(s.grid[1]));
}

// --- no dated block: an exercise row with the name must NOT be used; create a block instead ---
{
  const s = makeSheet("2026", [["Legs", "01.09.26"], ["Running", "5 km"], ["Note", ""]]);
  const res = run([s], { secret: S, year: 2026, dayName: "Running", date: "10.09.26", exercises: [], note: "first run", allowCreate: true }, S);
  check("creates a new block instead of writing into Legs", res.ok && res.created === true, JSON.stringify(res));
  check("Legs block untouched", s.grid[0].length === 2 && (s.grid[1][2] == null || s.grid[1][2] === ""), JSON.stringify(s.grid.slice(0, 3)));
}

// --- fresh year tab: undated template block after a spacer still matches ---
{
  const s = makeSheet("2027", [["Push"], ["3x5 Bench"], ["Note"], [""], ["Pull"], ["3x8 Row"], ["Note"]]);
  const res = run([s], { secret: S, year: 2027, dayName: "Pull", date: "02.01.27", exercises: [{ name: "Row", cell: "60-60-60" }] }, S);
  check("fresh-year Pull block found", res.ok && res.row === 5 && res.written[0] === "Row", JSON.stringify(res));
  check("first block (row 1) also matches", run([s], { secret: S, year: 2027, dayName: "Push", date: "03.01.27", exercises: [{ name: "Bench", cell: "80" }] }, S).row === 1);
}

// --- same-day second cardio session gets its own column; a retry reuses its column ---
{
  const s = makeSheet("2026", [["Walk", "20.09.26"], ["Distance", "2.00 km"], ["Route", "https://x/#route=a"], ["Note", "morning"]]);
  const second = run([s], { secret: S, year: 2026, dayName: "Walk", date: "20.09.26", exercises: [], distance: "3.10 km", route: "https://x/#route=b", note: "evening" }, S);
  check("second same-day walk gets a new column", second.ok && second.column === 3, JSON.stringify(second));
  check("first walk's note kept", s.grid[3][1] === "morning", JSON.stringify(s.grid[3]));
  const retry = run([s], { secret: S, year: 2026, dayName: "Walk", date: "20.09.26", exercises: [], distance: "3.10 km", route: "https://x/#route=b", note: "evening" }, S);
  check("a retry reuses its own column", retry.ok && retry.column === 3, JSON.stringify(retry));
}

// --- bodyweight/profile: fixed tabs, validated values ---
{
  const book = [makeSheet("2026", [["Push", "01.09.26"]])];
  const bwRes = run(book, { secret: S, action: "bodyweight", tab: "2026", entries: [{ year: "=HYPERLINK(1)", kg: 80 }, { year: 2025, kg: 82 }] }, S);
  check("bodyweight writes only the valid entry", bwRes.ok && bwRes.count === 1, JSON.stringify(bwRes));
  const pr = run(book, { secret: S, action: "profile", tab: "2026", age: "=1+1", sex: "@evil" }, S);
  check("profile rejects formula-like values", pr.ok && pr.count === 0, JSON.stringify(pr));
  check("caller-chosen tab ignored (year tab untouched)", book[0].grid.length === 1 && book[0].grid[0].length === 2);
}

console.log(fails ? `${fails} FAILURE(S)` : "ALL PASS");
process.exitCode = fails ? 1 : 0;
