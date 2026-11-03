import { test, expect, type Page } from "@playwright/test";
import { upload } from "./helpers";

const NAV = [
  ["Home", "/"],
  ["All Tools", "/tools"],
  ["PDF Editor", "/editor"],
  ["Smart Scanner", "/scan"],
  ["AI Workspace", "/ai"],
  ["My Documents", "/files"],
  ["Pricing", "/pricing"],
  ["Settings", "/settings"],
] as const;

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return errors;
}

test("brand: title, logo, favicon and manifest", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Pagelyt — Every page\. In its place\./);
  await expect(page.getByRole("banner").getByRole("link", { name: "Pagelyt home" })).toBeVisible();
  await expect(page.getByText("Every page. In its place.").first()).toBeVisible();
  const icon = await page.locator('link[rel="icon"]').first().getAttribute("href");
  expect(icon).toBeTruthy();
  expect((await request.get(icon!)).status()).toBe(200);
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.name).toBe("Pagelyt");
  for (const i of manifest.icons) expect((await request.get(i.src)).status()).toBe(200);
  for (const f of ["pagelyt-logo-light.svg", "pagelyt-logo-dark.svg", "pagelyt-mark.svg", "pagelyt-mark-dark.svg", "pagelyt-app-icon.svg"]) {
    expect((await request.get(`/brand/${f}`)).status()).toBe(200);
  }
});

test("desktop navigation bar reaches all eight sections without errors", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const [label, href] of NAV) {
    await nav.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${href === "/" ? "/$" : href}`));
    await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("main")).toBeVisible();
  }
  expect(errors).toEqual([]);
});

for (const [name, size] of [["tablet", { width: 820, height: 1180 }], ["phone", { width: 390, height: 844 }]] as const) {
  test(`${name}: drawer navigation and no sideways scrolling`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    for (const [label, href] of NAV.slice(1)) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await page.getByRole("dialog").getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(href));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    }
  });
}

test("every footer link resolves", async ({ page, request }) => {
  await page.goto("/");
  const hrefs = await page.locator("footer a").evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!))]);
  expect(hrefs.length).toBeGreaterThan(10);
  for (const h of hrefs) expect((await request.get(h.split("#")[0])).status(), h).toBe(200);
});

test("homepage: functional search, categories, AI section, pricing", async ({ page }) => {
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Search PDF tools" });
  await search.fill("translat");
  await expect(page.getByRole("option").first()).toContainText("Translate");
  await search.fill("zzzz");
  await expect(page.getByText("No tools match")).toBeVisible();
  await search.fill("compress");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/tools\/compress/);

  await page.goto("/");
  const allTools = page.locator("#all-tools");
  for (const label of ["Organize PDF", "Optimize PDF", "Convert PDF", "Edit PDF", "Scan Documents", "Sign and Protect", "AI Document Tools"]) {
    await allTools.getByRole("radio", { name: label }).click();
    await expect(allTools.getByRole("link").first()).toBeVisible();
  }
  await allTools.getByRole("radio", { name: "Scan Documents" }).click();
  await expect(allTools.getByRole("link", { name: /Scan Document/ })).toBeVisible();

  await expect(page.locator("#ai").getByRole("link", { name: /Summarize/ })).toBeVisible();
  await page.locator("#ai").getByRole("link", { name: /Ask your PDF/ }).click();
  await expect(page).toHaveURL(/\/ai\?task=ask/);
  await expect(page.getByRole("heading", { name: "Understand any document in seconds" })).toBeVisible();

  await page.goto("/");
  await expect(page.locator("#pricing").getByText("Free").first()).toBeVisible();
  await page.locator("#pricing").getByRole("link", { name: "Start now" }).click();
  await expect(page).toHaveURL(/\/tools$/);
});

test("homepage: dropped files suggest tools, survive a round trip, and show as recent documents", async ({ page }) => {
  await page.goto("/");
  await upload(page, "text-3pages.pdf");
  await expect(page.getByText("What would you like to do?")).toBeVisible();
  // the AI tools link with both the task and the file
  const summarize = page.getByTestId("suggestions").getByRole("link", { name: "Summarize" });
  await expect(summarize).toHaveAttribute("href", /\/ai\?task=summarize&files=/);
  await page.getByTestId("suggestions").getByRole("link", { name: "Merge PDF" }).click();
  await expect(page).toHaveURL(/\/tools\/merge\?files=/);
  await page.goBack();
  await expect(page.getByText("What would you like to do?")).toBeVisible();
  await page.reload();
  await expect(page.locator("#recent").getByText("text-3pages.pdf")).toBeVisible();
});
