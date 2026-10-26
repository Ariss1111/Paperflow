"use client";
import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import type { ToolDef, ToolOption } from "@/lib/tools/catalog";
import { Field, Input, Select, Segmented, Switch, Textarea } from "@/components/ui/controls";
import { parseRanges } from "@/lib/pdf/pages";

export type OptionValues = Record<string, string | number | boolean>;

export function defaultOptions(tool: ToolDef, overrides: Partial<OptionValues> = {}): OptionValues {
  const v: OptionValues = {};
  for (const o of tool.options ?? []) {
    if ("default" in o && o.default !== undefined) v[o.key] = o.default;
    else if (o.type === "text" || o.type === "textarea" || o.type === "pages" || o.type === "password") v[o.key] = "";
  }
  for (const [k, val] of Object.entries(overrides)) if (val !== undefined && k in v) v[k] = val;
  return v;
}

export function visible(o: ToolOption, values: OptionValues) {
  return !o.showIf || o.showIf.in.includes(String(values[o.showIf.key]));
}

/** Returns field → message for invalid values (null when valid). `pages` is known for single-PDF tools. */
export function validateOptions(tool: ToolDef, values: OptionValues, pages?: number, confirm?: Record<string, string>): Record<string, string> | null {
  const errors: Record<string, string> = {};
  for (const o of tool.options ?? []) {
    if (!visible(o, values)) continue;
    const v = values[o.key];
    if ((o.type === "text" || o.type === "textarea" || o.type === "pages" || o.type === "password") && "required" in o && o.required && !String(v ?? "").trim()) {
      errors[o.key] = o.type === "password" ? "Enter a password." : `Enter ${o.label.toLowerCase()}.`;
      continue;
    }
    if (o.type === "pages" && String(v ?? "").trim() && pages) {
      try {
        parseRanges(String(v), pages);
      } catch (e) {
        errors[o.key] = (e as Error).message;
      }
    }
    if (o.type === "password" && o.confirm && v && confirm?.[o.key] !== v) errors[`${o.key}__confirm`] = "The passwords don't match.";
    if (o.type === "number" && (typeof v !== "number" || Number.isNaN(v) || v < o.min || v > o.max)) errors[o.key] = `Enter a value between ${o.min} and ${o.max}.`;
  }
  return Object.keys(errors).length ? errors : null;
}

function PasswordInput({ id, value, onChange, autoComplete }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} className="pr-9" maxLength={127} />
      <button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((s) => !s)} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-3 hover:text-ink">
        {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}

export function OptionsForm({
  tool,
  values,
  onChange,
  errors,
  confirm,
  onConfirmChange,
  optionOverrides,
  disabled,
}: {
  tool: ToolDef;
  values: OptionValues;
  onChange: (v: OptionValues) => void;
  errors?: Record<string, string> | null;
  confirm: Record<string, string>;
  onConfirmChange: (c: Record<string, string>) => void;
  optionOverrides?: Partial<Record<string, { value: string; label: string }[]>>;
  disabled?: boolean;
}) {
  const set = (k: string, v: string | number | boolean) => onChange({ ...values, [k]: v });
  return (
    <fieldset disabled={disabled} className="space-y-5 disabled:opacity-60">
      {(tool.options ?? []).filter((o) => visible(o, values)).map((o) => {
        const id = `opt-${o.key}`;
        const err = errors?.[o.key];
        switch (o.type) {
          case "segmented":
            return (
              <Field key={o.key} label={o.label} hint={o.hint}>
                <Segmented label={o.label} value={String(values[o.key])} onChange={(v) => set(o.key, v)} options={(optionOverrides?.[o.key] ?? o.options)} />
              </Field>
            );
          case "select":
            return (
              <Field key={o.key} label={o.label} hint={o.hint} htmlFor={id}>
                <Select id={id} value={String(values[o.key])} onChange={(e) => set(o.key, e.target.value)}>
                  {(optionOverrides?.[o.key] ?? o.options).map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                </Select>
              </Field>
            );
          case "number":
            return (
              <Field key={o.key} label={o.label} hint={o.hint} htmlFor={id} error={err}>
                <div className="flex items-center gap-3">
                  {o.max - o.min <= 360 && (
                    <input
                      type="range"
                      aria-hidden
                      tabIndex={-1}
                      min={o.min}
                      max={o.max}
                      step={o.step ?? 1}
                      value={Number(values[o.key])}
                      onChange={(e) => set(o.key, Number(e.target.value))}
                      className="h-1 flex-1 cursor-pointer accent-[rgb(var(--accent))]"
                    />
                  )}
                  <div className="relative w-24 shrink-0">
                    <Input
                      id={id}
                      type="number"
                      inputMode="numeric"
                      min={o.min}
                      max={o.max}
                      step={o.step ?? 1}
                      value={Number.isNaN(Number(values[o.key])) ? "" : Number(values[o.key])}
                      onChange={(e) => set(o.key, e.target.value === "" ? Number.NaN : Number(e.target.value))}
                      className="pr-8 text-right tabular-nums"
                    />
                    {o.unit && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-3">{o.unit}</span>}
                  </div>
                </div>
              </Field>
            );
          case "text":
          case "pages":
            return (
              <Field key={o.key} label={o.label} hint={o.hint} htmlFor={id} error={err}>
                <Input id={id} value={String(values[o.key] ?? "")} placeholder={o.placeholder} maxLength={"maxLength" in o ? o.maxLength : 200} onChange={(e) => set(o.key, e.target.value)} aria-invalid={!!err} />
              </Field>
            );
          case "textarea":
            return (
              <Field key={o.key} label={o.label} hint={o.hint} htmlFor={id} error={err}>
                <Textarea id={id} rows={6} value={String(values[o.key] ?? "")} placeholder={o.placeholder} maxLength={o.maxLength} onChange={(e) => set(o.key, e.target.value)} className="font-mono text-xs" aria-invalid={!!err} />
              </Field>
            );
          case "password":
            return (
              <div key={o.key} className="space-y-4">
                <Field label={o.label} hint={o.hint} htmlFor={id} error={err}>
                  <PasswordInput id={id} value={String(values[o.key] ?? "")} onChange={(v) => set(o.key, v)} autoComplete={o.confirm ? "new-password" : "current-password"} />
                </Field>
                {o.confirm && (
                  <Field label="Confirm password" htmlFor={`${id}-confirm`} error={errors?.[`${o.key}__confirm`]}>
                    <PasswordInput id={`${id}-confirm`} value={confirm[o.key] ?? ""} onChange={(v) => onConfirmChange({ ...confirm, [o.key]: v })} autoComplete="new-password" />
                  </Field>
                )}
              </div>
            );
          case "checkbox":
            return (
              <div key={o.key} className="flex items-start justify-between gap-4">
                <label htmlFor={id} className="text-sm text-ink">
                  {o.label}
                  {o.hint && <span className="mt-0.5 block text-xs text-ink-3">{o.hint}</span>}
                </label>
                <Switch id={id} checked={!!values[o.key]} onCheckedChange={(v) => set(o.key, v)} />
              </div>
            );
          case "color":
            return (
              <Field key={o.key} label={o.label} htmlFor={id} inline>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs uppercase text-ink-3">{String(values[o.key])}</span>
                  <input id={id} type="color" value={String(values[o.key])} onChange={(e) => set(o.key, e.target.value)} className="h-7 w-10 cursor-pointer rounded-md border-0 bg-transparent p-0" />
                </div>
              </Field>
            );
        }
      })}
    </fieldset>
  );
}
