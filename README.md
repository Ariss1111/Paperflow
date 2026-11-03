# Pagelyt

*Every page. In its place.*

A document workspace for PDFs and Office files: edit, sign, convert, merge, split, organize, compress, protect and OCR.
Every tool performs its real operation on your file. Nothing is simulated, and a tool that needs a missing engine says so instead of pretending.

> The product name lives in `lib/brand.ts` (or set `NEXT_PUBLIC_APP_NAME`).

---

## Quick start

### Windows, this folder as delivered

Double-click **`start-paperflow.cmd`**. It uses the portable Node.js in `.tools/node`, builds on first run, opens **http://localhost:3210** and keeps the server running until you close the window. LibreOffice is already extracted in `.tools/libreoffice`, so Office conversion works.

### Any machine with Node.js 22+

```bash
npm install
```
```bash
npm run build
```
```bash
npm start
```

Open http://localhost:3210. For development with hot reload, use `npm run dev`.

For Office conversion, install LibreOffice (`apt install libreoffice` on Debian/Ubuntu, `brew install --cask libreoffice` on macOS, or the Windows installer), or set `SOFFICE_PATH`. On Windows you can run `scripts/fetch-libreoffice.ps1` to get a portable copy instead: it downloads the official MSI, verifies its signature, and extracts it without installing anything.

### Docker (recommended for servers)

```bash
docker compose up --build
```

The image includes LibreOffice and Office-compatible fonts (Carlito, Caladea, Liberation, DejaVu, Noto).

---

## AI tools (optional)

The **AI Workspace** (`/ai`) shows the document on one side and the assistant on the other:

- **Chat** with suggested questions, page citations that scroll the viewer, and "Explain this paragraph" on text selected in the viewer.
- **Summary** in six styles: short, detailed, by section, key points, important dates, action items.
- **Translate** into English, Romanian, French, German, Spanish or Italian, keeping headings, lists and tables, with downloads as Word (.docx) or Markdown.
- **Extract** invoice numbers, names, addresses, dates, prices, tables, contacts and clauses as structured data, exported as CSV or JSON.
- **Compare** two PDFs: reworded, added and removed paragraphs, changed dates and numbers, and formatting changes. This runs on the server **without AI**. An optional "Explain with AI" sends only the list of differences.

It runs on Anthropic's Claude API (model `claude-opus-5-5`, with Anthropic's server-side fallback so a declined request is retried on a suitable model).

1. Create an API key at https://console.anthropic.com (usage is billed per document by Anthropic).
2. Locally: create a file named `.env.local` next to `package.json` containing `ANTHROPIC_API_KEY=sk-ant-...`, then restart. On Render: service → **Environment** → **Add Environment Variable** → `ANTHROPIC_API_KEY`.

**Security and privacy.** The key lives only on the server; the browser talks to Pagelyt's `/api/ai`, never to Anthropic. Without a key, the AI features say *Needs setup* and nothing is sent anywhere. With a key, a document goes to Anthropic only when someone uses an AI feature, and the workspace asks once before the first time.

**Long documents.** Up to 100 pages are read in one request. Longer ones are processed in sections:
- **Summaries:** notes are written per 50-page section, then the summary is written from the notes.
- **Questions:** only the sections most relevant to the question are read (TF-IDF ranking), and the answer says which pages were read.
- **Translation:** done 8 pages at a time.

**Cost safeguards** (all set through environment variables; see `.env.example`):
- **Per visitor, per day:** a request allowance (`AI_DAILY_REQUESTS`, default 30) and a token allowance (`AI_DAILY_TOKENS`, default 1.5M), counted from the provider's own usage figures.
- **Per document:** a file size limit (`AI_MAX_FILE_MB`, default 25) and a page limit (`AI_MAX_PAGES`, default 300).
- **Whole server:** a daily cap (`AI_GLOBAL_DAILY_REQUESTS`, default 2000).
- **Per minute:** a rate limit (`RATE_LIMIT_AI_PER_MIN`, default 12).

