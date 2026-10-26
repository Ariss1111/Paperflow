import {
  Combine, Scissors, LayoutGrid, RotateCw, FileMinus, FileOutput, FileX, Minimize2, Wrench, ArrowLeftRight,
  FileText, Presentation, Sheet, FileType, Image, Images, Code, PenLine, Signature, Stamp, Hash, PanelTop,
  Crop, Scaling, ClipboardPen, Layers, Bookmark, Lock, LockOpen, Info, ScanText, TextSelect, ImageDown, GitCompare,
  type LucideProps,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolCategory } from "@/lib/tools/catalog";

// Explicit map keeps the client bundle to the icons the catalog actually uses.
const ICONS: Record<string, React.ComponentType<LucideProps>> = {
  Combine, Scissors, LayoutGrid, RotateCw, FileMinus, FileOutput, FileX, Minimize2, Wrench, ArrowLeftRight,
  FileText, Presentation, Sheet, FileType, Image, Images, Code, PenLine, Signature, Stamp, Hash, PanelTop,
  Crop, Scaling, ClipboardPen, Layers, Bookmark, Lock, LockOpen, Info, ScanText, TextSelect, ImageDown, GitCompare,
};

export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const C = ICONS[name] ?? FileText;
  return <C aria-hidden strokeWidth={1.75} {...props} />;
}

// Restrained per-category tints: identity without a rainbow.
const TINT: Record<ToolCategory, string> = {
  organize: "text-[#0a84ff] bg-[#0a84ff]/[0.1]",
  edit: "text-[#a550e0] bg-[#bf5af2]/[0.11]",
  convert: "text-[#25915c] bg-[#30a46c]/[0.12] dark:text-[#4cc38a]",
  optimize: "text-[#d97a00] bg-[#ff9f0a]/[0.13] dark:text-[#ffb340]",
  security: "text-[#e5352b] bg-[#ff453a]/[0.1] dark:text-[#ff6961]",
  extract: "text-[#0a8fb8] bg-[#5ac8fa]/[0.15] dark:text-[#64d2ff]",
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
