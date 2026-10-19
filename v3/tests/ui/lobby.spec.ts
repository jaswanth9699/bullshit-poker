import { test, expect } from "@playwright/test";

test("lobby names follow the roster, readiness is accurate, and invitations stay accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Create Table/ }).click();
  await page.getByPlaceholder("Enter your name").fill("Nameplate Host");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByPlaceholder("Choose a 4-digit PIN").fill("2468");
  await page.getByRole("button", { name: "Create Room" }).click();
  const progress = page.getByRole("progressbar", { name: "Players ready" });
  const labels = page.locator("[data-seat-name]");
  await expect(progress).toHaveAttribute("value", "0");
  await expect(progress).toHaveAttribute("max", "1");
  await expect(labels).toHaveText(["Nameplate Host"]);
  await expect(labels).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Invite friends" }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Share room" })).toHaveCount(0);
  await page.getByRole("button", { name: "Invite friends" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Invite friends" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Add Bot", exact: true }).click();
  await expect(progress).toHaveAttribute("max", "2");
  await expect(progress).toHaveAttribute("value", "1");
  await expect(labels).toHaveCount(2);
  const names = await page
    .locator(".lobby-roster-name strong")
    .allTextContents();
  expect(await labels.allTextContents()).toEqual(names);
  await page.getByRole("button", { name: "I am ready" }).click();
  await expect(progress).toHaveAttribute("value", "2");
  await expect(
    page.getByRole("button", { name: "Start", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Ready", exact: true }).click();
  await expect(progress).toHaveAttribute("value", "1");
  await expect(
    page.getByRole("button", { name: "Start", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: `Remove ${names[1]}`, exact: true })
    .click();
  await expect(labels).toHaveCount(1);
  await expect(progress).toHaveAttribute("max", "1");
  await expect(progress).toHaveAttribute("value", "0");
  const scene = page.locator('.living-table-scene[data-variant="lobby"]');
  const canvas = scene.locator("canvas");
  const movingFrame = await canvas.screenshot();
  await page.waitForTimeout(500);
  expect((await canvas.screenshot()).equals(movingFrame)).toBe(false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(scene).toHaveAttribute("data-quality", "reduced");
  await expect(page.locator(".lobby-roster-row")).toHaveCSS("animation-name", "none");
  const stillFrame = await canvas.screenshot();
  await page.waitForTimeout(500);
  expect((await canvas.screenshot()).equals(stillFrame)).toBe(true);
  await expect(labels).toBeVisible();
  await page.getByRole("button", { name: "Leave game" }).click();
  await page.getByRole("button", { name: "Yes, leave" }).click();
});