Usage is shown in the workspace and kept in `DATA_DIR/ai-usage.json`, so a restart doesn't reset it. A **Pro** plan with larger allowances (`AI_PRO_*`) is defined. `planFor()` in `lib/server/ai/config.ts` is the single place a billing system would assign it; until then everyone is on Free.

**Providers.** `AI_PROVIDER` selects the provider (`anthropic`, or `none` to switch AI off). Each provider implements the small `AiProvider` interface in `lib/server/ai/provider.ts`; Anthropic is the one included.

## Accounts and saved documents (optional)

The PDF tools work without an account. With one, people can do the following:
- **My Documents:** upload, view and open documents, rename them, put them in folders (moving them between folders), mark favourites, search, and sort by date, name or size. There are Recent, Shared and Trash views, and storage use is shown.
- **Sync:** saved documents and preferences are the same on every device. The library checks for changes every 15 seconds and whenever the window comes back into focus.
- **History:** the PDF Editor saves straight back to a saved document as a new version. Each document keeps 10 versions and an activity log, and any version can be downloaded or restored.
- **Sharing:**
  - Links contain 128 random bits.
  - A link is either for anyone who has it, or private to named people, who must sign in with that email.
  - Optional password, expiry date and download permission, plus view counts and revoking.

**How it's built.**
- **Sign-in:** email and password (scrypt), with email confirmation and password reset by email, or Google (OAuth with PKCE).
- **Sessions:** server-side. The cookie holds a random token, and the database stores only its SHA-256.
- **Data:** Postgres in production; the built-in PGlite when `DATABASE_URL` isn't set.
- **Files:** a private S3-compatible bucket in production (Cloudflare R2, Amazon S3); a private folder in `DATA_DIR` otherwise. Every file is served through a signed link that expires after 5 minutes, and only after an access check. Another user's document always answers 404.

**Abuse protection.**
- Rate limits on sign-up, login, password reset and link passwords, with login lockout after repeated failures.
- File type checked by content, size limits and a per-account quota.

**Cleanup**, run every hour:
- Expired sessions and tokens are removed.
- Unconfirmed accounts are deleted after 7 days.
- The Trash is emptied after 30 days, and old link records are purged.

Deleting an account removes everything at once.

Locally, `start-paperflow.cmd` stores everything in `.data/` and shows emails at http://localhost:3210/dev/mail. To put it online, follow DEPLOY.md → *Turn on accounts and saved documents*.

## Brand

Logo, mark, app icon, favicons and the PWA manifest are generated from one geometry by `node scripts/make-brand.mjs` (outputs in `public/brand/`, `app/icon.svg`, `app/apple-icon.png`). The in-app logo lives in `components/brand/Logo.tsx`; colours and type are design tokens in `app/globals.css` (accent `#3478F6`; SF Pro on Apple devices, Inter elsewhere). Pricing plans are edited in `lib/pricing.ts`.

## System requirements

| Component | Needed for | Notes |
|---|---|---|
| Node.js 22 LTS | everything | Next.js server, all PDF processing |
| LibreOffice 7.4+ | Word/PowerPoint/Excel/ODF/RTF/CSV/TXT/HTML/Markdown → PDF, exact-layout PDF → Word | Found automatically in `.tools/libreoffice`, standard install paths, `PATH`, or `SOFFICE_PATH` |
| Fonts | conversion fidelity | Install fonts your documents use; missing fonts are substituted |
| ClamAV (`clamd`) | optional malware scanning | Set `CLAMAV_ADDRESS=host:3310` |
| ~1–2 GB RAM | LibreOffice + OCR | 512 MB works for PDF tools; large Office files may fail |

Everything else ships as npm packages: MuPDF (WASM), pdf-lib, sharp/libvips, tesseract.js with English OCR data, PDF.js, OpenCV.js and DejaVu fonts.

