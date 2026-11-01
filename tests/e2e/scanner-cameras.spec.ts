import { test, expect } from "@playwright/test";

// A separate file: Chromium's file-based fake camera exposes a single device, this one needs two.
test.use({ channel: "chrome", launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream=device-count=2"] }, permissions: ["camera"] });

test("prefers the rear camera and can switch to another device", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __constraints: MediaStreamConstraints[] };
    w.__constraints = [];
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => {
      w.__constraints.push(c!);
      return orig(c);
    };
  });
  await page.goto("/scan");
  const deviceId = () => page.evaluate(() => (document.querySelector("video")?.srcObject as MediaStream | null)?.getVideoTracks()[0]?.getSettings().deviceId ?? null);
  await expect.poll(deviceId).not.toBeNull();
  const facing = await page.evaluate(() => JSON.stringify((window as unknown as { __constraints: MediaStreamConstraints[] }).__constraints[0]));
  expect(facing).toContain('"facingMode":{"ideal":"environment"}');

  const first = await deviceId();
  await page.getByRole("button", { name: "Switch camera" }).click();
  await expect.poll(deviceId).not.toBe(first);
  await expect.poll(deviceId).not.toBeNull();
  await expect.poll(() => page.evaluate(() => document.querySelector("video")?.videoWidth ?? 0)).toBeGreaterThan(0);
});
