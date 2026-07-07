// Settings: rest-timer default, weight increment, HR connection, Google Sheets
// write-back sync, and data backup/reset.
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { db, getSetting, setSetting } from "../db";
import { saveFile } from "../lib/download";
import { hrAvailable } from "../lib/hr";
import { overlayHasPermission, overlayRequestPermission } from "../lib/overlay";
import { notificationsSupported, requestNotifications } from "../lib/notify";
import { importFromSheet, pendingCount, syncEnabled, syncPending, testSync } from "../lib/sheetSync";
import type { BwEntry } from "../lib/standards";
import { checkAndApplyUpdate, currentVersion, updatesSupported } from "../lib/update";
import { applyBackup, exportXlsx, importXlsx, type ImportedBackup } from "../lib/workbook";

type Props = {
  restDefaultSec: number;
  setRestDefaultSec: (v: number) => void;
  weightStep: number;
  setWeightStep: (v: number) => void;
  daysPerWeek: number;
  setDaysPerWeek: (v: number) => void;
  bodyweightKg: number;
  setBodyweightKg: (v: number) => void;
  age: number;
  setAge: (v: number) => void;
  bwHistory: BwEntry[];
  setBwHistory: (v: BwEntry[]) => void;
  hrLowThreshold: number;
  setHrLowThreshold: (v: number) => void;
  hr: { bpm: number | null; connected: boolean; connect: () => void; disconnect: () => void };
  onImported: () => void;
  onExport: () => void;
  onReset: () => void;
  floatMode: "pip" | "overlay" | "off";
  setFloatMode: (v: "pip" | "overlay" | "off") => void;
  floatSizeSp: number;
  setFloatSizeSp: (v: number) => void;
};

const SHEET_URL = "https://docs.google.com/spreadsheets/d/REDACTED_SHEET_ID/edit";

