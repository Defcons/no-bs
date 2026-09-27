/**
 * Gym Tracker → Google Sheet write-back.
 *
 * Bound Apps Script Web App for the "Trening" sheet. The PWA POSTs a finished
 * workout; this script finds the matching year tab + day-block and writes a new
 * dated column in the sheet's own transposed layout. Also serves read-only
 * summaries (action "summary" / "liftSummary") for external consumers like the
 * Home Assistant voice assistant.
 *
 * Setup: Extensions → Apps Script, paste this, set the secret (preferably as a
 * Script Property named SECRET — Project Settings → Script properties — so pasting
 * a newer version of this file never resets it; or edit the SECRET line below),
 * then Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * Copy the /exec URL into the app (Settings → Google Sheets sync) with the same
 * secret.
 */

var SECRET = "CHANGE_ME"; // fallback when no SECRET script property is set; must match the app's "Shared secret"

// The Script Property wins, so updating this file can't silently reset the secret.
function currentSecret() {
  var fromProps = PropertiesService.getScriptProperties().getProperty("SECRET");
  return fromProps || SECRET;
}

// Compare SHA-256 digests instead of the raw strings: `!==` short-circuits on the
// first differing character (a timing side-channel), and hashing also equalizes
// length. Overkill for a hobby endpoint, but it costs nothing.
function secretOk(provided) {
  var expected = currentSecret();
  // The published placeholder is never a valid secret: an unchanged copy of this
  // file would otherwise open the whole spreadsheet to anyone with the /exec URL.
  if (!expected || expected === "CHANGE_ME") return false;
  if (typeof provided !== "string" || !provided) return false;
  var a = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, provided, Utilities.Charset.UTF_8);
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, expected, Utilities.Charset.UTF_8);
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function doGet() {
  return json({ ok: true, service: "nobs-sync" });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var configured = currentSecret();
    if (!configured || configured === "CHANGE_ME")
      return json({ ok: false, error: "Set a secret in the script first (Script property SECRET, or the SECRET line)" });
    if (!secretOk(body.secret)) return json({ ok: false, error: "bad secret" });
    if (body.ping) return json({ ok: true, ping: true });

    // Pull: return every tab's cells (as displayed) so the app can import
    // workouts that exist in the sheet but not yet on the device.
    // Read under the same lock as writes, so a pull can't see a half-written session
    // (which imports as a partial copy and later duplicates).
    if (body.action === "pull") {
      var pullLock = LockService.getScriptLock();
      try {
        pullLock.waitLock(20000);
      } catch (pullLockErr) {
        return json({ ok: false, error: "Sheet is busy — try again in a moment." });
      }
      try {
        var out = {};
        SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sh) {
          out[sh.getName()] = sh.getDataRange().getDisplayValues();
        });
        return json({ ok: true, tabs: out });
      } finally {
        pullLock.releaseLock();
      }
    }

    // Read-only summaries for external consumers (e.g. the Home Assistant
    // voice assistant). Nothing mutates, so no lock is taken.
    if (body.action === "summary") return summaryAction(body);
    if (body.action === "liftSummary") return liftSummaryAction(body);

    // Serialize all mutations so two devices syncing at once can't compute the
    // same "first empty column" and clobber each other.
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(20000);
    } catch (lockErr) {
      return json({ ok: false, error: "Sheet is busy — try again in a moment." });
    }
    try {

    // Bodyweight: upsert year -> kg rows in a dedicated tab.
    if (body.action === "bodyweight") return writeBodyweight(body);

    // Profile: upsert age/sex key->value rows in a dedicated tab.
    if (body.action === "profile") return writeProfile(body);

    // A workout deleted (or restored) in the app: MARK its column, never clear it.
    if (body.action === "markDeleted") return markDeleted(body);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(String(body.year));
    if (!sheet) return json({ ok: false, error: "no tab named " + body.year });

    var data = sheet.getDataRange().getValues();
    var dayName = String(body.dayName).trim().toLowerCase();

    var headerRow = findHeaderRow(data, dayName);
    // No matching block: Alternative/free-form sessions get a fresh named block
    // appended at the end of the year tab (with Note + Mood rows).
    if (headerRow < 0) {
      if (body.allowCreate) return createBlock(sheet, body);
      return json({ ok: false, error: "no day block '" + body.dayName + "' in " + body.year });
    }

    // Idempotency: a retry (lost response / earlier partial write) must reuse its
    // own column, not mint a new one forever. Reuse an existing column with the
    // same date ONLY if its exercise cells are empty or identical to what we'd
    // write — a genuinely different same-day session falls through to a new column.
    var disp = sheet.getRange(headerRow + 1, 1, data.length - headerRow, Math.max(1, sheet.getLastColumn())).getDisplayValues();
    // A session that already has a column (its Id row holds body.id) is UPDATED in
    // place: an edit made in the app, or a retry. No other column is touched.
    var col = findIdColumn(disp, data, headerRow, body.id);
    var updating = col >= 0;
    var wasDeleted = updating && String(disp[findIdRow(disp, data, headerRow)][col]).trim() !== body.id;
    var want = normDate(body.date);
    for (var c0 = 1; col < 0 && c0 < disp[0].length; c0++) {
      if (want && normDate(disp[0][c0]) === want && columnCompatible(disp, data, headerRow, c0, body.exercises, body)) {
        col = c0;
        break;
      }
    }
    // Else: first empty column in the header row (a session slot); else append.
    if (col < 0) {
      for (var c = 1; c < data[headerRow].length; c++) {
        if (String(data[headerRow][c]).trim() === "") {
          col = c;
          break;
        }
      }
    }
    if (col < 0) col = data[headerRow].length;

    // Write the date into the header row.
    sheet.getRange(headerRow + 1, col + 1).setValue(safe(body.date));

    // Walk the block's rows until the next block header (a row with date cells).
    // Track the per-session meta rows (Note / Mood / Time / Avg HR) as we go.
    var written = [];
    // MUST list every label metaKind() can return (incl. the cardio rows), else a
    // re-sync of an existing cardio block leaves target=undefined → getRange(NaN…),
    // which the Apps Script bridge casts to row 0 → "start row of range too small".
    var metaRow = {
      Note: -1, Mood: -1, Time: -1, "Time of day": -1, "Avg HR": -1,
      Distance: -1, Pace: -1, Speed: -1, Route: -1, Id: -1,
    };
    var lastBlockRow = headerRow; // last row belonging to this block
    var lastExerciseRow = headerRow; // last exercise (non-meta) row — new exercise rows go after it
    var doneNames = {};
    for (var rr = headerRow + 1; rr < data.length; rr++) {
      if (rowHasDate(data[rr])) break; // reached the next day-block header
      var label = String(data[rr][0]).trim();
      // Only a labelled row extends the block. A trailing blank row is the SPACER
      // that separates this block from the next — if it counted as block content,
      // self-healed meta rows would be inserted BELOW it, stranding the separator
      // mid-block and welding the two splits together.
      if (label) lastBlockRow = rr;
      var kind = metaKind(label);
      if (kind) {
        if (metaRow[kind] < 0) metaRow[kind] = rr;
        continue;
      }
      if (!label) continue;
      lastExerciseRow = rr;

      var matched = false;
      for (var i = 0; i < body.exercises.length; i++) {
        var ex = body.exercises[i];
        if (!doneNames[ex.name] && matchName(label, ex.name)) {
          sheet.getRange(rr + 1, col + 1).setValue(safe(ex.cell));
          written.push(ex.name);
          doneNames[ex.name] = true;
          matched = true;
          break;
        }
      }
      // Updating a session in place: an exercise removed in the edit is cleared from
      // THIS column only.
      if (!matched && updating && String(data[rr][col] == null ? "" : data[rr][col]) !== "") sheet.getRange(rr + 1, col + 1).setValue("");
    }

    // An exercise this block has no row for (added mid-session) gets its own new row
    // right after the block's last exercise row, above Note/Mood/… — so nothing logged
    // is left out of the sheet (such a session used to stay "pending" forever). Rows
    // below shift down one, so the meta-row positions are shifted with them.
    for (var ni = 0; ni < body.exercises.length; ni++) {
      var nex = body.exercises[ni];
      var nname = String(nex.name || "").trim();
      if (!nname || doneNames[nex.name]) continue;
      var at = lastExerciseRow + 1; // 0-based index of the new row
      sheet.insertRowAfter(lastExerciseRow + 1); // 1-based row of the last exercise row
      sheet.getRange(at + 1, 1).setValue(safe(nname));
      sheet.getRange(at + 1, col + 1).setValue(safe(nex.cell));
      written.push(nex.name);
      doneNames[nex.name] = true;
      for (var mk in metaRow) if (metaRow[mk] >= at) metaRow[mk]++;
      if (lastBlockRow >= at) lastBlockRow++;
      if (at > lastBlockRow) lastBlockRow = at;
      lastExerciseRow = at;
    }

    // Write each meta value into its row, appending the row at the block's end if
    // the sheet doesn't have one yet (self-healing — later sessions reuse it).
    var metas = [
      { label: "Note", value: body.note },
      { label: "Mood", value: body.mood },
      { label: "Time", value: body.time },
      { label: "Time of day", value: body.timeOfDay },
      { label: "Avg HR", value: body.hr },
      { label: "Distance", value: body.distance },
      { label: "Pace", value: body.pace },
      { label: "Speed", value: body.speed },
      { label: "Route", value: body.route },
      { label: "Id", value: body.id },
    ];
    var metaWritten = {};
    var insertAt = lastBlockRow; // 0-based; new meta rows go after here
    for (var mi = 0; mi < metas.length; mi++) {
      var m = metas[mi];
      // Empty values are skipped — except when updating in place, where an emptied
      // field (a note removed in the edit) clears its existing cell.
      if (!m.value && !(updating && metaRow[m.label] >= 0)) continue;
      var target = metaRow[m.label];
      if (target < 0) {
        sheet.insertRowAfter(insertAt + 1);
        target = insertAt + 1;
        sheet.getRange(target + 1, 1).setValue(m.label);
        insertAt = target;
      }
      sheet.getRange(target + 1, col + 1).setValue(safe(m.value || ""));
      metaWritten[m.label] = !!m.value;
    }

    if (wasDeleted) styleColumn(sheet, headerRow, insertAt, col, false);

    var skipped = [];
    for (var k = 0; k < body.exercises.length; k++) {
      if (!doneNames[body.exercises[k].name]) skipped.push(body.exercises[k].name);
    }

    return json({
      ok: true,
      column: col + 1,
      row: headerRow + 1,
      written: written,
      skipped: skipped,
      noteWritten: !!metaWritten["Note"],
      moodWritten: !!metaWritten["Mood"],
      timeWritten: !!metaWritten["Time"],
      hrWritten: !!metaWritten["Avg HR"],
      idWritten: !!body.id,
      updated: updating,
    });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// Append a brand-new day-block (header + exercises + Note/Mood/Time/Avg HR) at the
// end of a year tab. Used for Alternative/free-form sessions with no template block.
function createBlock(sheet, body) {
  var rows = [[safe(body.dayName), safe(body.date)]];
  for (var i = 0; i < body.exercises.length; i++) {
    rows.push([safe(body.exercises[i].name), safe(body.exercises[i].cell)]);
  }
  // safe() on EVERY body-derived value (defense-in-depth): the app writes numeric/
  // enum shapes here, but the endpoint is reachable by anything holding the secret.
  rows.push(["Note", safe(body.note) || ""]);
  rows.push(["Mood", safe(body.mood) || ""]);
  rows.push(["Time", safe(body.time) || ""]);
  rows.push(["Time of day", safe(body.timeOfDay) || ""]);
  rows.push(["Avg HR", safe(body.hr) || ""]);
  // Cardio-only meta rows: skip the ones that are empty for a normal session.
  ["Distance", "Pace", "Speed", "Route"].forEach(function (lbl) {
    var v = { Distance: body.distance, Pace: body.pace, Speed: body.speed, Route: body.route }[lbl];
    if (v) rows.push([lbl, safe(v)]);
  });
  if (body.id) rows.push(["Id", safe(body.id)]);

  var start = sheet.getLastRow() + 2; // leave one blank spacer row
  sheet.getRange(start, 1, rows.length, 2).setValues(rows);

  var names = body.exercises.map(function (e) { return e.name; });
  return json({
    ok: true,
    created: true,
    row: start,
    written: names,
    skipped: [],
    noteWritten: !!body.note,
    moodWritten: !!body.mood,
    timeWritten: !!body.time,
    hrWritten: !!body.hr,
    idWritten: !!body.id,
  });
}

// Find a day-block's header row (col0 == dayName). An exercise row can carry the same
// label (a custom "Running" session vs a "Running" row inside another block), so prefer
// a header that already has dates; failing that (a fresh year tab), only a row that
// STARTS a block — the first row or one after a blank spacer — counts. -1 if none.
function findHeaderRow(data, dayName) {
  var isDay = function (row) {
    return String(row[0]).trim().toLowerCase() === dayName;
  };
  for (var r = 0; r < data.length; r++) {
    if (isDay(data[r]) && rowHasDate(data[r])) return r;
  }
  for (var r2 = 0; r2 < data.length; r2++) {
    if (isDay(data[r2]) && (r2 === 0 || String(data[r2 - 1][0]).trim() === "")) return r2;
  }
  return -1;
}

// Index (into `disp`, which starts at the header row) of the block's "Id" row, or -1.
function findIdRow(disp, data, headerRow) {
  for (var r = 1; r < disp.length; r++) {
    var absRow = headerRow + r;
    if (absRow >= data.length || rowHasDate(data[absRow])) break; // next block
    if (metaKind(String(data[absRow][0]).trim()) === "Id") return r;
  }
  return -1;
}

// The column whose Id cell is this session's id (also when it's marked deleted), or -1.
function findIdColumn(disp, data, headerRow, id) {
  if (!id) return -1;
  var idRow = findIdRow(disp, data, headerRow);
  if (idRow < 0) return -1;
  for (var c = 1; c < disp[idRow].length; c++) {
    var cell = String(disp[idRow][c]).trim();
    if (cell === id || cell === "deleted " + id) return c;
  }
  return -1;
}

// Grey out (deleted) or restore one session's column within its block. Formatting only —
// every value stays, so nothing is lost if a delete was a mistake.
function styleColumn(sheet, headerRow, lastRow, col, deleted) {
  var range = sheet.getRange(headerRow + 1, col + 1, lastRow - headerRow + 1, 1);
  range.setFontColor(deleted ? "#9e9e9e" : null);
  range.setFontLine(deleted ? "line-through" : "none");
}

// Mark a session's column deleted ({deleted:true}) or restore it ({deleted:false}):
// the Id cell becomes "deleted <id>" (so imports skip it) and the column is greyed out.
// Values are never cleared.
function markDeleted(body) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(String(body.year));
  if (!sheet) return json({ ok: false, error: "no tab named " + body.year });
  var data = sheet.getDataRange().getValues();
  var headerRow = findHeaderRow(data, String(body.dayName).trim().toLowerCase());
  if (headerRow < 0) return json({ ok: false, error: "no day block '" + body.dayName + "'" });
  var disp = sheet.getRange(headerRow + 1, 1, data.length - headerRow, Math.max(1, sheet.getLastColumn())).getDisplayValues();
  var col = findIdColumn(disp, data, headerRow, body.id);
  if (col < 0) return json({ ok: true, found: false });
  var idRow = findIdRow(disp, data, headerRow);
  var lastRow = headerRow;
  for (var r = headerRow + 1; r < data.length && !rowHasDate(data[r]); r++) {
    if (String(data[r][0]).trim()) lastRow = r;
  }
  sheet.getRange(headerRow + idRow + 1, col + 1).setValue(body.deleted ? "deleted " + body.id : body.id);
  styleColumn(sheet, headerRow, lastRow, col, !!body.deleted);
  return json({ ok: true, found: true, column: col + 1 });
}

