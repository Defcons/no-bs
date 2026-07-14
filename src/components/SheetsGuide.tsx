// In-app Google Sheets sync setup guide (replaces the external website). Bundles
// the actual apps-script/Code.gs via ?raw so the shown script never drifts.
import { useState } from "react";
import codeGs from "../../apps-script/Code.gs?raw";

export function SheetsGuide({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codeGs);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select the text manually */
    }
  };

  return (
    <div className="hr-modal-backdrop" onClick={onClose}>
      <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
        <header className="edit-head">
          <h3>Google Sheets sync — setup</h3>
          <button className="mini" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="edit-body guide-body">
          <p className="muted tiny">
            Optional. Writes every finished workout into your own Google Sheet via a small Apps Script that runs as you
            — no Google Cloud or OAuth. One-time, ~5 minutes.
          </p>
          <ol className="guide-steps">
            <li>
              <b>Open the script editor.</b> In your Google Sheet: <b>Extensions → Apps Script</b>. Delete the default
              code and paste the script below.
            </li>
            <li>
              <b>Set a secret.</b> Near the top, change <code>var SECRET = "CHANGE_ME"</code> to a long random string —
              you'll paste the same one into the app.
            </li>
            <li>
              <b>Deploy.</b> <b>Deploy → New deployment</b> → type <b>Web app</b> → <b>Execute as: Me</b>,{" "}
              <b>Who has access: Anyone</b> → <b>Deploy</b> and authorize when asked. Copy the <b>Web app URL</b> (ends
              in <code>/exec</code>).
            </li>
            <li>
              <b>Connect.</b> Back in <b>Settings → Google Sheets sync</b>, paste the URL and the same secret, then tap{" "}
              <b>Test connection</b> (should say ✓).
            </li>
          </ol>

          <div className="guide-script-head">
            <span className="tiny muted">Apps Script — Code.gs</span>
            <button className="mini" onClick={copy}>
              {copied ? "Copied ✓" : "Copy script"}
            </button>
          </div>
          <pre className="guide-script">
            <code>{codeGs}</code>
          </pre>

          <p className="muted tiny">
            The matching year tab and day-block must already exist in your sheet. If you edit the script later, re-deploy
            via <b>Manage deployments → New version</b> so the URL keeps working.
          </p>
        </div>

        <footer className="edit-foot">
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
