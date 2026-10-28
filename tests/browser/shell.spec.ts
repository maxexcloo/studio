import { expect, test } from "@playwright/test";
import { create, fixtures, image, openTheme, stamp } from "./fixtures";

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

test("Popups anchored to the composer stay put while the gallery scrolls", async ({ page }) => {
  await fixtures(page);
  await page.route("**/api/gallery?**", (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 60 }, (_, index) => ({
          id: `scroll-${index}`,
          type: "image",
          status: "done",
          prompt: `Scroll Result ${index}`,
          url: image,
          thumbnailUrl: image,
          width: 1024,
          height: 1024,
          createdAt: stamp,
        })),
        nextCursor: "",
        hasMore: false,
      },
    }),
  );
  await page.route("**/api/prompts**", (route) =>
    route.fulfill({
      json: { prompts: [{ text: "Earlier landscape", at: stamp, uses: 1 }], enabled: true },
    }),
  );
  await create(page);
  await page.getByRole("button", { name: "Recent Prompts", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Recent Prompts", exact: true });
  await expect(panel.getByText("Earlier landscape")).toBeVisible();
  // Measured in one task, before any scroll handler could move the popup back.
  const moved = await panel.evaluate((element) => {
    const before = element.getBoundingClientRect().top;
    window.scrollBy(0, 400);
    return element.getBoundingClientRect().top - before;
  });
  // Sub-pixel drift is the tail of the popup's scale-in, not the scroll.
  expect(moved).toBeCloseTo(0);
});
