// Settings: rest-timer default, weight increment, HR connection, Google Sheets
// write-back sync, and data backup/reset.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  addCustomSound,
  type CustomSound,
  db,
  deleteCustomSound,
  getCustomSound,
  getSetting,
  listCustomSounds,
  setSetting,
} from "../db";
import { saveFile } from "../lib/download";
import { hrAvailable } from "../lib/hr";
import { cancelTrainingReminders, notificationsSupported, requestNotifications, scheduleTrainingReminders } from "../lib/notify";
import { importFromSheet, pendingCount, syncEnabled, syncPending, testSync } from "../lib/sheetSync";
import type { BwEntry, Sex } from "../lib/standards";
import { type WeightUnit, displayStep, fromDisplayWeight, weightStr } from "../lib/units";
import {
  BREAK_SOUNDS,
  type BreakSoundId,
  CUSTOM_PREFIX,
  customIdOf,
  decodeSound,
  isCustom,
  playBreakSound,
  playBuffer,
  playCountdownTick,
} from "../lib/sounds";
import { checkAndApplyUpdate, currentVersion, updatesSupported } from "../lib/update";
import { feedbackMailtoUrl } from "../lib/feedback";
import { applyBackup, exportXlsx, importXlsx, type ImportedBackup } from "../lib/workbook";
import { Switch } from "./Switch";
import { SoundField } from "./SoundField";
import { MoonIcon, SunIcon } from "./icons";
import { SheetsGuide } from "./SheetsGuide";