// Classify a block row label as a meta row (Note/Mood/Time/Avg HR/…), else "".
// MUST stay in sync with the label sets in src/lib/sheet.ts — a label the parser
// treats as meta but this misses would be handled as an exercise and get a
// duplicate meta row inserted.
function metaKind(label) {
  var l = String(label).trim().toLowerCase();
  if (l === "note" || l === "notes" || l === "notat" || l === "notater") return "Note";
  if (l === "mood" || l === "feeling" || l === "humør" || l === "form") return "Mood";
  if (l === "time" || l === "tid" || l === "duration" || l === "varighet") return "Time";
  if (l === "time of day" || l === "tid på dagen" || l === "klokkeslett") return "Time of day";
  if (l === "avg hr" || l === "hr" || l === "puls" || l === "avg puls" || l === "snittpuls" || l === "heart rate") return "Avg HR";
  if (l === "distance" || l === "distanse") return "Distance";
  if (l === "pace" || l === "tempo") return "Pace";
  if (l === "speed" || l === "fart") return "Speed";
  if (l === "route" || l === "rute") return "Route";
  if (l === "id") return "Id";
  return "";
}

// Upsert bodyweight-by-year into a dedicated "Bodyweight" tab (Year | Kg).
function writeBodyweight(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = "Bodyweight"; // fixed — never a caller-chosen tab
  var bw = ss.getSheetByName(name);
  if (!bw) {
    bw = ss.insertSheet(name);
    bw.getRange(1, 1, 1, 2).setValues([["Year", "Kg"]]);
  }
  var vals = bw.getDataRange().getValues();
  var rowByYear = {};
  for (var r = 1; r < vals.length; r++) {
    var y = String(vals[r][0]).trim();
    if (y) rowByYear[y] = r + 1; // 1-based sheet row
  }
  var entries = body.entries || [];
  var count = 0;
  for (var i = 0; i < entries.length; i++) {
    // Only a 4-digit year and a sane weight — nothing else reaches a cell (no formulas).
    var year = String(entries[i].year);
    var kg = Number(entries[i].kg);
    if (!/^\d{4}$/.test(year) || !(kg > 0 && kg < 500)) continue;
    if (rowByYear[year]) {
      bw.getRange(rowByYear[year], 2).setValue(kg);
    } else {
      var nr = bw.getLastRow() + 1;
      bw.getRange(nr, 1).setValue(Number(year));
      bw.getRange(nr, 2).setValue(kg);
      rowByYear[year] = nr;
    }
    count++;
  }
  return json({ ok: true, bodyweight: true, count: count });
}

