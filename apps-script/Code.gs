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

    // First empty column in the header row (a session slot); else append at end.
    var col = -1;
    for (var c = 1; c < data[headerRow].length; c++) {
      if (String(data[headerRow][c]).trim() === "") {
        col = c;
        break;
      }
    }
    if (col < 0) col = data[headerRow].length;

    // Write the date into the header row.
    sheet.getRange(headerRow + 1, col + 1).setValue(body.date);

    // Walk the block's rows until the next block header (a row with date cells).
    var written = [];
    var noteRow = -1;
    var moodRow = -1;
    var lastBlockRow = headerRow; // last row belonging to this block
    var doneNames = {};
    for (var rr = headerRow + 1; rr < data.length; rr++) {
      if (rowHasDate(data[rr])) break; // reached the next day-block header
      lastBlockRow = rr;
      var label = String(data[rr][0]).trim();
      var low = label.toLowerCase();
      if (low === "note" || low === "notes") {
        if (noteRow < 0) noteRow = rr;
        continue;
      }
      if (low === "mood" || low === "feeling") {
        if (moodRow < 0) moodRow = rr;
        continue;
      }
      if (!label) continue;

      for (var i = 0; i < body.exercises.length; i++) {
        var ex = body.exercises[i];
        if (!doneNames[ex.name] && matchName(label, ex.name)) {
          sheet.getRange(rr + 1, col + 1).setValue(ex.cell);
          written.push(ex.name);
          doneNames[ex.name] = true;
          break;
        }
      }
    }

    var noteWritten = false;
    if (body.note && noteRow >= 0) {
      sheet.getRange(noteRow + 1, col + 1).setValue(body.note);
      noteWritten = true;
    }

    // Mood row ("before→after"). Write into the existing row, or insert one right
    // after the Note row (else at the end of the block) if the sheet has none yet.
    var moodWritten = false;
    if (body.mood) {
      if (moodRow < 0) {
        var after = noteRow >= 0 ? noteRow : lastBlockRow; // 0-based
        sheet.insertRowAfter(after + 1);
        moodRow = after + 1; // the newly inserted 0-based row index
        sheet.getRange(moodRow + 1, 1).setValue("Mood");
      }
      sheet.getRange(moodRow + 1, col + 1).setValue(body.mood);
      moodWritten = true;
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
      noteWritten: noteWritten,
      moodWritten: moodWritten,
    });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// Append a brand-new day-block (header + exercises + Note + Mood) at the end of a
// year tab. Used for Alternative/free-form sessions that have no template block.
function createBlock(sheet, body) {
  var rows = [[body.dayName, body.date]];
  for (var i = 0; i < body.exercises.length; i++) {
    rows.push([body.exercises[i].name, body.exercises[i].cell]);
  }
  rows.push(["Note", body.note || ""]);
  rows.push(["Mood", body.mood || ""]);

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
  });
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
