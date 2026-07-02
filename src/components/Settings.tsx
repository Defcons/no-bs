// Settings: rest-timer default, weight increment, HR connection, Google Sheets
// write-back sync, and data backup/reset.
import { useEffect, useState } from "react";
import { getSetting, setSetting } from "../db";
import { bluetoothAvailable } from "../lib/hr";
import { notificationsSupported, requestNotifications } from "../lib/notify";
import { pendingCount, syncPending, testSync } from "../lib/sheetSync";
import { DEFAULT_SYNC_SECRET, DEFAULT_SYNC_URL } from "../lib/syncConfig";

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
  hrLowThreshold: number;
  setHrLowThreshold: (v: number) => void;
  hr: { bpm: number | null; connected: boolean; connect: () => void; disconnect: () => void };
  onExport: () => void;
  onReset: () => void;
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
  hrLowThreshold,
  setHrLowThreshold,
  hr,
  onExport,
  onReset,
}: Props) {
  const [syncUrl, setSyncUrl] = useState("");
  const [syncSecret, setSyncSecret] = useState("");
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState<string>("");
  const [reminders, setReminders] = useState(false);

  useEffect(() => {
    getSetting<string>("sheetSyncUrl", "").then((v) => setSyncUrl(v || DEFAULT_SYNC_URL));
    getSetting<string>("sheetSyncSecret", "").then((v) => setSyncSecret(v || DEFAULT_SYNC_SECRET));
    getSetting<boolean>("remindersEnabled", false).then(setReminders);
    pendingCount().then(setPending);
  }, []);

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

  const saveUrl = (v: string) => {
    setSyncUrl(v);
    setSetting("sheetSyncUrl", v.trim());
  };
  const saveSecret = (v: string) => {
    setSyncSecret(v);
    setSetting("sheetSyncSecret", v.trim());
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

  return (
    <div className="pad settings">
      <h2>Settings</h2>

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
        <label>Workout reminders</label>
        {!notificationsSupported() ? (
          <p className="muted tiny">Notifications aren't supported in this browser.</p>
        ) : (
          <button className={`mini ${reminders ? "active" : ""}`} onClick={toggleReminders}>
            {reminders ? "On — tap to disable" : "Enable reminders"}
          </button>
        )}
        <p className="muted tiny">
          Nudges you to train when you're behind your goal. Fires when you open the app; a guaranteed scheduled push
          (even when the app is closed) would need a small server — ask if you want that.
        </p>
      </div>

      <div className="setting">
        <label>Heart rate</label>
        {!bluetoothAvailable() ? (
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

      <div className="setting">
        <label>Google Sheets sync</label>
        <p className="muted tiny">
          Pre-configured on every device — finished workouts are written back to your sheet automatically. Only change
          these if you re-deploy the Apps Script.
        </p>
        <input
          type="text"
          className="full"
          placeholder="Apps Script Web App URL (…/exec)"
          value={syncUrl}
          onChange={(e) => saveUrl(e.target.value)}
        />
        <input
          type="text"
          className="full"
          placeholder="Shared secret"
          value={syncSecret}
          onChange={(e) => saveSecret(e.target.value)}
        />
        <div className="row">
          <button className="mini" onClick={doTest}>
            Test connection
          </button>
          <button className="mini" onClick={doSyncNow}>
            Sync now{pending ? ` (${pending} pending)` : ""}
          </button>
        </div>
        {status && <p className="muted tiny">{status}</p>}
      </div>

      <div className="setting">
        <label>Data</label>
        <div className="row">
          <a className="mini linkbtn" href={SHEET_URL} target="_blank" rel="noopener noreferrer">
            Open Google Sheet ↗
          </a>
          <button className="mini" onClick={onExport}>
            Export backup (JSON)
          </button>
          <button className="mini danger" onClick={onReset}>
            Reset app data
          </button>
        </div>
      </div>
    </div>
  );
}