// Upsert the user's profile (age / sex) into a dedicated "Profile" tab (Key | Value),
// so a reinstall can pull it back like bodyweight. Mirrors writeBodyweight.
function writeProfile(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = "Profile"; // fixed — never a caller-chosen tab
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, 2).setValues([["Key", "Value"]]);
  }
  var vals = sh.getDataRange().getValues();
  var rowByKey = {};
  for (var r = 1; r < vals.length; r++) {
    var k = String(vals[r][0]).trim().toLowerCase();
    if (k) rowByKey[k] = r + 1; // 1-based sheet row
  }
  var entries = [];
  // Validated values only (a number, a known word) — nothing that could run as a formula.
  var age = Number(body.age);
  if (body.age != null && body.age !== "" && age > 0 && age < 130) entries.push(["Age", age]);
  var sex = String(body.sex || "").toLowerCase();
  if (sex === "male" || sex === "female") entries.push(["Sex", sex]);
  for (var i = 0; i < entries.length; i++) {
    var label = entries[i][0];
    var key = label.toLowerCase();
    if (rowByKey[key]) {
      sh.getRange(rowByKey[key], 2).setValue(entries[i][1]);
    } else {
      var nr = sh.getLastRow() + 1;
      sh.getRange(nr, 1).setValue(label);
      sh.getRange(nr, 2).setValue(entries[i][1]);
      rowByKey[key] = nr;
    }
  }
  return json({ ok: true, profile: true, count: entries.length });
}

