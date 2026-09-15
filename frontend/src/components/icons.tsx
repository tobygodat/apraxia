/** Small inline glyphs shared by the cloud task views and the legacy pages. */

function Glyph({ d, strokeWidth = 1.7 }: { readonly d: string; readonly strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}

export function ArrowIcon({ direction }: { readonly direction: "left" | "right" }) {
  return <Glyph d={direction === "left" ? "m12.5 5-5 5 5 5" : "m7.5 5 5 5-5 5"} />;
}

export function PlusIcon() {
  return <Glyph d="M10 4v12M4 10h12" />;
}

export function CloseIcon() {
  return <Glyph d="m5 5 10 10M15 5 5 15" />;
}

export function CheckIcon() {
  return <Glyph d="m5.5 10 3 3 6-6" strokeWidth={2} />;
}

export function DragIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 20">
      <path
        d="M5 5h.01M11 5h.01M5 10h.01M11 10h.01M5 15h.01M11 15h.01"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.4"
      />
    </svg>
  );
}
