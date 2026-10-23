import { expect, test } from "@playwright/test";
import { fixtures, image, stamp } from "./fixtures";
const results = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `browse-${index}`,
    type: "image",
    status: "done",
    prompt: `Browse Result ${index}`,
    url: image,
    thumbnailUrl: image,
    width: 1024,
    height: 1024,
    createdAt: stamp,
  }));

test("Gallery continues near the bottom and retains loaded results when the next page needs retry", async ({
  page,
}) => {
  await fixtures(page);
  const items = results(61);
  let failed = false;
  let recovered = false;
  await page.route("**/api/gallery?**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor && !recovered) {
      failed = true;
      await route.fulfill({ status: 503, json: { error: "Fixture next page is offline" } });
    } else
      await route.fulfill({
        json: cursor
          ? { items: items.slice(60), nextCursor: "", hasMore: false }
          : { items: items.slice(0, 60), nextCursor: "next", hasMore: true },
      });
  });
  await page.goto("/images");
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => failed).toBe(true);
  await expect(
    page.getByText("More results could not be loaded. Try again.", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".studio-media-tile").first()).toBeVisible();
  recovered = true;
  await page.getByRole("button", { name: "Load More", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 60", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Load More", exact: true })).toBeHidden();
});

test("Closing a navigated viewer reveals and focuses its current virtualised gallery tile", async ({
  page,
}) => {
  await fixtures(page);
  await page.route("**/api/gallery?**", (route) =>
    route.fulfill({ json: { items: results(80), nextCursor: "", hasMore: false } }),
  );
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 25; index++)
    await dialog.getByRole("button", { name: "Next Generation", exact: true }).click();
  await expect(dialog.getByRole("img", { name: "Browse Result 25", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close Generation", exact: true }).click();
  await expect(dialog).toBeHidden();
  const current = page.getByRole("button", { name: "Open image: Browse Result 25", exact: true });
  await expect(current).toBeFocused();
  await expect(current).toBeInViewport();
});
