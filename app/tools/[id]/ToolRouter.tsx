"use client";
import dynamic from "next/dynamic";
import { getTool } from "@/lib/tools/catalog";
import { ToolWorkspace } from "@/components/tool/ToolWorkspace";

const OrganizeWorkspace = dynamic(() => import("@/components/organize/OrganizeWorkspace").then((m) => m.OrganizeWorkspace));
const FillFormWorkspace = dynamic(() => import("@/components/forms/FillFormWorkspace").then((m) => m.FillFormWorkspace));
const Editor = dynamic(() => import("@/components/editor/EditorPage").then((m) => m.EditorPage), { ssr: false });

export function ToolRouter({ id }: { id: string }) {
  const tool = getTool(id)!;
  switch (tool.ui) {
    case "organize":
      return <OrganizeWorkspace tool={tool} />;
    case "fill-form":
      return <FillFormWorkspace tool={tool} />;
    case "editor":
      return <Editor mode={tool.id === "sign" ? "sign" : "edit"} />;
    default:
      return <ToolWorkspace tool={tool} />;
  }
}
