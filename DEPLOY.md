# Put Pagelyt online (permanent public URL)

This guide uses **GitHub** (to hold the code) and **Render** (to run it). Render builds the included `Dockerfile`, which installs LibreOffice, so every tool works online the same way it does on your computer. You'll end up with a URL like `https://paperflow-xxxx.onrender.com` that anyone can open.

Time needed: about 20 minutes, most of it waiting for the first build.

---

## Step 1 — Put the code on GitHub

You don't need the command line for this. GitHub Desktop does it with clicks.

1. Create a free account at **https://github.com** (skip if you have one).
2. Install **GitHub Desktop** from **https://desktop.github.com** and sign in with that account.
3. In GitHub Desktop: **File → Add local repository…** → choose `C:\Users\Ariss\Documents\Paperflow`.
4. It will say *"This directory does not appear to be a Git repository"*. Click **create a repository**, keep the name `Paperflow`, and click **Create repository**.
   - The included `.gitignore` already leaves out the large local-only folders (`.tools` with Node and LibreOffice, `node_modules`, `.next`), so the upload stays small.
5. Click **Publish repository** (top bar).
   - **Keep "Keep this code private" unticked (public)** unless you have a commercial MuPDF licence. Pagelyt uses MuPDF, which is AGPL-licensed, and a public repository is the simplest way to meet its requirement to share your source code with users of a public website.
6. Click **Publish repository**. Your code is now at `https://github.com/<your-username>/Paperflow`.

## Step 2 — Deploy on Render

1. Go to **https://render.com** and click **Get Started**. Choose **Sign up with GitHub** and allow access.
2. In the Render dashboard, click **New +** → **Blueprint**.
3. Under *Connect a repository*, pick **Paperflow** (if it isn't listed, click *Configure account* and give Render access to that repository).
4. Render reads `render.yaml` and shows one service called **paperflow**. Click **Apply** (or **Deploy Blueprint**).
5. Wait for the build. The first one takes **about 10–15 minutes** because it installs LibreOffice. You can watch the log; it ends with something like `Ready on http://0.0.0.0:10000`, and the status turns **Live**.
6. At the top of the service page you'll see your public URL, e.g. **`https://paperflow-ab12.onrender.com`**. That's your permanent link. Share it with anyone.

## Step 3 — Check it works

Open your URL and try:

1. **Compress PDF** with any PDF: you should see the before/after sizes and a download.
2. **Word to PDF** with a `.docx`: this proves LibreOffice is working online.
3. **PDF Editor**: add a text box, click **Export PDF**, then download it.

You can also open `https://<your-url>/api/capabilities`. It should show `"libreoffice":{"available":true,…}`.

---

## Turn on the AI tools (optional)

On Render: open the **paperflow** service → **Environment** → **Add Environment Variable**. Name: `ANTHROPIC_API_KEY`, value: your key from https://console.anthropic.com. Save; Render restarts the service. Anthropic bills AI usage to that key.

## Turn on accounts and saved documents

Accounts keep their data in two outside services, both free to start. The data then survives Render's restarts and deploys, which wipe the server's own disk.

**1. Database: Neon (Postgres).**
1. Sign up at https://neon.tech and create a project (any region close to your Render region).
2. On the project dashboard, copy the **connection string**. It looks like `postgres://user:password@ep-....neon.tech/neondb?sslmode=require`.
3. In Render → **Environment**, add `DATABASE_URL` with that value.

**2. File storage: Cloudflare R2.**
1. Sign up at https://dash.cloudflare.com → **R2** → **Create bucket**. Name it, for example, `pagelyt-documents`. Leave it **private**: never turn on public access.
2. Under **R2 → Manage R2 API Tokens**, create a token with **Object Read & Write** on that bucket. Copy the **Access Key ID**, the **Secret Access Key** and the **S3 endpoint** (`https://<account-id>.r2.cloudflarestorage.com`).
3. In the bucket → **Settings → CORS policy**, add this, with your site's address. The document viewer loads files from R2 directly, through short-lived signed links.
   ```json
   [{ "AllowedOrigins": ["https://your-site.onrender.com"], "AllowedMethods": ["GET"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
   ```
4. In Render → **Environment**, add `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`.

**3. Email (for confirming addresses and resetting passwords).** Use any SMTP service. For Gmail, turn on 2-step verification, create an **app password** at https://myaccount.google.com/apppasswords, then add these variables:
- `SMTP_HOST` = `smtp.gmail.com`
- `SMTP_PORT` = `465`
- `SMTP_USER` = your Gmail address
- `SMTP_PASSWORD` = the app password
- `MAIL_FROM` = `Pagelyt <you@gmail.com>`

Brevo, Resend and Postmark also give SMTP settings.

**4. Site settings.** Add these variables:
- `APP_URL`: your address, for example `https://your-site.onrender.com`.
- `AUTH_SECRET`: a long random value. Render's **Generate** button makes one. It signs download links, so keep it secret and don't change it once the site is in use.

**5. Google sign-in (optional).**
1. Go to https://console.cloud.google.com → **APIs & Services**.
2. Set up the **OAuth consent screen** (External, your app name and email).
3. Go to **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.
4. Under **Authorised redirect URIs**, add `https://your-site.onrender.com/api/auth/google/callback`.
5. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. "Continue with Google" appears once both are set.

Save. Render restarts the service, and **Sign in** in the top bar now works. Until these are set, the PDF tools still work without accounts. Sign-up then explains that email isn't set up yet.

Limits you can change (Environment):
- `STORAGE_QUOTA_MB`: per account, default 1024.
- `MAX_DOCUMENT_MB`: per document, default 100.
- `VERSIONS_KEPT`: per document, default 10.
- `TRASH_DAYS`: default 30.
- `SESSION_DAYS`: how long a sign-in lasts, default 30.

## Good to know

**The free plan** is fine for trying it out, but:
- The service **sleeps after about 15 minutes without visitors**. The next visit takes about a minute to wake it.
- It has **512 MB of memory**. Big Word/PowerPoint files or long OCR jobs can fail with an out-of-memory error.
- Uploaded files are temporary anyway (deleted after 60 minutes) and are also cleared whenever the service restarts or sleeps.

For a dependable public site, open the service → **Settings → Instance Type** and choose an instance with **at least 2 GB RAM** (Render calls it *Standard* at the time of writing — check their current pricing). Then raise `JOB_CONCURRENCY` to `2` under **Environment**.

**Updating the site:** change files on your computer, then in GitHub Desktop write a short summary, click **Commit to main** and then **Push origin**. Render rebuilds and redeploys automatically.

**Your own domain** (optional): service → **Settings → Custom Domains → Add**, then add the DNS record Render shows you at your domain registrar. HTTPS is set up automatically.

**Settings you can change** (service → **Environment**): `RETENTION_MINUTES`, `MAX_UPLOAD_MB`, `JOB_CONCURRENCY`, `NEXT_PUBLIC_APP_NAME` (the name shown in the app; changing it needs a redeploy). The full list is in `.env.example`.

**Before inviting the public:** replace the placeholder text in `app/terms/page.tsx` with your own terms and a contact address.

---

## Alternatives

- **Railway** (https://railway.app) or **Fly.io** (https://fly.io): both deploy the same `Dockerfile` from your GitHub repository. Choose at least 1–2 GB RAM.
- **Your own server (VPS)** with Docker:
  ```bash
  docker compose up -d --build
  ```
  then put Caddy or Nginx in front for HTTPS on your domain.
- **Vercel / Netlify will not work**: they can't run LibreOffice or long-running conversion jobs.

Run **one instance only**. The job queue lives in memory (see README → *Scaling*).
