# Paperflow

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

## System requirements

| Component | Needed for | Notes |
|---|---|---|
| Node.js 22 LTS | everything | Next.js server, all PDF processing |
| LibreOffice 7.4+ | Word/PowerPoint/Excel/ODF/RTF/CSV/TXT/HTML/Markdown → PDF, exact-layout PDF → Word | Found automatically in `.tools/libreoffice`, standard install paths, `PATH`, or `SOFFICE_PATH` |
| Fonts | conversion fidelity | Install fonts your documents use; missing fonts are substituted |
| ClamAV (`clamd`) | optional malware scanning | Set `CLAMAV_ADDRESS=host:3310` |
| ~1–2 GB RAM | LibreOffice + OCR | 512 MB works for PDF tools; large Office files may fail |

Everything else ships as npm packages: MuPDF (WASM), pdf-lib, sharp/libvips, tesseract.js with English OCR data, PDF.js and DejaVu fonts.

## Configuration (`.env`)

Copy `.env.example` to `.env`. All values are optional.

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_APP_NAME` | Paperflow | Product name in the UI |
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
| Extract | OCR (searchable PDF that keeps the original scan under an invisible text layer, or plain text), Extract text, Extract images (native resolution), Compare two PDFs (text diff and visual pixel diff report) |
| Workspace | Drag-and-drop and multi-file upload with real byte progress, content-based type detection, previews and thumbnails, rename and remove, reorder, processing queue, cancel, retry, per-file download, ZIP of all results, "Continue with another tool", My Files and history, scanned-PDF detection with an OCR hint |

**PDF editor:** PDF.js rendering, thumbnail rail (drag to reorder, rotate, duplicate, delete), zoom (fit width, fit page, presets, ⌘+/⌘−/⌘0), page navigation (PgUp/PgDn), text boxes (font, size, color, bold, alignment, Romanian/Central-European diacritics), **edit existing text**, highlight/underline/strikethrough by dragging over text, comments, freehand ink, rectangle, ellipse, line, arrow, images, signatures, erase area, select/move/resize/rotate, undo/redo (⌘Z/⇧⌘Z), duplicate (⌘D), nudge with arrow keys, autosave of the working state, export to a new PDF, and reopening the export to edit again.

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
  server/                 env, session, storage, content detection, job queue, LibreOffice, OCR, ClamAV
tests/
  unit, integration       Vitest: operations, conversions, API routes (real files)
  e2e                     Playwright: every tool through the real UI, downloads verified
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
- `npm test` runs 98 Vitest tests: operations, every conversion path, editor export, reopening and re-editing, API authorization, validation, retries, cancellation, cleanup and OCR.
- `npm run test:e2e` runs 50 Playwright tests in installed Microsoft Edge (`E2E_CHANNEL=chrome` for Chrome): every tool through the real UI, the editor, signing, organize, forms, errors, a 60 MB upload and the mobile layout. Each test downloads and inspects the output file.

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

MuPDF (`mupdf` npm package) is AGPL-3.0. If you offer Paperflow as a network service, AGPL requires you to provide the corresponding source code to users, or to obtain a commercial MuPDF licence from Artifex. LibreOffice is MPL-2.0, Tesseract is Apache-2.0, pdf-lib and PDF.js are MIT/Apache-2.0, and DejaVu fonts are free.
