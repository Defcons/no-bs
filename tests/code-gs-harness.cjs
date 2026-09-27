// Fake SpreadsheetApp harness: runs apps-script/Code.gs doPost in Node against
// in-memory sheets. Used by tests/code-gs-check.cjs and tests/audit-check.ts.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const src = fs.readFileSync(process.env.CODE_GS || path.join(__dirname, "..", "apps-script", "Code.gs"), "utf8");

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

const TEST_SECRET = "prop-secret-123";
// opts.secretProp: the SECRET script property (null = none set); body.secret defaults to it.
function runDoPost(sheets, body, opts = {}) {
  const secretProp = "secretProp" in opts ? opts.secretProp : TEST_SECRET;
  body = { secret: secretProp ?? undefined, ...body };
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

module.exports = { makeSheet, runDoPost, TEST_SECRET };
