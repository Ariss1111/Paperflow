"use client";
import { Sheet } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/controls";

const GROUPS: [string, [string, string[]][]][] = [
  [
    "General",
    [
      ["Save to My Documents", ["⌘", "S"]],
      ["Undo / Redo", ["⌘", "Z"]],
      ["Redo", ["⇧", "⌘", "Z"]],
      ["Full screen", ["F"]],
      ["This list", ["?"]],
    ],
  ],
  [
    "View",
    [
      ["Zoom in / out", ["⌘", "+ / −"]],
      ["Fit to width", ["⌘", "0"]],
      ["Actual size (100%)", ["⌘", "1"]],
      ["Zoom with the wheel", ["⌘", "scroll"]],
      ["Pan", ["Space", "drag"]],
      ["Previous / next page", ["PgUp", "PgDn"]],
    ],
  ],
  [
    "Tools",
    [
      ["Select / Pan", ["V", "P"]],
      ["Add text / Edit text", ["T", "E"]],
      ["Highlight / Underline / Strike", ["H", "U", "S"]],
      ["Comment / Draw", ["C", "D"]],
      ["Rectangle / Ellipse / Line / Arrow", ["R", "O", "L", "A"]],
      ["Erase area", ["X"]],
      ["Signature / Image", ["G", "I"]],
    ],
  ],
  [
    "Objects",
    [
      ["Delete selected", ["⌫"]],
      ["Duplicate", ["⌘", "D"]],
      ["Nudge (×10 with ⇧)", ["←", "↑", "→", "↓"]],
      ["Deselect / stop tool", ["Esc"]],
    ],
  ],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" description="Ctrl works wherever ⌘ is shown." className="w-[min(640px,calc(100vw-32px))]">
      <div className="scroll-thin grid max-h-[60vh] gap-6 overflow-y-auto sm:grid-cols-2">
        {GROUPS.map(([title, rows]) => (
          <section key={title}>
            <p className="eyebrow mb-2">{title}</p>
            <ul className="space-y-1.5">
              {rows.map(([label, keys]) => (
                <li key={label} className="flex items-center justify-between gap-3 text-sm text-ink">
                  <span>{label}</span>
                  <span className="flex shrink-0 gap-1">
                    {keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
