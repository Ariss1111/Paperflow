// A real-interface preview built from layout primitives (no stock imagery).
export function HeroPreview() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-[560px] select-none">
      <div className="absolute -inset-x-10 -bottom-10 top-10 rounded-[40px] bg-accent/[0.07] blur-3xl" />
      <div className="relative overflow-hidden rounded-[14px] bg-surface shadow-overlay">
        {/* title bar */}
        <div className="flex h-9 items-center gap-2 border-b bg-surface-2/60 px-3">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 h-4 w-28 rounded bg-ink/[0.06]" />
          <span className="ml-auto flex gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`size-5 rounded-[5px] ${i === 1 ? "bg-accent/20" : "bg-ink/[0.06]"}`} />
            ))}
          </span>
        </div>
        <div className="flex h-[300px]">
          {/* thumbnails */}
          <div className="w-[88px] space-y-2.5 border-r bg-surface-2/40 p-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`rounded-[4px] bg-white p-1.5 shadow-[0_0_0_0.5px_rgb(0_0_0/0.12)] ${i === 0 ? "ring-2 ring-accent ring-offset-1" : ""}`}>
                <div className="h-1 w-8 rounded bg-black/70" />
                {[0, 1, 2, 3, 4].map((l) => (
                  <div key={l} className="mt-1 h-[3px] rounded bg-black/15" style={{ width: `${90 - ((l * 13) % 30)}%` }} />
                ))}
              </div>
            ))}
          </div>
          {/* page */}
          <div className="checker flex flex-1 items-start justify-center p-5">
            <div className="relative h-[250px] w-[196px] rounded-[3px] bg-white p-5 shadow-[0_0_0_0.5px_rgb(0_0_0/0.1),0_8px_24px_-6px_rgb(0_0_0/0.2)]">
              <div className="h-2.5 w-24 rounded-sm bg-black/80" />
              <div className="mt-1.5 h-1.5 w-16 rounded-sm bg-black/25" />
              <div className="mt-4 space-y-1.5">
                {[94, 88, 97, 70].map((w, i) => (
                  <div key={i} className="relative h-1.5 rounded-sm bg-black/15" style={{ width: `${w}%` }}>
                    {i === 1 && <span className="absolute -inset-y-[3px] left-[10%] w-[60%] rounded-[2px] bg-[#ffd60a]/60" />}
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-1.5">
                {[90, 96, 60].map((w, i) => (
                  <div key={i} className="h-1.5 rounded-sm bg-black/15" style={{ width: `${w}%` }} />
                ))}
              </div>
              {/* text overlay being edited */}
              <div className="absolute left-4 top-[150px] rounded-[3px] px-1 py-0.5 text-[10px] font-medium text-[#0071e3] outline outline-1 outline-[#0071e3]">
                Approved — Q3 figures
                <span className="absolute -right-1 -top-1 size-2 rounded-full border border-[#0071e3] bg-white" />
                <span className="absolute -bottom-1 -left-1 size-2 rounded-full border border-[#0071e3] bg-white" />
              </div>
              {/* signature */}
              <svg viewBox="0 0 120 40" className="absolute bottom-6 right-5 w-24 text-[#1d1d1f]">
                <path d="M4 28c10-14 16-22 20-16s-6 18 2 14 12-20 18-12-4 14 4 10 10-12 16-8 8 6 14 2 12-6 18-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <div className="absolute bottom-5 right-5 h-px w-24 bg-black/25" />
            </div>
          </div>
        </div>
      </div>
      {/* floating result chip */}
      <div className="glass absolute -bottom-5 left-6 flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 shadow-raised">
        <span className="flex size-7 items-center justify-center rounded-lg bg-success/[0.14] text-success">
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none">
            <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="text-xs">
          <span className="block font-semibold text-ink">report-signed.pdf</span>
          <span className="text-ink-3">2.4 MB → 812 KB · −66%</span>
        </span>
      </div>
    </div>
  );
}
