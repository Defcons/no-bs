// Reusable sound picker: a preset dropdown + the user's uploaded sounds, with
// preview, upload (validated + stored in IndexedDB), and delete. Value is a preset
// id ("beep"…) or "custom:<dbId>". Used for the low-heart-rate warning sound.
import { useLiveQuery } from "dexie-react-hooks";
import { addCustomSound, deleteCustomSound, listCustomSounds } from "../db";
import { BREAK_SOUNDS, CUSTOM_PREFIX, customIdOf, decodeSound, isCustom, playSoundChoice } from "../lib/sounds";

export function SoundField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const customSounds = useLiveQuery(() => listCustomSounds(), [], []);

  const pick = (v: string) => {
    onChange(v);
    void playSoundChoice(v); // immediate feedback
  };

  const onFile = async (file: File) => {
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
    pick(`${CUSTOM_PREFIX}${await addCustomSound(name, file)}`);
  };

  return (
    <div className="row">
      <select value={value} onChange={(e) => pick(e.target.value)}>
        <optgroup label="Presets">
          {BREAK_SOUNDS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </optgroup>
        {customSounds.length > 0 && (
          <optgroup label="Your sounds">
            {customSounds.map((c) => (
              <option key={c.id} value={`${CUSTOM_PREFIX}${c.id}`}>
                {c.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <button className="mini" onClick={() => void playSoundChoice(value)}>
        ▶ Preview
      </button>
      <label className="mini linkbtn" style={{ cursor: "pointer" }}>
        Upload
        <input
          type="file"
          accept="audio/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />
      </label>
      {isCustom(value) && (
        <button
          className="mini danger"
          onClick={async () => {
            await deleteCustomSound(customIdOf(value));
            onChange("beep");
          }}
        >
          Delete
        </button>
      )}
    </div>
  );
}
