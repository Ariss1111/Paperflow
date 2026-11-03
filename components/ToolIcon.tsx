import {
  Combine, Scissors, LayoutGrid, RotateCw, FileMinus, FileOutput, FileX, Minimize2, Wrench, ArrowLeftRight,
  FileText, Presentation, Sheet, FileType, Image, Images, Code, PenLine, Signature, Stamp, Hash, PanelTop,
  Crop, Scaling, ClipboardPen, Layers, Bookmark, Lock, LockOpen, Info, ScanText, TextSelect, ImageDown, GitCompare, ScanLine, Sparkles, MessagesSquare, Languages, ListChecks,
  type LucideProps,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolCategory } from "@/lib/tools/catalog";

// Explicit map keeps the client bundle to the icons the catalog actually uses.
const ICONS: Record<string, React.ComponentType<LucideProps>> = {
  Combine, Scissors, LayoutGrid, RotateCw, FileMinus, FileOutput, FileX, Minimize2, Wrench, ArrowLeftRight,
  FileText, Presentation, Sheet, FileType, Image, Images, Code, PenLine, Signature, Stamp, Hash, PanelTop,
  Crop, Scaling, ClipboardPen, Layers, Bookmark, Lock, LockOpen, Info, ScanText, TextSelect, ImageDown, GitCompare, ScanLine, Sparkles, MessagesSquare, Languages, ListChecks,
};

export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const C = ICONS[name] ?? FileText;
  return <C aria-hidden strokeWidth={1.75} {...props} />;
}

// Restrained per-category tints: identity without a rainbow.
const TINT: Record<ToolCategory, string> = {
  organize: "text-[#3478F6] bg-[#3478F6]/[0.1] dark:text-[#6EA0FF]",
  optimize: "text-[#d97a00] bg-[#ff9f0a]/[0.13] dark:text-[#ffb340]",
  convert: "text-[#25915c] bg-[#30a46c]/[0.12] dark:text-[#4cc38a]",
  edit: "text-[#a550e0] bg-[#bf5af2]/[0.11] dark:text-[#d08cf7]",
  scan: "text-[#0a8fb8] bg-[#5ac8fa]/[0.15] dark:text-[#64d2ff]",
  secure: "text-[#e5352b] bg-[#ff453a]/[0.1] dark:text-[#ff6961]",
  ai: "text-[#5b4cf0] bg-gradient-to-br from-[#5b4cf0]/[0.12] to-[#3478F6]/[0.12] dark:text-[#9d93ff]",
};

export function ToolGlyph({ icon, category, size = "md", className }: { icon: string; category: ToolCategory; size?: "sm" | "md" | "lg"; className?: string }) {
  const box = size === "sm" ? "size-7 rounded-[8px]" : size === "lg" ? "size-12 rounded-[14px]" : "size-9 rounded-[10px]";
  const glyph = size === "sm" ? "size-[15px]" : size === "lg" ? "size-6" : "size-[18px]";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", box, TINT[category], className)}>
      <Icon name={icon} className={glyph} />
    </span>
  );
}