// ---------------------------------------------------------------------------
// Read-only summaries (action "summary" / "liftSummary") — consumed by the
// Home Assistant voice assistant. One getDisplayValues pull per tab (current +
// previous year), everything computed in-script; nothing is written.
// ---------------------------------------------------------------------------

// Headline lifts + alias sets (mirrors the app's exercise library). Matching is
// EXACT on the scheme-stripped lowercased row label — same convention as
// matchName — so "Romanian Deadlift" never counts as a deadlift.
var KEY_LIFTS = {
  deadlift: ["deadlift", "conventional deadlift", "markløft", "mark", "bb deadlift"],
  squat: ["squat", "back squat", "barbell squat", "knebøy", "high bar squat", "low bar squat"],
  bench: ["bench press", "bench", "benkpress", "flat bench", "barbell bench press", "bb bench"],
  ohp: ["overhead press", "ohp", "military press", "militarypress", "military", "standing press", "strict press"],
};

// Bump when the summary logic changes — echoed in the response so a deploy can
// be verified against the repo (Apps Script pastes have gone stale before).
var SUMMARY_V = 4;

// action:"summary" → last workout, this-ISO-week count, next split due, per-day
// stats, and last/best top set for the four headline lifts.
// body.debug:true adds scan internals (counts + row names seen) for remote
// troubleshooting without exposing any weights beyond the normal response.
function summaryAction(body) {
  var scan = scanRecentTabs();
  var today = dayStart(new Date());

  var last = null;
  for (var i = 0; i < scan.sessions.length; i++) {
    if (!last || scan.sessions[i].date > last.date) last = scan.sessions[i];
  }

  var mon = mondayOf(new Date());
  var weekWorkouts = 0;
  for (var j = 0; j < scan.sessions.length; j++) {
    if (mondayOf(scan.sessions[j].date) === mon) weekWorkouts++;
  }

  // Per day-block stats — splits and one-off cardio blocks (Running, Innebandy…)
  // alike, so "when did I last swim" is answerable too.
  var days = [];
  for (var bk in scan.blocks) {
    var b = scan.blocks[bk];
    days.push({
      dayName: b.dayName,
      lastDate: isoDate(b.lastDate),
      daysAgo: daysBetween(b.lastDate, today),
      sessions: b.count,
      split: b.splitAny,
    });
  }
  days.sort(function (a, b) { return a.lastDate < b.lastDate ? 1 : -1; });
  if (days.length > 20) days.length = 20;

  // Next split = the least-recently-done strength split in the current year tab
  // (the active rotation) — the app's "reddest" day-picker entry. Falls back to
  // the previous year's splits while a new year tab has no data yet.
  var next = null;
  for (var nk in scan.blocks) {
    var bl = scan.blocks[nk];
    if (!(scan.hasCurrentSplits ? bl.splitInCurrent : bl.splitAny)) continue;
    if (!next || bl.lastDate < next.lastDate) next = bl;
  }

  var lifts = {};
  for (var lk in KEY_LIFTS) lifts[lk] = liftStats(scan.occurrences, KEY_LIFTS[lk]);

  var resp = {
    ok: true,
    v: SUMMARY_V,
    lastWorkout: last
      ? { date: isoDate(last.date), dayName: last.dayName, daysAgo: daysBetween(last.date, today) }
      : null,
    weekWorkouts: weekWorkouts,
    nextSplit: next
      ? { dayName: next.dayName, lastDate: isoDate(next.lastDate), daysAgo: daysBetween(next.lastDate, today) }
      : null,
    days: days,
    lifts: lifts,
  };
  if (body && body.debug) {
    var seen = {};
    var names = [];
    for (var oi = 0; oi < scan.occurrences.length && names.length < 25; oi++) {
      var on = scan.occurrences[oi].name;
      if (!seen[on]) {
        seen[on] = true;
        names.push(on);
      }
    }
    resp.debug = { sessions: scan.sessions.length, occurrences: scan.occurrences.length, names: names };
    // Echo the LIVE alias table + inline match counts + function fingerprints,
    // so a drifted/shadowed deployment is directly visible in the response.
    resp.debug.keyLifts = KEY_LIFTS;
    var matches = {};
    for (var mk in KEY_LIFTS) {
      var cnt = 0;
      for (var mo = 0; mo < scan.occurrences.length; mo++) {
        if (KEY_LIFTS[mk].indexOf(scan.occurrences[mo].name) >= 0) cnt++;
      }
      matches[mk] = cnt;
    }
    resp.debug.matches = matches;
    resp.debug.fns = {
      scanTab: scanTab.toString().length,
      liftStats: liftStats.toString().length,
      normName: normName.toString().length,
    };
  }
  return json(resp);
}

