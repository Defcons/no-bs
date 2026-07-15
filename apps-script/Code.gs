/**
 * Gym Tracker → Google Sheet write-back.
 *
 * Bound Apps Script Web App for the "Trening" sheet. The PWA POSTs a finished
 * workout; this script finds the matching year tab + day-block and writes a new
 * dated column in the sheet's own transposed layout.
 *
 * Setup: Extensions → Apps Script, paste this, set SECRET below, then
 * Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * Copy the /exec URL into the app (Settings → Google Sheets sync) with the same
 * SECRET.
 */

var SECRET = "CHANGE_ME"; // must match the app's "Shared secret"

function doGet() {
  return json({ ok: true, service: "gym-tracker-sync" });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return json({ ok: false, error: "bad secret" });
    if (body.ping) return json({ ok: true, ping: true });

    // Pull: return every tab's cells (as displayed) so the app can import
    // workouts that exist in the sheet but not yet on the device.
    if (body.action === "pull") {
      var out = {};
      SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sh) {
        out[sh.getName()] = sh.getDataRange().getDisplayValues();
      });
      return json({ ok: true, tabs: out });
    }

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

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(String(body.year));
    if (!sheet) return json({ ok: false, error: "no tab named " + body.year });

    var data = sheet.getDataRange().getValues();
    var dayName = String(body.dayName).trim().toLowerCase();

    // Find the day-block header row (col0 == dayName).
    var headerRow = -1;
    for (var r = 0; r < data.length; r++) {
      if (String(data[r][0]).trim().toLowerCase() === dayName) {
        headerRow = r;
        break;
      }
    }
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
    var want = normDate(body.date);
    var col = -1;
    for (var c0 = 1; c0 < disp[0].length; c0++) {
      if (want && normDate(disp[0][c0]) === want && columnCompatible(disp, data, headerRow, c0, body.exercises)) {
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
    var metaRow = { Note: -1, Mood: -1, Time: -1, "Avg HR": -1 };
    var lastBlockRow = headerRow; // last row belonging to this block
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

      for (var i = 0; i < body.exercises.length; i++) {
        var ex = body.exercises[i];
        if (!doneNames[ex.name] && matchName(label, ex.name)) {
          sheet.getRange(rr + 1, col + 1).setValue(safe(ex.cell));
          written.push(ex.name);
          doneNames[ex.name] = true;
          break;
        }
      }
    }

    // Write each meta value into its row, appending the row at the block's end if
    // the sheet doesn't have one yet (self-healing — later sessions reuse it).
    var metas = [
      { label: "Note", value: body.note },
      { label: "Mood", value: body.mood },
      { label: "Time", value: body.time },
      { label: "Avg HR", value: body.hr },
      { label: "Distance", value: body.distance },
      { label: "Pace", value: body.pace },
      { label: "Speed", value: body.speed },
      { label: "Route", value: body.route },
    ];
    var metaWritten = {};
    var insertAt = lastBlockRow; // 0-based; new meta rows go after here
    for (var mi = 0; mi < metas.length; mi++) {
      var m = metas[mi];
      if (!m.value) continue;
      var target = metaRow[m.label];
      if (target < 0) {
        sheet.insertRowAfter(insertAt + 1);
        target = insertAt + 1;
        sheet.getRange(target + 1, 1).setValue(m.label);
        insertAt = target;
      }
      sheet.getRange(target + 1, col + 1).setValue(safe(m.value));
      metaWritten[m.label] = true;
    }

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
  rows.push(["Note", safe(body.note) || ""]);
  rows.push(["Mood", body.mood || ""]);
  rows.push(["Time", body.time || ""]);
  rows.push(["Avg HR", body.hr || ""]);
  // Cardio-only meta rows: skip the ones that are empty for a normal session.
  ["Distance", "Pace", "Speed", "Route"].forEach(function (lbl) {
    var v = { Distance: body.distance, Pace: body.pace, Speed: body.speed, Route: body.route }[lbl];
    if (v) rows.push([lbl, v]);
  });

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
  });
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
  if (l === "avg hr" || l === "hr" || l === "puls" || l === "avg puls" || l === "snittpuls" || l === "heart rate") return "Avg HR";
  if (l === "distance" || l === "distanse") return "Distance";
  if (l === "pace" || l === "tempo") return "Pace";
  if (l === "speed" || l === "fart") return "Speed";
  if (l === "route" || l === "rute") return "Route";
  return "";
}

// Upsert bodyweight-by-year into a dedicated "Bodyweight" tab (Year | Kg).
function writeBodyweight(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = body.tab || "Bodyweight";
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
  for (var i = 0; i < entries.length; i++) {
    var year = String(entries[i].year);
    var kg = Number(entries[i].kg);
    if (rowByYear[year]) {
      bw.getRange(rowByYear[year], 2).setValue(kg);
    } else {
      var nr = bw.getLastRow() + 1;
      bw.getRange(nr, 1).setValue(entries[i].year);
      bw.getRange(nr, 2).setValue(kg);
      rowByYear[year] = nr;
    }
  }
  return json({ ok: true, bodyweight: true, count: entries.length });
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

// A same-date column is "ours to reuse" (a retry) only when every exercise cell
// we'd write into it is currently empty or already holds exactly our value.
function columnCompatible(disp, data, headerRow, col, exercises) {
  for (var r = 1; r < disp.length; r++) {
    var absRow = headerRow + r;
    if (absRow >= data.length || rowHasDate(data[absRow])) break; // next block
    var label = String(data[absRow][0]).trim();
    if (!label || metaKind(label)) continue;
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

// Match an app exercise name to a sheet row label (strip the leading "3x8 " scheme).
function matchName(rowLabel, exName) {
  var name = rowLabel.replace(/^\s*\d+\s*[xX]\s*(\d+|Max|max|MAX)\b\s*/, "").trim().toLowerCase();
  return name === String(exName).trim().toLowerCase();
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
