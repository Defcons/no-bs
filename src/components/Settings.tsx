// Settings: rest-timer default, weight increment, HR connection, and data
// backup/reset. Google Sheets write-back is a later phase.
import { bluetoothAvailable } from "../lib/hr";

type Props = {
  restDefaultSec: number;
  setRestDefaultSec: (v: number) => void;
  weightStep: number;
  setWeightStep: (v: number) => void;
  hr: { bpm: number | null; connected: boolean; connect: () => void; disconnect: () => void };
  onExport: () => void;
  onReset: () => void;
};

export function Settings({ restDefaultSec, setRestDefaultSec, weightStep, setWeightStep, hr, onExport, onReset }: Props) {
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
          {[1, 2.5, 5].map((s) => (
            <button key={s} className={weightStep === s ? "active" : ""} onClick={() => setWeightStep(s)}>
              {s} kg
            </button>
          ))}
        </div>
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
      </div>

      <div className="setting">
        <label>Data</label>
        <div className="row">
          <button className="mini" onClick={onExport}>
            Export backup (JSON)
          </button>
          <button className="mini danger" onClick={onReset}>
            Reset app data
          </button>
        </div>
        <p className="muted tiny">Google Sheets sync is coming in a later update.</p>
      </div>
    </div>
  );
}
