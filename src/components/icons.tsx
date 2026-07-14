// Line-icon set (matches the generated Firefly designs). All stroke `currentColor`
// at 1em, so they inherit the surrounding text colour — tab bar tints muted→accent,
// theme toggle/headers inherit their context — and stay crisp at any size + theme.
type IconProps = { className?: string };
const base = {
  width: "1em",
  height: "1em",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

// ── Tab bar ──────────────────────────────────────────────────────────────
export function DumbbellIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M3.5 9.5v5" />
      <path d="M6.5 7.5v9" />
      <path d="M17.5 7.5v9" />
      <path d="M20.5 9.5v5" />
      <path d="M6.5 12h11" />
    </svg>
  );
}
export function CalendarCheckIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M8 2.5v4" />
      <path d="M16 2.5v4" />
      <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="m8.5 14.5 2.2 2.2 4.3-4.3" />
    </svg>
  );
}
export function TrophyIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M5 20h14" />
      <path d="M10 14.7V17c0 .8-.6 1.3-1.3 1.6C7.7 19.1 7 20 7 20" />
      <path d="M14 14.7V17c0 .8.6 1.3 1.3 1.6.9.5 1.7 1.4 1.7 1.4" />
      <path d="M6 3.5h12V9a6 6 0 0 1-12 0V3.5Z" />
    </svg>
  );
}
export function GearIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// ── Theme toggle ─────────────────────────────────────────────────────────
export function MoonIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
export function SunIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2" />
      <path d="M12 19.5v2" />
      <path d="m4.9 4.9 1.4 1.4" />
      <path d="m17.7 17.7 1.4 1.4" />
      <path d="M2.5 12h2" />
      <path d="M19.5 12h2" />
      <path d="m4.9 19.1 1.4-1.4" />
      <path d="m17.7 6.3 1.4-1.4" />
    </svg>
  );
}

// ── Accents ──────────────────────────────────────────────────────────────
export function BicepIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 14.5c0 1.7 1.3 3 3 3h4.5a5.5 5.5 0 0 0 5.5-5.5V6.2a2 2 0 0 0-4 0v3.3a2.2 2.2 0 0 1-2.2 2.2H7a3 3 0 0 0-3 3z" />
      <path d="M4.2 14c2.1 1.5 4.7 2 7.1 1.2" />
    </svg>
  );
}
export function FlameIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}
