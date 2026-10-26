# Put Paperflow online (permanent public URL)

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
   - **Keep "Keep this code private" unticked (public)** unless you have a commercial MuPDF licence. Paperflow uses MuPDF, which is AGPL-licensed, and a public repository is the simplest way to meet its requirement to share your source code with users of a public website.
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
