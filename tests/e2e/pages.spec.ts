import { test, expect } from "@playwright/test";
import { upload, runAndWait, downloadFirst, firstLines, pdf } from "./helpers";

test("home: upload suggests matching tools and continues into one", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Every document. One beautiful workspace." })).toBeVisible();
  await upload(page, "text-3pages.pdf");
  await expect(page.getByText("What would you like to do?")).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Compress PDF" }).first().click();
  await expect(page).toHaveURL(/\/tools\/compress\?files=/);
  await expect(page.getByText("text-3pages.pdf")).toBeVisible();
});

test("command palette search navigates to a tool", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").or(page.getByLabel("Search tools").last()).fill("water");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/tools\/watermark/);
});

test("organize: reorder via rotate/delete and save", async ({ page }) => {
  await page.goto("/tools/organize");
  await upload(page, "text-5pages.pdf");
  await expect(page.getByRole("button", { name: /^Page 1/ })).toBeVisible();
  await page.getByRole("button", { name: "Delete page" }).nth(1).click({ force: true });
  await page.getByRole("button", { name: "Rotate right" }).first().click({ force: true });
  await page.getByRole("button", { name: "Save PDF" }).click();
  await expect(page.getByText(/Your file is ready/)).toBeVisible({ timeout: 60_000 });
  const { bytes } = await downloadFirst(page, /^Download PDF$/);
  expect(firstLines(bytes)).toEqual(["PAGE 1", "PAGE 3", "PAGE 4", "PAGE 5"]);
  expect(pdf(bytes).loadPage(0).getObject().get("Rotate").valueOf()).toBe(90);
});

test("fill form: fields render and values are saved", async ({ page }) => {
  await page.goto("/tools/fill-form");
  await upload(page, "form.pdf");
  await page.getByLabel("fullName").fill("Ana Popescu");
  await page.getByLabel("country").selectOption("Japan");
  await runAndWait(page, "Save filled PDF");
  const { bytes } = await downloadFirst(page, /^Download PDF$/);
  const widgets = pdf(bytes).loadPage(0).getWidgets();
  expect(widgets.find((w) => w.getName() === "fullName")?.getValue()).toBe("Ana Popescu");
});

test("my files lists uploads and history; delete asks for confirmation", async ({ page }) => {
  await page.goto("/tools/rotate");
  await upload(page, "text-1page.pdf");
  await runAndWait(page, "Rotate PDF");
  await page.goto("/files");
  await expect(page.getByText("text-1page.pdf").first()).toBeVisible();
  await page.getByRole("button", { name: "Delete text-1page.pdf" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("radio", { name: /History/ }).click();
  await expect(page.getByText("Rotate PDF").first()).toBeVisible();
});

test("settings: theme switch applies immediately", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("radio", { name: /Dark/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("radio", { name: /Auto/ }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
});

test("mobile: navigation drawer opens and links work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "All Tools" }).click();
  await expect(page).toHaveURL(/\/tools$/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
