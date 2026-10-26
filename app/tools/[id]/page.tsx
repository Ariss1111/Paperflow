import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getTool, TOOLS } from "@/lib/tools/catalog";
import { ToolRouter } from "./ToolRouter";

type Props = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return TOOLS.filter((t) => t.id !== "convert").map((t) => ({ id: t.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tool = getTool((await params).id);
  return tool ? { title: tool.name, description: tool.description } : {};
}

export default async function ToolPage({ params }: Props) {
  const { id } = await params;
  if (id === "convert") redirect("/convert");
  if (id === "edit") redirect("/editor");
  const tool = getTool(id);
  if (!tool) notFound();
  return (
    <Suspense>
      <ToolRouter id={tool.id} />
    </Suspense>
  );
}