// action:"liftSummary" {exercise} → last/best top set + the 3 most recent
// sessions for one exercise. A key-lift alias widens to its whole alias set
// ("bench" also matches "Bench Press" rows).
function liftSummaryAction(body) {
  var raw = String(body.exercise == null ? "" : body.exercise).trim();
  if (!raw) return json({ ok: false, error: "missing exercise" });
  var name = normName(stripScheme(raw));
  var names = [name];
  for (var key in KEY_LIFTS) {
    if (KEY_LIFTS[key].indexOf(name) >= 0) { names = KEY_LIFTS[key]; break; }
  }

  var occs = [];
  var all = scanRecentTabs().occurrences;
  for (var i = 0; i < all.length; i++) {
    if (names.indexOf(all[i].name) >= 0) occs.push(all[i]);
  }
  if (!occs.length) return json({ ok: true, exercise: raw, found: false });

  occs.sort(function (a, b) { return b.date - a.date; });
  var best = null;
  for (var j = 0; j < occs.length; j++) {
    if (best == null || occs[j].topKg > best) best = occs[j].topKg;
  }
  var recent = [];
  for (var r = 0; r < occs.length && recent.length < 3; r++) {
    recent.push({ date: isoDate(occs[r].date), topKg: occs[r].topKg });
  }
  return json({
    ok: true,
    exercise: raw,
    found: true,
    lastKg: occs[0].topKg,
    lastDate: isoDate(occs[0].date),
    bestKg: best,
    sessions: recent,
  });
}

