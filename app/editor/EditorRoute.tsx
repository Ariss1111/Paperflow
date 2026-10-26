"use client";
import dynamic from "next/dynamic";

// PDF.js and canvas work are browser-only.
const EditorPage = dynamic(() => import("@/components/editor/EditorPage").then((m) => m.EditorPage), { ssr: false });

export function EditorRoute() {
  return <EditorPage mode="edit" />;
}
