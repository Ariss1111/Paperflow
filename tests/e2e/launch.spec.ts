import { test, expect } from "@playwright/test";

// Launch checks: every public page fits a phone screen, has its search metadata, runs under the
// Content-Security-Policy without violations, and the SEO files and error pages work.

const PUBLIC = ["/", "/tools", "/tools/merge", "/editor", "/scan", "/ai", "/convert", "/files", "/pricing", "/privacy", "/terms", "/contact", "/signin", "/signup", "/reset", "/settings"];

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 740 }, isMobile: false, hasTouch: true });

  for (const path of PUBLIC) {
    test(`${path} fits the screen and runs without errors`, async ({ page }) => {
      const problems: string[] = [];
      page.on("pageerror", (e) => problems.push(`error: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text())) problems.push(`csp: ${m.text()}`);
      });
      if (path === "/scan") await page.addInitScript(() => (navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("none", "NotFoundError"))));
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      // nothing scrolls sideways
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      // the menu button stands in for the full navigation
      if (!["/editor", "/scan"].includes(path)) await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
      expect(problems).toEqual([]);
    });
  }
});

test("pages have titles, descriptions and social previews", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Pagelyt — Every page. In its place.");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Scan, edit, convert, sign and organize/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/opengraph-image\.png/);
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute("content", "Pagelyt");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  for (const [path, title] of [["/tools/merge", "Merge PDF · Pagelyt"], ["/privacy", "Privacy & Security · Pagelyt"], ["/contact", "Contact · Pagelyt"]]) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{20,}/);
  }
  // private pages stay out of search results
  await page.goto("/files");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const og = await page.request.get("/opengraph-image.png");
  expect(og.headers()["content-type"]).toBe("image/png");
});

test("robots.txt and sitemap.xml", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/Disallow: \/api\//);
  expect(robots).toMatch(/Disallow: \/s\//);
  expect(robots).toMatch(/Sitemap: https?:\/\/.+\/sitemap\.xml/);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const p of ["/tools/merge", "/tools/compress", "/privacy", "/contact"]) expect(sitemap).toContain(`${p}</loc>`);
  expect(sitemap).not.toContain("/account");
});

test("contact page publishes nothing it wasn't given", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.getByRole("heading", { name: "Contact" })).toBeVisible();
  // either the configured address or an honest note: never a made-up one
  const text = await page.locator("main").innerText();
  expect(/mailto:/.test(await page.content()) || /hasn't been published/.test(text)).toBe(true);
});

test("unknown pages get a helpful 404", async ({ page }) => {
  const res = await page.goto("/this-page-does-not-exist");
  expect(res!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This page doesn't exist" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "All tools", exact: true }).click();
  await expect(page).toHaveURL(/\/tools$/);
});

test("security headers and caching", async ({ request }) => {
  const home = await request.get("/");
  const h = home.headers();
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'(;| )/);
  expect(h["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
  expect(h["content-security-policy"]).toMatch(/object-src 'none'/);
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["strict-transport-security"]).toMatch(/max-age=31536000/);
  expect(h["x-powered-by"]).toBeUndefined();
  // only the vision worker may evaluate code
  expect((await request.get("/scanner/worker.js")).headers()["content-security-policy"]).toMatch(/'unsafe-eval'/);
  expect((await request.get("/opencv/opencv.js", { headers: { range: "bytes=0-10" } })).headers()["cache-control"]).toMatch(/max-age=604800/);
  // no cross-origin access to the API
  const api = await request.get("/api/capabilities", { headers: { origin: "https://evil.example" } });
  expect(api.headers()["access-control-allow-origin"]).toBeUndefined();
  const post = await request.post("/api/auth/login", { headers: { origin: "https://evil.example" }, data: { email: "a@b.co", password: "x" } });
  expect(post.status()).toBe(403);
});