// Most recent + best top set among occurrences matching one of `names`.
function liftStats(occurrences, names) {
  var last = null;
  var best = null;
  for (var i = 0; i < occurrences.length; i++) {
    var o = occurrences[i];
    if (names.indexOf(o.name) < 0) continue;
    if (best == null || o.topKg > best) best = o.topKg;
    if (!last || o.date > last.date) last = o;
  }
  return last ? { lastKg: last.topKg, lastDate: isoDate(last.date), bestKg: best } : null;
}

// Scan the current + previous year tabs (one getDisplayValues each) into:
//   sessions:    every dated block column   → { date, dayName }
//   occurrences: every filled exercise cell → { name, date, topKg }
//   blocks:      per day-block name         → { dayName, lastDate, count, splitAny, splitInCurrent }
// A "split" block has at least one scheme-prefixed row ("3x5 …") — template
// splits always do, createBlock cardio blocks never do. Future dates (sheet
// year typos) are dropped, like the app's importer.
function scanRecentTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var year = new Date().getFullYear();
  var out = { sessions: [], occurrences: [], blocks: {}, hasCurrentSplits: false };
  [year - 1, year].forEach(function (y) {
    var sh = ss.getSheetByName(String(y));
    if (sh) scanTab(sh.getDataRange().getDisplayValues(), y === year, out);
  });
  for (var k in out.blocks) {
    if (out.blocks[k].splitInCurrent) out.hasCurrentSplits = true;
  }
  return out;
}