## Configuration (`.env`)

Copy `.env.example` to `.env`. All values are optional.

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_APP_NAME` | Pagelyt | Product name in the UI |
| `DATA_DIR` | `<tmp>/paperflow` | Uploads, results, LibreOffice profile |
| `RETENTION_MINUTES` | 60 | Files and results are deleted after this |
| `MAX_UPLOAD_MB` | 200 | Per-file limit |
| `MAX_FILES_PER_REQUEST` | 30 | Files per upload request |
| `JOB_CONCURRENCY` | 2 | Jobs processed in parallel |
| `JOB_TIMEOUT_SECONDS` | 300 | Hard limit per job |
| `CONVERSION_TIMEOUT_SECONDS` | 180 | LibreOffice process limit (killed after) |
| `RATE_LIMIT_UPLOADS_PER_MIN` / `RATE_LIMIT_JOBS_PER_MIN` | 60 / 40 | Per browser session |
| `SOFFICE_PATH` | auto | LibreOffice executable |
| `OCR_LANG_PATH`, `OCR_LANGUAGES` | bundled `eng` | Extra Tesseract languages: put `ron.traineddata` (or `.gz`) in the folder and list `eng,ron` |
| `CLAMAV_ADDRESS` | off | `host:port` of clamd. When set, uploads fail closed if the scanner is unreachable |

---

## Feature status

Every item marked **Working** is covered by automated tests that run the operation on real sample files and check the output file itself: page order, text content, annotations, encryption, image format and so on.

### Working (tested end to end)

| Area | Tools |
|---|---|
| Organize | Merge (drag order), Split (ranges / every page / fixed size, ZIP), Organize pages (reorder, rotate, duplicate, delete, insert from another PDF, extract selection, undo/redo), Rotate, Delete pages, Extract pages, Remove blank pages |
| Edit | PDF editor (see below), Sign (draw/type/upload, position/resize/rotate, date and text), Watermark (Unicode, angle, opacity, tiling, behind content), Page numbers, Header & footer, Crop, Resize to A3/A4/A5/Letter/Legal, Fill AcroForm fields (with optional flatten), Flatten, Bookmarks |
| Optimize | Compress (3 levels, real before/after sizes, original kept if it can't be made smaller), Repair (rebuilds broken cross-reference tables) |
| Security | Protect (AES-256, permissions), Unlock (requires the correct password; permission-only PDFs require the owner password), View/edit/remove metadata (Info and XMP) |
| Convert | DOCX, DOC, ODT, RTF, PPTX, PPT, ODP, XLSX, XLS, ODS, CSV, TXT, HTML and Markdown → PDF; JPG/PNG/WebP/TIFF/GIF/BMP → PDF; images → one PDF; PDF → JPG/PNG/WebP/TIFF (per page, chosen DPI and pages); PDF → SVG; PDF → TXT; PDF → HTML; PDF → DOCX; image ↔ image |
| Scan | Scan Document: camera capture or photo upload, live page outline, auto-capture, crop and perspective correction, four enhancement modes, multi-page PDF (see below) |
| Extract | OCR (searchable PDF that keeps the original scan under an invisible text layer, or plain text), Extract text, Extract images (native resolution), Compare two PDFs (text diff and visual pixel diff report) |
| Workspace | Drag-and-drop and multi-file upload with real byte progress, content-based type detection, previews and thumbnails, rename and remove, reorder, processing queue, cancel, retry, per-file download, ZIP of all results, "Continue with another tool", My Files and history, scanned-PDF detection with an OCR hint |

**PDF editor:** PDF.js rendering, thumbnail rail (drag to reorder, rotate, duplicate, delete), zoom (buttons, typed percentage, presets, fit to width, fit to page, reset, Ctrl/⌘ + wheel, trackpad and touch pinch, anchored on the cursor or fingers, re-rendered sharply), panning (hand tool, hold Space, middle button, drag empty page, one finger on touch), page navigation (buttons, typed number, PgUp/PgDn), text boxes (font, size, color, bold, alignment, Romanian/Central-European diacritics), **edit existing text**, highlight/underline/strikethrough by dragging over text, comments, freehand ink, rectangle, ellipse, line, arrow, images, signatures, erase area, select/move/resize/rotate, undo/redo (⌘Z/⇧⌘Z), duplicate (⌘D), nudge with arrow keys, autosave of the working state, export to a new PDF, and reopening the export to edit again.

**Scan Document** (`/scan`) runs entirely in the browser. OpenCV.js (Web Worker, so the preview never stutters) finds the page, flattens the perspective and recovers the page's true proportions; pdf-lib builds the PDF on the device. Nothing is uploaded unless you choose *Continue editing*. The camera needs HTTPS or localhost, and is released whenever it isn't in use.

The editor labels every object as one of three kinds:
- **Overlay**: text, images, signatures, shapes and drawings added on top. The original content is unchanged.
- **Annotation**: highlight, underline, strikethrough and comments, written as standard PDF annotations that other viewers can edit, unless you choose *Flatten on export*.
- **Content change**: *Edit text* and *Erase area* genuinely remove the original glyphs (or everything in the area) from the page through redaction, then place your replacement.

### Partially supported (works, with honest limits)

| Feature | Limitation |
|---|---|
| Edit existing text | The replacement uses DejaVu Sans/Serif/Mono at the detected size. Original embedded fonts can't be reused, and surrounding text doesn't reflow. Rotated text runs and scanned pages can't be edited (use OCR first). |
| PDF → Word | *Editable text* rebuilds paragraphs and headings only (no images, tables or columns). *Exact layout* (LibreOffice) keeps positions as text boxes and is less pleasant to edit. |
| PDF → HTML | Absolutely positioned text that mirrors the page. Not semantic HTML. |
| Office → PDF | As faithful as LibreOffice: very complex Word/PowerPoint layouts or fonts that aren't installed may shift. |
| HTML → PDF | Scripts and remote resources (images, CSS from URLs) are removed for security. Complex CSS is approximated. |
| Compress | Gains come from images. Text-only PDFs usually shrink very little, and the result says so. JBIG2/CCITT/JPEG2000 images are left untouched. |
| Repair | Rebuilds structure. It can't recover content bytes that are missing. |
| Remove blank pages | Visual heuristic with three sensitivities. |
| Resize pages | Links and annotations don't carry over when pages are re-laid out (you're told when this happens). |
| Fill forms | AcroForm only. XFA (LiveCycle) forms are detected and flagged. |
| PDF → TIFF | One TIFF per page (zipped), not a multi-page TIFF. |
| Scan: page detection | Needs all four page corners in view and some contrast with the surface. A white page on a white desk, or very busy patterned surfaces, can fail; you then place the corners by hand. Tested on synthetic photos with known geometry plus a simulated camera, so check it with your own camera and lighting. |
| Scan: automatic rotation | Sideways text is recognised reliably. Upside-down detection relies on Latin ascender/descender shapes, so it may leave non-Latin text or pages with little text as they are; the Rotate button fixes those in one tap. |
| Scan: resolution | Uses the camera's video stream (up to 4K where offered), not the phone's full-resolution still-photo mode. Uploading a photo taken with the camera app gives the most detail. |
| Zoom sharpness | Page bitmaps are capped to protect memory (48 MP on desktop, 16 MP on touch devices). On a high-density phone, very high zoom on a large page can look slightly softer. |
| OCR | English ships with the app. Other languages need their data files (see `OCR_LANG_PATH`). |

### Requires configuration

- **LibreOffice**: every Office/text → PDF conversion and exact-layout PDF → Word. Without it those tools show *Needs setup* and their buttons are disabled.
- **Extra OCR languages**: `OCR_LANG_PATH` plus `OCR_LANGUAGES`.
- **Malware scanning**: `CLAMAV_ADDRESS`.

### Not implemented (and never claimed)

- Cryptographic, certificate-based digital signatures (PAdES). *Sign PDF* places a visual signature and says so.
- Multi-server job queue. Jobs run in an in-process queue, so run **one instance** (see *Scaling* below).
- End-to-end encryption or zero-knowledge processing. The server must read files to transform them.

---

## Architecture

```
app/                      Next.js App Router pages + API routes
  api/files/…             streamed multipart upload, metadata, content, form fields
  api/jobs/…              create, status, cancel, retry, download (single / ZIP), "use output"
  api/capabilities        what this server can actually do (engines, languages, limits)
