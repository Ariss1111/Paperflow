"use client";
import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/25 dark:bg-black/50" />
        <D.Content
          className={cn(
            "fixed left-1/2 top-[18vh] z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 animate-sheet-in rounded-2xl bg-surface p-5 shadow-overlay focus:outline-none",
            className,
          )}
        >
          <D.Title className="text-lg font-semibold text-ink">{title}</D.Title>
          {description ? <D.Description className="mt-1.5 text-sm text-ink-2">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          {children && <div className="mt-4">{children}</div>}
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Confirmation for destructive actions. */
export function useConfirm() {
  const [state, setState] = React.useState<{ title: string; body?: string; action: string; resolve: (ok: boolean) => void } | null>(null);
  const confirm = React.useCallback(
    (title: string, action: string, body?: string) => new Promise<boolean>((resolve) => setState({ title, body, action, resolve })),
    [],
  );
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  const element = (
    <Sheet
      open={!!state}
      onOpenChange={(o) => !o && close(false)}
      title={state?.title ?? ""}
      description={state?.body}
      footer={
        <>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => close(true)} autoFocus>
            {state?.action}
          </Button>
        </>
      }
    />
  );
  return { confirm, element };
}