// A boolean setting: label + switch inline, description below.
function ToggleRow({
  label,
  checked,
  onChange,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="setting toggle">
      <div className="toggle-head">
        <label>{label}</label>
        <Switch checked={checked} onChange={onChange} label={label} />
      </div>
      {children}
    </div>
  );
}

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
  sex: Sex;
  setSex: (v: Sex) => void;
  units: WeightUnit;
  setUnits: (v: WeightUnit) => void;
  bwHistory: BwEntry[];
  setBwHistory: (v: BwEntry[]) => void;
  hrLowThreshold: number;
  setHrLowThreshold: (v: number) => void;
  hr: { bpm: number | null; connected: boolean; connect: () => void; disconnect: () => void };
  onImported: () => void;
  onExport: () => void;
  onReset: () => void;
  floatMode: "pip" | "off";
  setFloatMode: (v: "pip" | "off") => void;
  keepScreenOn: boolean;
  setKeepScreenOn: (v: boolean) => void;
};

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
  sex,
  setSex,
  units,
  setUnits,
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
  keepScreenOn,
  setKeepScreenOn,
}: Props) {
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState<string>("");
  const [reminders, setReminders] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [updateMsg, setUpdateMsg] = useState("");
  const [updating, setUpdating] = useState(false);
  const [autoEndLeave, setAutoEndLeave] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");
  const [showSheetsGuide, setShowSheetsGuide] = useState(false);
  const [syncOn, setSyncOn] = useState(false);
  const [syncUrl, setSyncUrl] = useState("");
  const [syncSecret, setSyncSecret] = useState("");
  const [sheetViewUrl, setSheetViewUrl] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [autoBreak, setAutoBreak] = useState(false);
  const [volUpBreak, setVolUpBreak] = useState(false);
  const [phoneVolBreak, setPhoneVolBreak] = useState(false);
  const [mediaBtnBreak, setMediaBtnBreak] = useState(false);
  // Break sound is a built-in id ("beep"…) OR "custom:<dbId>" (a user's file).
  const [breakSound, setBreakSound] = useState<string>("beep");
  const [breakCountdown, setBreakCountdown] = useState(false);
  const [includeAltWeekly, setIncludeAltWeekly] = useState(false);
  const [lowHrWarn, setLowHrWarn] = useState(false);
  const [lowHrWarnBpm, setLowHrWarnBpm] = useState(100);
  const [lowHrSound, setLowHrSound] = useState("alarm");
  const [customSounds, setCustomSounds] = useState<CustomSound[]>([]);
  const soundFileRef = useRef<HTMLInputElement>(null);
  const native = Capacitor.isNativePlatform();
  const thisYear = new Date().getFullYear();

  const refreshCustomSounds = () => listCustomSounds().then(setCustomSounds);
  const previewSound = async (v: string) => {
    if (isCustom(v)) {
      const rec = await getCustomSound(customIdOf(v));
      if (rec) playBuffer(await decodeSound(rec.blob));
    } else {
      playBreakSound(v as BreakSoundId);
    }
  };
  const chooseSound = (v: string) => {
    setBreakSound(v);
    setSetting("breakSound", v);
    previewSound(v); // immediate feedback
  };
  const onPickSoundFile = async (file: File) => {
    if (file.size > 5_000_000) {
      alert("Please choose an audio file under 5 MB.");
      return;
    }
    try {
      await decodeSound(file); // validate it's playable before storing
    } catch {
      alert("Couldn't read that audio file. Try an MP3, WAV, or OGG.");
      return;
    }
    const name = file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "My sound";
    const id = await addCustomSound(name, file);
    await refreshCustomSounds();
    chooseSound(`${CUSTOM_PREFIX}${id}`);
  };
  const deleteCurrentSound = async () => {
    if (!isCustom(breakSound)) return;
    await deleteCustomSound(customIdOf(breakSound));
    await refreshCustomSounds();
    chooseSound("beep");
  };

  useEffect(() => {
    getSetting<boolean>("remindersEnabled", false).then(setReminders);
    getSetting<boolean>("autoEndOnLeave", false).then(setAutoEndLeave);
    syncEnabled().then(setSyncOn);
    getSetting<string>("sheetSyncUrl", "").then(setSyncUrl);
    getSetting<string>("sheetSyncSecret", "").then(setSyncSecret);
    getSetting<string>("sheetViewUrl", "").then(setSheetViewUrl);
    getSetting<string>("theme", "dark").then((t) => setTheme(t === "light" ? "light" : "dark"));
    getSetting("autoBreakOnDone", false).then(setAutoBreak);
    getSetting("volumeUpBreak", false).then(setVolUpBreak);
    getSetting("phoneVolumeBreak", false).then(setPhoneVolBreak);
    getSetting("mediaBtnBreak", false).then(setMediaBtnBreak);
    getSetting<string>("breakSound", "beep").then(setBreakSound);
    getSetting("breakCountdown", false).then(setBreakCountdown);
    getSetting<boolean>("includeAltInWeekly", false).then(setIncludeAltWeekly);
    getSetting<boolean>("lowHrWarn", false).then(setLowHrWarn);
    getSetting<number>("lowHrWarnBpm", 100).then(setLowHrWarnBpm);
    getSetting<string>("lowHrSound", "alarm").then(setLowHrSound);
    refreshCustomSounds();
    pendingCount().then(setPending);
    currentVersion().then(setAppVersion);
  }, []);

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
  const saveSheetViewUrl = (v: string) => {
    setSheetViewUrl(v);
    setSetting("sheetViewUrl", v.trim());
  };

  // Prominent disclosure + affirmative consent before any location permission
  // prompt (Play best practice; kept even though we only use while-in-use
  // location via a foreground service — no ACCESS_BACKGROUND_LOCATION).
  const BG_LOCATION_DISCLOSURE =
    '"Auto-end when I leave" uses your location while a workout is running to detect when you ' +
    "leave the gym and automatically save your workout.\n\n" +
    "• Location is used only during a workout, only for this feature — a notification shows while it's active.\n" +
    "• It stays on your device and is never sent to us or shared with anyone.\n\n" +
    'Android will ask to allow location "While using the app". Enable auto-end?';
  const toggleAutoEndLeave = () => {
    if (autoEndLeave) {
      setAutoEndLeave(false);
      setSetting("autoEndOnLeave", false);
      return;
    }
    if (!confirm(BG_LOCATION_DISCLOSURE)) return; // declined the disclosure → leave it off
    setAutoEndLeave(true);
    setSetting("autoEndOnLeave", true);
  };

  const toggleAutoBreak = () => {
    const v = !autoBreak;
    setAutoBreak(v);
    setSetting("autoBreakOnDone", v);
  };
  const toggleVolUpBreak = () => {
    const v = !volUpBreak;
    setVolUpBreak(v);
    setSetting("volumeUpBreak", v);
  };
  const togglePhoneVolBreak = () => {
    const v = !phoneVolBreak;
    setPhoneVolBreak(v);
    setSetting("phoneVolumeBreak", v);
  };
  const toggleMediaBtnBreak = () => {
    const v = !mediaBtnBreak;
    setMediaBtnBreak(v);
    setSetting("mediaBtnBreak", v);
  };

  const setThemeChoice = (t: "dark" | "light") => {
    setTheme(t);
    setSetting("theme", t);
    if (t === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
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
      cancelTrainingReminders(); // drop any pre-scheduled closed-app nudges
      return;
    }
    const granted = await requestNotifications();
    if (granted) {
      setReminders(true);
      await setSetting("remindersEnabled", true);
      // Schedule right away — otherwise nothing is armed until the next app open.
      const last = await db.workouts.orderBy("date").reverse().first();
      scheduleTrainingReminders(daysPerWeek, last?.date ?? null);
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
      const blob = await exportXlsx(workouts, bwHistory, await db.templates.toArray());
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
        imported = { workouts: j.workouts ?? [], bwHistory: j.bwHistory, templates: j.templates, settings: j.settings };
      } else {
        imported = await importXlsx(buf);
      }
      const { added, bwYears, settings } = await applyBackup(imported);
      const bw = bwYears ? ` · ${bwYears} bodyweight year${bwYears === 1 ? "" : "s"}` : "";
      const set = settings ? ` · ${settings} setting${settings === 1 ? "" : "s"}` : "";
      setBackupMsg(
        (added ? `Restored ${added} workout${added === 1 ? "" : "s"}` : "Nothing new to restore") +
          bw + set + (settings ? " — reloading to apply…" : "."),
      );
      if (bwYears) onImported();
      // Preferences (theme/toggles/rest defaults) are read at mount, so reload to
      // apply them this session rather than only on the next launch.
      if (settings) setTimeout(() => location.reload(), 1500);
    } catch (e) {
      setBackupMsg(`Restore failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="pad settings">
      <h2>Settings</h2>

      <details className="settings-group" open>
        <summary>Appearance</summary>

        <div className="setting">
          <label>Theme</label>
          <div className="seg">
            {(["dark", "light"] as const).map((t) => (
              <button key={t} className={theme === t ? "active" : ""} onClick={() => setThemeChoice(t)}>
                {t === "dark" ? (
                  <>
                    <MoonIcon /> Dark
                  </>
                ) : (
                  <>
                    <SunIcon /> Light
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
      </details>

      <details className="settings-group">
        <summary>Rest timer</summary>

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
          <label>Break-over sound</label>
          <div className="row">
            <select
              value={breakSound}
              onChange={(e) => {
                if (e.target.value === "__add__") {
                  soundFileRef.current?.click(); // open the file picker
                  return;
                }
                chooseSound(e.target.value);
              }}
            >
              <optgroup label="Built-in">
                {BREAK_SOUNDS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
              {customSounds.length > 0 && (
                <optgroup label="Your sounds">
                  {customSounds.map((s) => (
                    <option key={s.id} value={`${CUSTOM_PREFIX}${s.id}`}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value="__add__">＋ Add audio file…</option>
            </select>
            <button className="mini" onClick={() => previewSound(breakSound)}>
              ▶ Preview
            </button>
            {isCustom(breakSound) && (
              <button className="mini danger" onClick={deleteCurrentSound} aria-label="Delete this sound">
                🗑
              </button>
            )}
          </div>
          <input
            ref={soundFileRef}
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickSoundFile(f);
              e.target.value = ""; // allow re-picking the same file
            }}
          />
          <p className="muted tiny">Use a built-in sound or add your own short clip (MP3/WAV/OGG, under 5 MB).</p>
        </div>

        <ToggleRow
          label="Countdown before break ends"
          checked={breakCountdown}
          onChange={(v) => {
            setBreakCountdown(v);
            setSetting("breakCountdown", v);
            if (v) playCountdownTick(false); // preview a tick
          }}
        >
          <p className="muted tiny">Faint 3-2-1 ticks in the last seconds so the end sound doesn't startle you. Off by default.</p>
        </ToggleRow>

        <ToggleRow label="Auto-start break when a set is marked done" checked={autoBreak} onChange={toggleAutoBreak}>
          <p className="muted tiny">Tap a set's number badge (✓) and the break timer starts by itself.</p>
        </ToggleRow>
      </details>

      <details className="settings-group">
        <summary>Workout</summary>

        <div className="setting">
          <label>Weight unit</label>
          <div className="seg">
            {(["kg", "lb"] as const).map((u) => (
              <button key={u} className={units === u ? "active" : ""} onClick={() => setUnits(u)}>
                {u === "kg" ? "Kilograms (kg)" : "Pounds (lb)"}
              </button>
            ))}
          </div>
          <p className="muted tiny">Weights are stored in kg and shown/entered in your unit — switching never changes your data.</p>
        </div>

        <div className="setting">
          <label>Weight step (± buttons)</label>
          <div className="seg">
            {[1.25, 2.5, 5].map((s) => (
              <button key={s} className={weightStep === s ? "active" : ""} onClick={() => setWeightStep(s)}>
                {String(displayStep(s, units)).replace(".", ",")} {units}
              </button>
            ))}
          </div>
          <p className="muted tiny">Default for all exercises — override per exercise when creating/editing a workout.</p>
        </div>

        <div className="setting">
          <label>Weekly goal (workouts / week)</label>
          <div className="seg seg-wk">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => (
              <button key={s} className={daysPerWeek === s ? "active" : ""} onClick={() => setDaysPerWeek(s)}>
                {s}×
              </button>
            ))}
          </div>
          <p className="muted tiny">Colors the “days since last workout” (green/orange/red) and drives reminders.</p>
        </div>

        <ToggleRow
          label="Count Alternative sessions in weekly total"
          checked={includeAltWeekly}
          onChange={() => {
            const v = !includeAltWeekly;
            setIncludeAltWeekly(v);
            setSetting("includeAltInWeekly", v);
          }}
        >
          <p className="muted tiny">
            Off by default — the “workouts per week” bars in Records count only your planned template workouts. Turn on
            to also include free-form Alternative sessions (runs, CrossFit, etc.).
          </p>
        </ToggleRow>

        {native && (
          <ToggleRow label="Earbud volume rocker starts the break" checked={volUpBreak} onChange={toggleVolUpBreak}>
            <p className="muted tiny">
              During a workout, press your <b>Bluetooth earbud's</b> volume rocker (either direction) to start the break —
              press again to skip/dismiss a running one. Works with the screen locked and music playing. Your{" "}
              <b>phone's</b> volume buttons keep adjusting volume as normal. Needs a current APK.
            </p>
            <p className="muted tiny">
              On the <b>extended</b> build, also turn on <b>Accessibility → NoBS break button</b> — that's what keeps the
              phone's own volume buttons working as volume while a workout runs.
            </p>
          </ToggleRow>
        )}

        {native && (
          <ToggleRow label="Phone volume buttons start the break" checked={phoneVolBreak} onChange={togglePhoneVolBreak}>
            <p className="muted tiny">
              During a workout, your <b>phone's own</b> volume buttons start/skip the break instead of changing volume.{" "}
              <b>Trade-off:</b> while this is on you can't adjust volume with the phone buttons — use your earbuds or the
              notification shade. Foreground works on any build; the <b>locked screen</b> needs the <b>extended</b> build
              with <b>Accessibility → NoBS break button</b> on. Needs a current APK.
            </p>
          </ToggleRow>
        )}

        {native && (
          <ToggleRow label="Headphone button controls the break" checked={mediaBtnBreak} onChange={toggleMediaBtnBreak}>
            <p className="muted tiny">
              During a workout, your headphone's play/pause button starts the break (press again to skip it).{" "}
              <b>Heads-up:</b> this only works when no other app holds the media button — if music is playing, Android
              sends the button to that app, not here, so it may do nothing. The volume-button option above is the
              reliable one. Needs a current APK.
            </p>
          </ToggleRow>
        )}

        {native && (
          <ToggleRow
            label="Floating timer (PiP) when you leave the app mid-workout"
            checked={floatMode === "pip"}
            onChange={(v) => setFloatMode(v ? "pip" : "off")}
          >
            <p className="muted tiny">
              {floatMode === "pip"
                ? "Android Picture-in-Picture floats a live timer + heart rate over other apps. Its size is fixed by the OS."
                : "No floating timer; the rest-over notification (with sound) still fires in the background."}
            </p>
          </ToggleRow>
        )}

        <ToggleRow label="Keep screen on" checked={keepScreenOn} onChange={setKeepScreenOn}>
          <p className="muted tiny">
            Stops the screen dimming/locking while the app is open or floating (PiP). Off by default — uses more
            battery.
          </p>
        </ToggleRow>
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

        <ToggleRow
          label="Low heart-rate warning"
          checked={lowHrWarn}
          onChange={() => {
            const v = !lowHrWarn;
            setLowHrWarn(v);
            setSetting("lowHrWarn", v);
          }}
        >
          <p className="muted tiny">
            Off by default. During a workout, once your heart rate has been above the number below, it plays a sound if
            it then drops below and stays there ~20 s (so a brief dip won't false-alarm). Re-arms once HR rises back above.
          </p>
          {lowHrWarn && (
            <>
              <div className="row" style={{ marginTop: 8 }}>
                <span className="muted tiny">Warn below</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="bw-input"
                  value={lowHrWarnBpm || ""}
                  placeholder="bpm"
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    const v = Number.isFinite(n) ? n : 0;
                    setLowHrWarnBpm(v);
                    setSetting("lowHrWarnBpm", v);
                  }}
                />
                <span className="muted tiny">bpm</span>
              </div>
              <div style={{ marginTop: 8 }}>
                <SoundField
                  value={lowHrSound}
                  onChange={(v) => {
                    setLowHrSound(v);
                    setSetting("lowHrSound", v);
                  }}
                />
              </div>
            </>
          )}
        </ToggleRow>

        {native && (
          <ToggleRow label="Auto-end when I leave" checked={autoEndLeave} onChange={toggleAutoEndLeave}>
            <p className="muted tiny">
              Off by default. When on, the app remembers where you are when a workout starts; if you move ~100 m away
              for 5 min while it's running, the session auto-saves. Alternative sessions (e.g. a run) are excluded.
              Location is used only while a workout is running (a notification shows while active) and never leaves
              your device. Grant location “While using the app” when asked.
            </p>
          </ToggleRow>
        )}
      </details>

      <details className="settings-group">
        <summary>Body &amp; strength</summary>

        <div className="setting">
          <label>Sex (for strength standards)</label>
          <div className="seg">
            {(["male", "female"] as const).map((s) => (
              <button key={s} className={sex === s ? "active" : ""} onClick={() => setSex(s)}>
                {s === "male" ? "Male" : "Female"}
              </button>
            ))}
          </div>
        </div>

        <div className="setting">
          <label>Age</label>
          <div className="row">
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
            <span className="muted">yrs · optional, age-adjusts the standards</span>
          </div>
        </div>

        <div className="setting">
          <label>Bodyweight</label>
          <p className="muted tiny">
            Rates your lifts against strength standards (adjusted for your bodyweight). Add earlier years so old PRs are
            judged against what you weighed back then.
          </p>
          <div className="row" style={{ marginTop: 8 }}>
            <span className="bw-input bw-year muted">{thisYear}</span>
            <span className="muted">→</span>
            <input
              type="text"
              inputMode="decimal"
              className="bw-input"
              value={bodyweightKg ? weightStr(bodyweightKg, units) : ""}
              placeholder={units}
              onChange={(e) => {
                const n = parseFloat(e.target.value.replace(",", "."));
                setBodyweightKg(Number.isFinite(n) ? fromDisplayWeight(n, units) : 0);
              }}
            />
            <span className="muted">{units}</span>
            <span className="tiny muted">now</span>
          </div>
          {bwHistory.map((e, i) => (
            <div className="row" key={i} style={{ marginTop: 8 }}>
              <input
                type="text"
                inputMode="numeric"
                className="bw-input bw-year"
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
                value={e.kg ? weightStr(e.kg, units) : ""}
                placeholder={units}
                onChange={(ev) => {
                  const k = parseFloat(ev.target.value.replace(",", "."));
                  const kg = Number.isFinite(k) ? fromDisplayWeight(k, units) : 0;
                  setBwHistory(bwHistory.map((x, idx) => (idx === i ? { ...x, kg } : x)));
                }}
              />
              <span className="muted">{units}</span>
              <button className="mini danger" onClick={() => setBwHistory(bwHistory.filter((_, idx) => idx !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button className="mini" style={{ marginTop: 8 }} onClick={() => setBwHistory([...bwHistory, { year: thisYear - 1, kg: 0 }])}>
            ＋ Add earlier year
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

        <ToggleRow label="Sync finished workouts to a Google Sheet" checked={syncOn} onChange={toggleSync}>
          <p className="muted tiny">
            Optional. When on, finished workouts (sets, note, mood, time, avg HR, run stats) are written back to a Google
            Sheet via a small Apps Script. Off by default — the app is fully usable with local + file backup.{" "}
            <button className="link-inline" onClick={() => setShowSheetsGuide(true)}>
              Setup guide
            </button>{" "}
            (one-time, ~5 min).
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
                type="password"
                autoComplete="off"
                className="full"
                placeholder="Shared secret"
                value={syncSecret}
                onChange={(e) => saveSyncSecret(e.target.value)}
              />
              <input
                type="text"
                className="full"
                placeholder="Your sheet URL (optional — for the 'Open sheet' link)"
                value={sheetViewUrl}
                onChange={(e) => saveSheetViewUrl(e.target.value)}
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
                {sheetViewUrl && (
                  <a className="mini linkbtn" href={sheetViewUrl} target="_blank" rel="noopener noreferrer">
                    Open sheet ↗
                  </a>
                )}
              </div>
              {status && <p className="muted tiny">{status}</p>}
            </>
          )}
        </ToggleRow>
      </details>

      <details className="settings-group">
        <summary>Reminders &amp; updates</summary>

        {!notificationsSupported() ? (
          <div className="setting">
            <label>Workout reminders</label>
            <p className="muted tiny">Notifications aren't supported in this browser.</p>
          </div>
        ) : (
          <ToggleRow label="Workout reminders" checked={reminders} onChange={toggleReminders}>
            <p className="muted tiny">Nudges you to train when you're behind your goal. Fires when you open the app.</p>
          </ToggleRow>
        )}

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

      <div className="setting settings-feedback">
        <label>Feedback &amp; bugs</label>
        <p className="muted tiny">
          Hit a bug or have an idea? Email us directly — it reaches the developer, includes your version so we can
          reproduce it, and we can actually reply and fix it (unlike a store review).
        </p>
        <div className="row">
          <a className="mini linkbtn" href={feedbackMailtoUrl(appVersion ?? "")}>
            Send feedback / report a bug
          </a>
        </div>
      </div>

      {showSheetsGuide && <SheetsGuide onClose={() => setShowSheetsGuide(false)} />}
    </div>
  );
}