components/               UI: shell, ui kit, files, tool workspace, editor, organize, convert…
lib/
  tools/catalog.ts        every tool: inputs, options schema, labels (client-safe)
  conversion/catalog.ts   conversion registry: source → target, engine, limitations (client-safe)
  conversion/registry.ts  server implementation for each conversion id
  pdf/ops.ts              pdf-lib operations (pure: bytes in → bytes out)
  pdf/mu.ts               MuPDF operations: render, text, compress, encrypt, repair, redact…
  pdf/edit.ts             applies an editor document (3 passes: assemble → MuPDF → overlays)
  editor/model.ts         editor document model shared by browser and server
  scanner/                browser side of Scan Document: worker client, PDF export
  server/                 env, session, storage, content detection, job queue, LibreOffice, OCR, ClamAV
tests/
  unit, integration       Vitest: operations, conversions, API routes (real files)
  e2e                     Playwright: every tool through the real UI, downloads verified
public/scanner/           computer vision (vision.js) and its Web Worker; vision.js is also tested directly in Node
scripts/                  fixture generator, asset copier, LibreOffice fetcher
```

**Job lifecycle:** `queued → processing → completed | failed | cancelled`. Each job runs in its own randomly named folder. Uploaded filenames are never used as paths, outputs go through a filename sanitiser, and partial outputs are deleted on failure.

**Adding a conversion:** add an entry to `CONVERSIONS` in `lib/conversion/catalog.ts` and a function under the same id in `lib/conversion/registry.ts`. The server refuses to start if an entry has no implementation, and the UI picks the conversion up automatically.

**Adding a tool:** add a `ToolDef` to `lib/tools/catalog.ts` (its options render automatically) and a processor with the same id in `lib/server/processors.ts`.

---

## API

All endpoints are same-origin and bound to the anonymous `pf_sid` session cookie. The cookie is set on the first page load; API calls without it return `401`. Errors are JSON `{ "error": "human readable", "code": "machine_code" }`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/files` | `multipart/form-data`, field `file` (repeatable). Streams to disk, detects the type by content. Returns `{ files: StoredFile[], errors: {name, error, code}[] }` |
| `GET` | `/api/files` | List this session's files |
| `GET` / `PATCH` / `DELETE` | `/api/files/:id` | Metadata / rename `{name}` / delete now |
| `GET` | `/api/files/:id/content` | The file (PDFs and images inline, everything else as a download) |
| `GET` | `/api/files/:id/form` | AcroForm fields `{ fields, xfa }` |
| `POST` | `/api/jobs` | `{ tool, files: id[], options }` → `202 { job }` |
| `GET` | `/api/jobs` / `/api/jobs/:id` | List / status (`progress` is `0..1`, or `null` when it can't be measured) |
| `DELETE` | `/api/jobs/:id` | Cancel |
| `POST` | `/api/jobs/:id/retry` | Re-run a failed or cancelled job, optionally `{ options }` (passwords are never kept, so send them again) |
| `GET` | `/api/jobs/:id/download?i=N` | One result |
| `GET` | `/api/jobs/:id/download?all=1` | All results as a streamed ZIP |
| `POST` | `/api/jobs/:id/use` | `{ index }` → registers a result as a new file for chaining |
| `GET` | `/api/capabilities` | Engines, OCR languages, limits, conversion availability |

Tool ids and their options are defined in `lib/tools/catalog.ts`. For example, `compress` takes `{ level: "low" | "medium" | "high" }` and `convert` takes `{ to: "pdf" | "docx" | "png" | …, dpi?, pages? }`.

---

## Security and privacy

- Content-based type detection (magic bytes, OLE2/ZIP container checks, UTF-8 validation). SVG uploads are refused.
- Size limits, file-count limits, per-session rate limits, decompression-bomb guards (120 MP) and render-size caps.
- Session-bound access to files and downloads. Another session gets a plain `404`, so the server never confirms a file exists.
- Same-origin checks (`Origin` / `Sec-Fetch-Site`) on every state-changing request, plus `SameSite=Strict` httpOnly cookies.
- Downloads and previews carry `Content-Security-Policy: sandbox` and `nosniff`, so HTML/SVG outputs can't run scripts on the site.
- Passwords are deleted from job state when a job ends and are never logged. Logs record failure classes, never document contents.
- LibreOffice runs headless with a hard timeout and process-tree kill. HTML/Markdown inputs are stripped of scripts and remote URLs.
- Automatic cleanup after `RETENTION_MINUTES`, plus a full wipe of `DATA_DIR` subfolders on start (state lives in memory).
- Optional ClamAV scanning that fails closed.

---

## Tests

```bash
npm run fixtures
```
```bash
npm test
```
```bash
npm run test:e2e
```

- `npm run fixtures` generates the sample set in `tests/fixtures/generated`: PDFs (multi-page, rotated, landscape, blank page, image-heavy, scanned, form, encrypted, permission-restricted, damaged, garbage, empty), images, DOCX/DOC/ODT/RTF, PPTX/PPT/ODP, XLSX/XLS/ODS, CSV, Markdown, HTML, TXT, and corrupted/misnamed files. Legacy and ODF formats are produced by LibreOffice when it's available.
- `npm test` runs the Vitest suite: operations, computer vision on synthetic photos with known page corners, every conversion path, editor export, reopening and re-editing, API authorization, validation, retries, cancellation, cleanup and OCR.
- `npm run test:e2e` runs the Playwright suite in installed Microsoft Edge (`E2E_CHANNEL=chrome` for Chrome): every tool through the real UI, zoom gestures including real multi-touch pinch, the scanner driven by a simulated camera, the editor, signing, organize, forms, errors, a 60 MB upload and the mobile layout. Each test downloads and inspects the output file.

---

## Deploying

The app needs a long-running Node process with a writable disk and, for Office conversion, LibreOffice. That means a **container host or a VPS**. Serverless platforms such as Vercel or Netlify Functions are **not** suitable: no LibreOffice, short time limits, and no shared memory between invocations.

**Simplest: Render (Docker, from GitHub).** See `DEPLOY.md` for click-by-click steps. The included `render.yaml` blueprint builds the Dockerfile.

**Any VPS (Ubuntu):** install Docker, copy the project, run `docker compose up -d --build`, and put Caddy or Nginx in front for HTTPS:

```bash
docker compose up -d --build
```

### Scaling

The job queue and file index are in memory, so run **one instance**. Scale up with more CPU/RAM and `JOB_CONCURRENCY`. Running several instances would need shared storage plus a shared queue (for example Redis + BullMQ), which isn't implemented. MuPDF work runs on the server's main thread, so a very large job can briefly slow other requests. Moving processors to `worker_threads` is the next step for heavy traffic.

## License notes

MuPDF (`mupdf` npm package) is AGPL-3.0. If you offer Pagelyt as a network service, AGPL requires you to provide the corresponding source code to users, or to obtain a commercial MuPDF licence from Artifex. LibreOffice is MPL-2.0, Tesseract and OpenCV are Apache-2.0, pdf-lib and PDF.js are MIT/Apache-2.0, and DejaVu fonts are free.