function scanTab(disp, isCurrentYear, out) {
  var today = dayStart(new Date());
  var r = 0;
  while (r < disp.length) {
    var hdr = dateCells(disp[r]);
    if (!hdr.length) {
      r++;
      continue;
    }
    // Day name = label cells before the first date, minus "Dag N" (as sheet.ts).
    var firstCol = hdr[0].col;
    var parts = [];
    for (var c = 0; c < firstCol; c++) {
      var t = String(disp[r][c]).trim();
      if (t && !/^dag\s*\d+$/i.test(t)) parts.push(t);
    }
    var dayName = parts.join(" ") || "Workout";
    var dates = [];
    for (var h = 0; h < hdr.length; h++) {
      if (dayStart(hdr[h].date) <= today) dates.push(hdr[h]);
    }

    // Walk the block's rows until the next header (or EOF).
    var blockHasScheme = false;
    var rr = r + 1;
    for (; rr < disp.length; rr++) {
      if (dateCells(disp[rr]).length) break;
      var label = String(disp[rr][0]).trim();
      var name = stripScheme(label);
      if (label && name !== label) blockHasScheme = true; // had a "3x8 " prefix
      if (!name && firstCol >= 2) name = String(disp[rr][1]).trim(); // 2018-19 two-col layout
      name = normName(name);
      if (!name || metaKind(name)) continue;
      for (var d = 0; d < dates.length; d++) {
        var kg = topSetKg(disp[rr][dates[d].col]);
        if (kg != null) out.occurrences.push({ name: name, date: dates[d].date, topKg: kg });
      }
    }

    if (dates.length) {
      for (var s = 0; s < dates.length; s++) {
        out.sessions.push({ date: dates[s].date, dayName: dayName });
      }
      var bk = dayName.toLowerCase();
      var blk = out.blocks[bk];
      if (!blk) {
        blk = out.blocks[bk] = { dayName: dayName, lastDate: null, count: 0, splitAny: false, splitInCurrent: false };
      }
      blk.count += dates.length;
      for (var s2 = 0; s2 < dates.length; s2++) {
        if (!blk.lastDate || dates[s2].date > blk.lastDate) blk.lastDate = dates[s2].date;
      }
      if (blockHasScheme) {
        blk.splitAny = true;
        if (isCurrentYear) blk.splitInCurrent = true;
      }
    }
    r = rr;
  }
}

// Heaviest set in a cell like "72,5-70-70" / "80(6)-75(8)" / "110x3".
// Norwegian decimal commas; "(30)" (reps-only, bodyweight) has no weight;
// "x" = skipped session. The 500 kg cap mirrors the app's typo guard.
function topSetKg(cell) {
  var t = String(cell == null ? "" : cell).trim();
  if (!t || /^x+$/i.test(t)) return null;
  t = t.replace(/\(\d+\s*[xX]\s*\d+\)/, " "); // whole-cell "(3x8)" rep override
  var toks = t.split("-");
  var best = null;
  for (var i = 0; i < toks.length; i++) {
    var head = toks[i].split("(")[0].replace(",", ".");
    var m = head.match(/\d+(?:\.\d+)?/);
    if (!m) continue;
    var kg = parseFloat(m[0]);
    if (kg > 0 && kg <= 500 && (best == null || kg > best)) best = kg;
  }
  return best;
}

// Every parseable "dd.mm.yy" date cell in a row (col 1+) → [{ col, date }].
function dateCells(row) {
  var out = [];
  for (var c = 1; c < row.length; c++) {
    var d = cellDate(row[c]);
    if (d) out.push({ col: c, date: d });
  }
  return out;
}

// Parse a "dd.mm.yy(yy)" display cell (tolerating trailing text) to a Date.
function cellDate(v) {
  var m = String(v == null ? "" : v).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return null;
  var d = +m[1], mo = +m[2], y = +m[3];
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  var dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null; // 31.02 etc.
  return dt;
}

