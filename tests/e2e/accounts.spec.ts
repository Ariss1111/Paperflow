import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { FIX, pdf, texts } from "./helpers";
import { makeAgreement } from "../helpers/docs";

// Accounts and My Documents in a real browser: sign-up with email confirmation, the library,
// versions from the PDF editor, sharing, a second device, downloads, trash and account deletion.
// Needs the server to have a dev inbox (development, or DEV_MAILBOX=1).

const PASSWORD = "correct horse battery";
const unique = (name: string) => `${name}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;

async function mailFor(page: Page, to: string, subject: RegExp) {
  let link = "";
  await expect
    .poll(async () => {
      const r = await page.request.get("/api/dev/mail");
      const m = ((await r.json()).messages as { to: string; subject: string; text: string }[]).find((x) => x.to === to && subject.test(x.subject));
      link = m ? /(https?:\/\/\S+)/.exec(m.text)![1] : "";
      return link;
    })
    .not.toBe("");
  return new URL(link).pathname + new URL(link).search;
}

async function signUp(page: Page, email: string, name = "Ana Pop") {
  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.goto(await mailFor(page, email, /Confirm your Pagelyt email/));
  await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
  await expect(page).toHaveURL(/\/files$/, { timeout: 15_000 });
}

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/files$/);
}

async function uploadToLibrary(page: Page, ...files: string[]) {
  await page.getByTestId("library-upload").setInputFiles(files);
  await expect(page.getByText(new RegExp(`${files.length} documents? saved`))).toBeVisible({ timeout: 60_000 });
}

const doc = (page: Page, name: string) => page.getByTestId("doc").filter({ hasText: name });
async function docAction(page: Page, name: string, action: string | RegExp) {
  await doc(page, name).getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

test.beforeAll(async () => {
  fs.writeFileSync(path.join(FIX, "agreement-v1.pdf"), await makeAgreement(1));
});

test("signed out: tools work without an account, and My Documents invites you to create one", async ({ page }) => {
  await page.goto("/files");
  await expect(page.getByRole("region", { name: "Keep your documents" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
  expect((await page.request.get("/api/docs")).status()).toBe(401);
});

test("sign up, confirm, organise, sync preferences, download, trash", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const email = unique("ana");
  await signUp(page, email);
  await expect(page.getByRole("button", { name: `Account: ${email}` })).toBeVisible();

  await uploadToLibrary(page, path.join(FIX, "text-3pages.pdf"), path.join(FIX, "photo.png"));
  await expect(page.getByTestId("doc")).toHaveCount(2);
  await expect(page.getByTestId("storage-meter")).toContainText("2 documents");

  // folders, move, rename, favorite
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Invoices");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("folder").filter({ hasText: "Invoices" })).toBeVisible();
  await docAction(page, "text-3pages.pdf", "Move to…");
  await page.getByRole("dialog").getByRole("button", { name: "Invoices" }).click();
  await expect(page.getByText("Moved to Invoices.")).toBeVisible();
  await expect(page.getByTestId("doc")).toHaveCount(1);
  await page.getByTestId("folder").filter({ hasText: "Invoices" }).getByRole("button", { name: "Invoices", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Folder path" })).toContainText("Invoices");
  await docAction(page, "text-3pages.pdf", "Rename");
  await page.getByLabel("Name", { exact: true }).fill("March invoice");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(doc(page, "March invoice.pdf")).toBeVisible();
  await docAction(page, "March invoice.pdf", "Add to Favorites");
  await page.getByRole("button", { name: "Favorites" }).click();
  await expect(page.getByTestId("doc")).toHaveCount(1);
  await expect(doc(page, "March invoice.pdf")).toBeVisible();

  // search reaches into folders; sort by size
  await page.getByRole("button", { name: "All documents" }).first().click();
  await page.getByLabel("Search documents").fill("march");
  await expect(page.getByTestId("doc")).toHaveCount(1);
  await page.getByLabel("Search documents").fill(".p");
  await expect(page.getByTestId("doc")).toHaveCount(2);
  await page.getByLabel("Sort by").selectOption("size");
  const names = await page.getByTestId("doc").locator("span.font-medium").allTextContents();
  const sizes = { "March invoice.pdf": fs.statSync(path.join(FIX, "text-3pages.pdf")).size, "photo.png": fs.statSync(path.join(FIX, "photo.png")).size };
  expect(names).toEqual(Object.entries(sizes).sort((a, b) => b[1] - a[1]).map(([n]) => n));

  // the list layout is a preference that follows the account to another device
  await page.getByRole("button", { name: "List view" }).click();
  const laptop: BrowserContext = await browser.newContext();
  const other = await laptop.newPage();
  await signIn(other, email);
  await expect(other.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
  await expect(other.getByTestId("doc")).toHaveCount(1); // the photo, at the top level
  // a change on one device shows up on the other
  await docAction(page, "photo.png", "Rename");
  await page.getByLabel("Name", { exact: true }).fill("Receipt photo");
  await page.getByRole("button", { name: "Rename" }).click();
  await other.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(doc(other, "Receipt photo.png")).toBeVisible();
  await laptop.close();

  // download gives back the exact file
  await page.getByLabel("Search documents").fill("");
  const [dl] = await Promise.all([page.waitForEvent("download"), docAction(page, "Receipt photo.png", "Download")]);
  expect(dl.suggestedFilename()).toBe("Receipt photo.png");
  expect(fs.readFileSync((await dl.path())!).equals(fs.readFileSync(path.join(FIX, "photo.png")))).toBe(true);

  // trash, then delete forever
  await docAction(page, "Receipt photo.png", "Move to Trash");
  await expect(page.getByText(/moved to the Trash/)).toBeVisible();
  await page.getByRole("button", { name: "Trash" }).first().click();
  await docAction(page, "Receipt photo.png", "Delete forever");
  await page.getByRole("button", { name: "Delete forever" }).click();
  await expect(page.getByText("The Trash is empty")).toBeVisible();
  await expect(page.getByTestId("storage-meter")).toContainText("1 document");
});

test("open a saved PDF in the editor, save a new version, see the history", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, unique("ed"));
  await uploadToLibrary(page, path.join(FIX, "agreement-v1.pdf"));
  await doc(page, "agreement-v1.pdf").getByRole("button", { name: /agreement-v1\.pdf/ }).first().click();
  await expect(page).toHaveURL(/\/documents\//);
  const docUrl = page.url();
  await expect(page.getByTestId("doc-viewer").locator("[data-page]")).toHaveCount(1);
  await expect(page.getByTestId("doc-viewer").locator("canvas")).toHaveCSS("opacity", "1");

  await page.getByRole("button", { name: "Edit in PDF Editor" }).click();
  await expect(page).toHaveURL(/\/editor\?files=.*doc=/);
  const p1 = page.locator("[data-page-key]").first();
  await expect(p1.locator("canvas")).toHaveClass(/opacity-100/);
  const box = (await p1.boundingBox())!;
  await page.getByRole("button", { name: /^Add text/ }).click();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.keyboard.type("Approved by Ana");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved version 2 of agreement-v1.pdf.")).toBeVisible({ timeout: 120_000 });

  await page.goto(docUrl);
  await page.getByRole("radio", { name: "History" }).click();
  await expect(page.getByTestId("versions").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("versions")).toContainText("Edited in the PDF editor");
  await expect(page.getByTestId("activity")).toContainText("Saved version 2");
  // the current file has the edit; version 1 doesn't
  // the header's Download is the current version (each version row has its own)
  const [cur] = await Promise.all([page.waitForEvent("download"), page.locator("main header").getByRole("link", { name: "Download", exact: true }).click()]);
  expect(texts(new Uint8Array(fs.readFileSync((await cur.path())!)))[0]).toContain("Approved by Ana");
  const [v1] = await Promise.all([page.waitForEvent("download"), page.getByTestId("versions").locator("li").nth(1).getByRole("link", { name: "Download" }).click()]);
  expect(v1.suggestedFilename()).toBe("agreement-v1 (version 1).pdf");
  expect(texts(new Uint8Array(fs.readFileSync((await v1.path())!)))[0]).not.toContain("Approved by Ana");
  // restore version 1 as version 3
  await page.getByTestId("versions").locator("li").nth(1).getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Version 1 restored as version 3.")).toBeVisible();
});

test("share with a password and view only, open it signed out, then revoke", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signUp(page, unique("sh"));
  await uploadToLibrary(page, path.join(FIX, "agreement-v1.pdf"));
  await docAction(page, "agreement-v1.pdf", "Share…");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Require a password").click();
  await dialog.getByLabel("Link password").fill("open sesame");
  await dialog.getByLabel("Allow downloading").click();
  await dialog.getByLabel("Link stops working").selectOption("1");
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog.getByText("Link created")).toBeVisible();
  const row = dialog.getByTestId("share-row").first();
  await expect(row).toContainText("Password");
  await expect(row).toContainText("View only");
  const link = await row.getByLabel("Share link").inputValue();
  expect(link).toMatch(/\/s\/[\w-]{22}$/);

  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto(link);
  await expect(guest.getByRole("heading", { name: "This document is protected" })).toBeVisible();
  await guest.getByLabel("Password").fill("wrong one");
  await guest.getByRole("button", { name: "Open" }).click();
  await expect(guest.getByText("That password isn't right.")).toBeVisible();
  await guest.getByLabel("Password").fill("open sesame");
  await guest.getByRole("button", { name: "Open" }).click();
  await expect(guest.getByRole("heading", { name: "agreement-v1.pdf" })).toBeVisible();
  await expect(guest.getByText("View only")).toBeVisible();
  await expect(guest.getByRole("link", { name: "Download" })).toHaveCount(0);
  await expect(guest.getByTestId("doc-viewer").locator("canvas")).toHaveCSS("opacity", "1");
  // the download address refuses too, not just the button
  const id = link.split("/s/")[1];
  expect((await guest.request.get(`/api/s/${id}/file?download=1`, { maxRedirects: 0 })).status()).toBe(403);

  // revoke
  await row.getByRole("button", { name: "Revoke access" }).click();
  await expect(page.getByText("Access revoked")).toBeVisible();
  await guest.reload();
  await expect(guest.getByRole("heading", { name: "This link isn't available" })).toBeVisible();
  await guestCtx.close();
});

test("another account can't open your document; password reset; account deletion", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const email = unique("own");
  await signUp(page, email);
  await uploadToLibrary(page, path.join(FIX, "text-1page.pdf"));
  await doc(page, "text-1page.pdf").getByRole("button", { name: /text-1page\.pdf/ }).first().click();
  await expect(page).toHaveURL(/\/documents\/[\w-]{22}$/);
  const docUrl = page.url();

  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await signUp(other, unique("eve"), "Eve");
  await other.goto(docUrl);
  await expect(other.getByText("Can't open this document")).toBeVisible();
  await expect(other.getByText("This document doesn't exist or you don't have access to it.")).toBeVisible();
  await otherCtx.close();

  // forgot password → email link → new password → signed in
  const fresh = await browser.newContext();
  const p2 = await fresh.newPage();
  await p2.goto("/reset");
  await p2.getByLabel("Email").fill(email);
  await p2.getByRole("button", { name: "Send reset link" }).click();
  await expect(p2.getByText(/a reset link is on its way/)).toBeVisible();
  await p2.goto(await mailFor(p2, email, /Reset your Pagelyt password/));
  await p2.getByLabel("New password").fill("a brand new password");
  await p2.getByRole("button", { name: "Save password" }).click();
  await expect(p2).toHaveURL(/\/files$/);
  await expect(p2.getByTestId("doc")).toHaveCount(1);
  await fresh.close();
  // the reset signed out the first browser
  await page.reload();
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();

  // delete the account
  await signIn(page, email, "a brand new password");
  await page.goto("/account");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.getByLabel("Your password").fill("a brand new password");
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a brand new password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
});

test("a tool's result can be saved to My Documents", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, unique("tool"));
  await page.goto("/tools/compress");
  await page.locator('input[type="file"]').first().setInputFiles(path.join(FIX, "text-3pages.pdf"));
  await page.getByRole("button", { name: /^Compress/ }).click();
  await expect(page.getByText("Your file is ready")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: /^Save .* to My Documents$/ }).click();
  await expect(page.getByText(/saved to My Documents/)).toBeVisible();
  await page.goto("/files");
  await expect(page.getByTestId("doc")).toHaveCount(1);
  const name = (await page.getByTestId("doc").locator("span.font-medium").textContent())!;
  const [dl] = await Promise.all([page.waitForEvent("download"), docAction(page, name, "Download")]);
  expect(pdf(new Uint8Array(fs.readFileSync((await dl.path())!))).countPages()).toBe(3);
});
