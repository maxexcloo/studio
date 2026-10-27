import { expect, test } from "@playwright/test";
import { fixtures, openTheme } from "./fixtures";

test("A click outside an open popup only closes it", async ({ page }) => {
  await fixtures(page);
  await page.goto("/images");
  await openTheme(page);
  const theme = page.getByText("Colour Scheme", { exact: true });
  await expect(theme).toBeVisible();
  const chat = page
    .getByRole("navigation", { name: "Creative Modes" })
    .getByRole("link", { name: "Chat" });
  await chat.click();
  await expect(theme).toHaveCount(0);
  await expect(page).toHaveURL(/\/images$/);
  await chat.click();
  await expect(page).toHaveURL(/\/chat$/);
});