// Strip a leading "3x8 " scheme from a row label. Zero-width chars are removed
// first — hand-typed labels can hide them, and they'd both break the scheme
// match and survive trim(). Accepts × as well as x ("3×5").
function stripScheme(label) {
  return String(label)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/^\s*\d+\s*[xX×]\s*(\d+|Max|max|MAX)\b\s*/, "")
    .trim();
}

// Normalize a name for matching: zero-width chars out, whitespace runs
// collapsed to one space, lowercased. Hand-filled sheets need the tolerance.
function normName(s) {
  return String(s)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function dayStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Midnight of the ISO week's Monday — two dates in the same ISO week share it.
function mondayOf(d) {
  var t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return t.getTime();
}

function daysBetween(d, todayMs) {
  return Math.round((todayMs - dayStart(d)) / 86400000);
}

function isoDate(d) {
  var mo = d.getMonth() + 1;
  var da = d.getDate();
  return d.getFullYear() + "-" + (mo < 10 ? "0" : "") + mo + "-" + (da < 10 ? "0" : "") + da;
}

// Normalize a "dd.mm.yy(yy)" cell (string or Date) to "d.m.yy" for comparison.
function normDate(v) {
  if (v instanceof Date) {
    return v.getDate() + "." + (v.getMonth() + 1) + "." + String(v.getFullYear()).slice(2);
  }
  var m = String(v).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return "";
  return +m[1] + "." + +m[2] + "." + String(m[3]).slice(-2);
}

// Session details that must also match before a same-date column is reused: two
// same-day cardio sessions have no exercise cells to tell them apart, so the second
// one used to overwrite the first's note/distance/route. (Time-like rows are left
// out — Sheets may reformat them, which would break a genuine retry.)
var COMPARED_META = { Note: "note", Mood: "mood", "Avg HR": "hr", Distance: "distance", Route: "route" };

// "9:05" / "09:05" / "09:05:00" → "9:05" (the start-time comparison in columnCompatible).
function hhmm(v) {
  var m = String(v).trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? +m[1] + ":" + m[2] : String(v).trim();
}

// A same-date column is "ours to reuse" (a retry) only when every exercise cell
// we'd write into it — and every compared session detail above — is currently
// empty or already holds exactly our value.
function columnCompatible(disp, data, headerRow, col, exercises, body) {
  for (var r = 1; r < disp.length; r++) {
    var absRow = headerRow + r;
    if (absRow >= data.length || rowHasDate(data[absRow])) break; // next block
    var label = String(data[absRow][0]).trim();
    if (!label) continue;
    var kind = metaKind(label);
    if (kind) {
      var existing = String(disp[r][col] == null ? "" : disp[r][col]).trim();
      // A column that already carries ANOTHER session's Id is never ours.
      if (kind === "Id") {
        var own = body && body.id;
        if (existing !== "" && (!own || (existing !== own && existing !== "deleted " + own))) return false;
        continue;
      }
      // Different start times = different sessions (compared as H:MM, since Sheets may
      // show "10:08" as "10:08:00"). Before this, a same-day session with no exercise
      // cells in common was merged into another session's column and overwrote its
      // Time / Time of day (Legs 25.09, 2026-09-27).
      if (kind === "Time of day") {
        var inTod = body && body.timeOfDay;
        if (inTod && existing !== "" && hhmm(existing) !== hhmm(inTod)) return false;
        continue;
      }
      var field = COMPARED_META[kind];
      var incoming = field && body ? body[field] : null;
      if (incoming != null && incoming !== "" && existing !== "" && existing !== String(incoming).trim()) return false;
      continue;
    }
    for (var i = 0; i < exercises.length; i++) {
      if (matchName(label, exercises[i].name)) {
        var cur = String(disp[r][col] == null ? "" : disp[r][col]).trim();
        if (cur !== "" && cur !== String(exercises[i].cell).trim()) return false;
      }
    }
  }
  return true;
}

// Neutralize spreadsheet formula injection: a value starting with = + - @ would
// execute as a formula when the sheet is opened. Prefix with ' (renders the same).
function safe(v) {
  var s = v == null ? "" : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// Does a row look like a day-block header (contains a dd.mm.yy date)?
function rowHasDate(row) {
  for (var c = 1; c < Math.min(row.length, 8); c++) {
    if (/^\s*\d{1,2}\.\d{1,2}\.\d{2,4}/.test(String(row[c]).trim())) return true;
  }
  return false;
}

// Match an app exercise name to a sheet row label (strip the leading "3x8 "
// scheme, tolerate zero-width chars / odd whitespace via normName).
function matchName(rowLabel, exName) {
  return normName(stripScheme(rowLabel)) === normName(exName);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