export function Settings({
  restDefaultSec,
  setRestDefaultSec,
  weightStep,
  setWeightStep,
  daysPerWeek,
  setDaysPerWeek,
  bodyweightKg,
  setBodyweightKg,
  age,
  setAge,
  bwHistory,
  setBwHistory,
  hrLowThreshold,
  setHrLowThreshold,
  hr,
  onImported,
  onExport,
  onReset,
  floatMode,
  setFloatMode,
  floatSizeSp,
  setFloatSizeSp,
}: Props) {
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState<string>("");
  const [reminders, setReminders] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [updateMsg, setUpdateMsg] = useState("");
  const [updating, setUpdating] = useState(false);
  const [autoEndLeave, setAutoEndLeave] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");
  const [syncOn, setSyncOn] = useState(false);
  const [syncUrl, setSyncUrl] = useState("");
  const [syncSecret, setSyncSecret] = useState("");
  const native = Capacitor.isNativePlatform();

  useEffect(() => {
    getSetting<boolean>("remindersEnabled", false).then(setReminders);
    getSetting<boolean>("autoEndOnLeave", false).then(setAutoEndLeave);
    syncEnabled().then(setSyncOn);
    getSetting<string>("sheetSyncUrl", "").then(setSyncUrl);
    getSetting<string>("sheetSyncSecret", "").then(setSyncSecret);
    pendingCount().then(setPending);
    currentVersion().then(setAppVersion);
  }, []);

  const [floatMsg, setFloatMsg] = useState("");
  const chooseFloat = async (m: "pip" | "overlay" | "off") => {
    setFloatMode(m);
    setFloatMsg("");
    if (m === "overlay" && native) {
      if (!(await overlayHasPermission())) {
        setFloatMsg("Grant “Display over other apps”, then come back.");
        await overlayRequestPermission();
      }
    }
  };

  const toggleSync = () => {
    const v = !syncOn;
    setSyncOn(v);
    setSetting("syncEnabled", v);
    if (v) pendingCount().then(setPending);
  };
  const saveSyncUrl = (v: string) => {
    setSyncUrl(v);
    setSetting("sheetSyncUrl", v.trim());
  };
  const saveSyncSecret = (v: string) => {
    setSyncSecret(v);
    setSetting("sheetSyncSecret", v.trim());
  };

  const toggleAutoEndLeave = () => {
    const v = !autoEndLeave;
    setAutoEndLeave(v);
    setSetting("autoEndOnLeave", v);
  };

  const doUpdate = async () => {
    setUpdating(true);
    setUpdateMsg("Checking…");
    const r = await checkAndApplyUpdate();
    setUpdateMsg(r.message);
    setUpdating(false);
    if (r.status !== "updated") currentVersion().then(setAppVersion);
  };

  const toggleReminders = async () => {
    if (reminders) {
      setReminders(false);
      setSetting("remindersEnabled", false);
      return;
    }
    const granted = await requestNotifications();
    if (granted) {
      setReminders(true);
      setSetting("remindersEnabled", true);
    } else {
      alert("Notifications are blocked. Enable them for this site in your browser settings, then try again.");
    }
  };

  const doTest = async () => {
    setStatus("Testing…");
    const r = await testSync();
    setStatus(r.ok ? "✓ Connected to your sheet script." : `✗ ${r.error ?? "failed"}`);
  };
  const doSyncNow = async () => {
    setStatus("Syncing…");
    const { done, failed } = await syncPending();
    setPending(await pendingCount());
    setStatus(`Synced ${done}${failed ? `, ${failed} failed` : ""}.`);
  };

  const doImport = async () => {
    setStatus("Importing from sheet…");
    const { added, bwYears, error } = await importFromSheet();
    if (error) {
      setStatus(`Import failed: ${error}`);
      return;
    }
    const bw = bwYears ? ` · ${bwYears} bodyweight year${bwYears === 1 ? "" : "s"}` : "";
    setStatus((added ? `Imported ${added} workout${added === 1 ? "" : "s"}` : "Workouts up to date") + bw + ".");
    if (bwYears) onImported();
  };

  const doExportXlsx = async () => {
    setBackupMsg("Building workbook…");
    try {
      const workouts = await db.workouts.toArray();
      const blob = await exportXlsx(workouts, bwHistory);
      await saveFile(`gym-backup-${new Date().toISOString().slice(0, 10)}.xlsx`, blob);
      setBackupMsg(`Backed up ${workouts.length} workouts.`);
    } catch (e) {
      setBackupMsg(`Export failed: ${(e as Error).message}`);
    }
  };

  const doRestore = async (file: File) => {
    setBackupMsg("Restoring…");
    try {
      const buf = await file.arrayBuffer();
      let imported: ImportedBackup;
      if (file.name.toLowerCase().endsWith(".json")) {
        const j = JSON.parse(new TextDecoder().decode(buf)) as ImportedBackup;
        imported = { workouts: j.workouts ?? [], bwHistory: j.bwHistory };
      } else {
        imported = await importXlsx(buf);
      }
      const { added, bwYears } = await applyBackup(imported);
      const bw = bwYears ? ` · ${bwYears} bodyweight year${bwYears === 1 ? "" : "s"}` : "";
      setBackupMsg((added ? `Restored ${added} workout${added === 1 ? "" : "s"}` : "Nothing new to restore") + bw + ".");
      if (bwYears) onImported();
    } catch (e) {
      setBackupMsg(`Restore failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="pad settings">
      <h2>Settings</h2>

      <details className="settings-group" open>
        <summary>Workout</summary>

        <div className="setting">
          <label>Default rest timer</label>
          <div className="seg">
            {[60, 90, 120, 150, 180].map((s) => (
              <button key={s} className={restDefaultSec === s ? "active" : ""} onClick={() => setRestDefaultSec(s)}>
                {s}s
              </button>
            ))}
          </div>
        </div>

        <div className="setting">
          <label>Weight step (± buttons)</label>
          <div className="seg">
            {[1.25, 2.5, 5].map((s) => (
              <button key={s} className={weightStep === s ? "active" : ""} onClick={() => setWeightStep(s)}>
                {String(s).replace(".", ",")} kg
              </button>
            ))}
          </div>
        </div>

        <div className="setting">
          <label>Weekly goal (workouts / week)</label>
          <div className="seg">
            {[3, 4, 5, 6].map((s) => (
              <button key={s} className={daysPerWeek === s ? "active" : ""} onClick={() => setDaysPerWeek(s)}>
                {s}×
              </button>
            ))}
          </div>
          <p className="muted tiny">Colors the “days since last workout” (green/orange/red) and drives reminders.</p>
        </div>

        {native && (
          <div className="setting">
            <label>Floating timer (when you leave the app mid-workout)</label>
            <div className="seg">
              {(["pip", "overlay", "off"] as const).map((m) => (
                <button key={m} className={floatMode === m ? "active" : ""} onClick={() => chooseFloat(m)}>
                  {m === "pip" ? "PiP" : m === "overlay" ? "Bubble" : "Off"}
                </button>
              ))}
            </div>
            {floatMode === "overlay" && (
              <div className="row" style={{ marginTop: 8 }}>
                <span className="muted tiny">Size</span>
                {[16, 22, 30].map((s, i) => (
                  <button key={s} className={`mini ${floatSizeSp === s ? "active" : ""}`} onClick={() => setFloatSizeSp(s)}>
                    {["S", "M", "L"][i]}
                  </button>
                ))}
              </div>
            )}
            {floatMsg && <p className="muted tiny">{floatMsg}</p>}
            <p className="muted tiny">
              {floatMode === "overlay"
                ? "A small draggable timer that floats over other apps — drag to move (position remembered), tap it to jump back. Needs “Display over other apps”."
                : floatMode === "pip"
                  ? "Android Picture-in-Picture — no extra permission, but its size is fixed by the OS."
                  : "No floating timer; the rest-over notification (with sound) still fires in the background."}
            </p>
          </div>
        )}
      </details>

      <details className="settings-group">
        <summary>Heart rate &amp; auto-end</summary>

        <div className="setting">
          <label>Heart rate</label>
          {!hrAvailable() ? (
            <p className="muted tiny">
              Web Bluetooth isn't available in this browser. Use Chrome on Android over HTTPS. Pair your Powerbeats Pro 2
              (enable HR in the Beats app) or a BLE chest strap through this app — not via the phone's Bluetooth settings.
            </p>
          ) : hr.connected ? (
            <div className="row">
              <span className="ok">Connected · {hr.bpm ?? "…"} bpm</span>
              <button className="mini" onClick={hr.disconnect}>
                Disconnect
              </button>
            </div>
          ) : (
            <button className="mini" onClick={hr.connect}>
              Connect HR device
            </button>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <span className="muted tiny">Auto-end if HR stays below</span>
            <input
              type="text"
              inputMode="numeric"
              className="bw-input"
              value={hrLowThreshold || ""}
              placeholder="bpm"
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setHrLowThreshold(Number.isFinite(n) ? n : 0);
              }}
            />
            <span className="muted tiny">bpm for 10 min</span>
          </div>
          <p className="muted tiny">
            While HR is connected: if it stays below this for 10 min, the app asks if you're still working out and
            auto-ends after 5 more min with no reply. Set to 0 to disable.
          </p>
        </div>

        {native && (
          <div className="setting">
            <label>Auto-end when I leave</label>
            <button className={`mini ${autoEndLeave ? "active" : ""}`} onClick={toggleAutoEndLeave}>
              {autoEndLeave ? "On — tap to disable" : "Enable"}
            </button>
            <p className="muted tiny">
              The app remembers where you are when a workout starts. If you move ~100 m away for 5 min while it's
              running, the session auto-saves. Alternative sessions (e.g. a run) are excluded. Uses a background
              location service while you train — grant location “Allow all the time”.
            </p>
          </div>
        )}
      </details>

      <details className="settings-group">
        <summary>Body &amp; strength</summary>

        <div className="setting">
          <label>Body profile (for strength ratings)</label>
          <div className="row">
            <input
              type="text"
              inputMode="decimal"
              className="bw-input"
              value={bodyweightKg || ""}
              placeholder="kg"
              onChange={(e) => {
                const n = parseFloat(e.target.value.replace(",", "."));
                setBodyweightKg(Number.isFinite(n) ? n : 0);
              }}
            />
            <span className="muted">kg</span>
            <input
              type="text"
              inputMode="numeric"
              className="bw-input"
              value={age || ""}
              placeholder="age"
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setAge(Number.isFinite(n) ? n : 0);
              }}
            />
            <span className="muted">yrs</span>
          </div>
          <p className="muted tiny">
            Rates your key lifts against strength standards, adjusted for your bodyweight (allometric) and age.
          </p>
        </div>

        <div className="setting">
          <label>Bodyweight by year</label>
          <p className="muted tiny">
            Old records are rated against what you weighed back then. Add past bodyweights; your current weight above
            covers this year onward. Synced to the sheet's “Bodyweight” tab.
          </p>
          {bwHistory.map((e, i) => (
            <div className="row" key={i} style={{ marginTop: 8 }}>
              <input
                type="text"
                inputMode="numeric"
                className="bw-input"
                value={e.year || ""}
                placeholder="year"
                onChange={(ev) => {
                  const y = parseInt(ev.target.value, 10);
                  setBwHistory(bwHistory.map((x, idx) => (idx === i ? { ...x, year: Number.isFinite(y) ? y : 0 } : x)));
                }}
              />
              <span className="muted">→</span>
              <input
                type="text"
                inputMode="decimal"
                className="bw-input"
                value={e.kg || ""}
                placeholder="kg"
                onChange={(ev) => {
                  const k = parseFloat(ev.target.value.replace(",", "."));
                  setBwHistory(bwHistory.map((x, idx) => (idx === i ? { ...x, kg: Number.isFinite(k) ? k : 0 } : x)));
                }}
              />
              <span className="muted">kg</span>
              <button className="mini danger" onClick={() => setBwHistory(bwHistory.filter((_, idx) => idx !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button
            className="mini"
            style={{ marginTop: 8 }}
            onClick={() => setBwHistory([...bwHistory, { year: new Date().getFullYear() - 1, kg: 0 }])}
          >
            ＋ Add year
          </button>
        </div>
      </details>

      <details className="settings-group">
        <summary>Backup &amp; data</summary>

        <div className="setting">
          <label>Backup</label>
          <p className="muted tiny">
            Your data lives on this device. Back it up to an Excel file — opens in Excel/Sheets, keep it anywhere (Drive,
            Files, wherever). Restoring only adds what's missing; it never overwrites or deletes.
          </p>
          <div className="row">
            <button className="mini" onClick={doExportXlsx}>
              Export backup (.xlsx)
            </button>
            <label className="mini linkbtn" style={{ cursor: "pointer" }}>
              Restore from file
              <input
                type="file"
                accept=".xlsx,.json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) doRestore(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {backupMsg && <p className="muted tiny">{backupMsg}</p>}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="mini" onClick={onExport}>
              Export (JSON)
            </button>
            <button className="mini danger" onClick={onReset}>
              Reset app data
            </button>
          </div>
        </div>
      </details>

      <details className="settings-group">
        <summary>Google Sheets sync (optional)</summary>

        <div className="setting">
          <label>Sync finished workouts to a Google Sheet</label>
          <button className={`mini ${syncOn ? "active" : ""}`} onClick={toggleSync}>
            {syncOn ? "On — tap to disable" : "Enable"}
          </button>
          <p className="muted tiny">
            Optional. When on, finished workouts (sets, note, mood, time, avg HR, run stats) are written back to a Google
            Sheet via a small Apps Script. Off by default — the app is fully usable with local + file backup.
          </p>

          {syncOn && (
            <>
              <input
                type="text"
                className="full"
                style={{ marginTop: 8 }}
                placeholder="Apps Script Web App URL (…/exec)"
                value={syncUrl}
                onChange={(e) => saveSyncUrl(e.target.value)}
              />
              <input
                type="text"
                className="full"
                placeholder="Shared secret"
                value={syncSecret}
                onChange={(e) => saveSyncSecret(e.target.value)}
              />
              <div className="row">
                <button className="mini" onClick={doTest}>
                  Test connection
                </button>
                <button className="mini" onClick={doSyncNow}>
                  Sync now{pending ? ` (${pending} pending)` : ""}
                </button>
                <button className="mini" onClick={doImport}>
                  Import from sheet ↓
                </button>
                <a className="mini linkbtn" href={SHEET_URL} target="_blank" rel="noopener noreferrer">
                  Open sheet ↗
                </a>
              </div>
              {status && <p className="muted tiny">{status}</p>}
            </>
          )}
        </div>
      </details>

      <details className="settings-group">
        <summary>Reminders &amp; updates</summary>

        <div className="setting">
          <label>Workout reminders</label>
          {!notificationsSupported() ? (
            <p className="muted tiny">Notifications aren't supported in this browser.</p>
          ) : (
            <button className={`mini ${reminders ? "active" : ""}`} onClick={toggleReminders}>
              {reminders ? "On — tap to disable" : "Enable reminders"}
            </button>
          )}
          <p className="muted tiny">
            Nudges you to train when you're behind your goal. Fires when you open the app.
          </p>
        </div>

        <div className="setting">
          <label>App update</label>
          {updatesSupported() ? (
            <>
              <div className="row">
                <button className="mini" onClick={doUpdate} disabled={updating}>
                  {updating ? "Updating…" : "Check for updates"}
                </button>
                <span className="muted tiny">
                  {appVersion ? (appVersion.includes("+") ? `v${appVersion.split("+")[0]} · ${appVersion.split("+")[1]}` : appVersion) : "…"}
                </span>
              </div>
              {updateMsg && <p className="muted tiny">{updateMsg}</p>}
              <p className="muted tiny">
                Fetches the latest version over-the-air and reloads — no reinstall. (New device features occasionally
                still need a fresh APK.)
              </p>
            </>
          ) : (
            <p className="muted tiny">The web app updates itself automatically. This button is for the installed Android app.</p>
          )}
        </div>
      </details>
    </div>
  );
}
