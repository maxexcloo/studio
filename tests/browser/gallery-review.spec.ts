import { expect, test } from "@playwright/test";

import { fixtures, image, stamp, toolbarSearch } from "./fixtures";

const result = (id: string, title: string, createdAt = stamp) => ({
  id,
  title,
  type: "image",
  status: "done",
  prompt: title,
  url: image,
  thumbnailUrl: image,
  width: 1024,
  height: 1024,
  createdAt,
});

test("A phone double tap likes the tile and a single tap opens it", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone touch gesture");
  const state = await fixtures(page);
  state.gallery.push(result("bird", "Amber Bird"));
  await page.goto("/images");
  const tile = page.getByRole("button", { name: "Open image: Amber Bird", exact: true });
  await expect(tile).toBeVisible();
  const box = (await tile.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.touchscreen.tap(point.x, point.y);
  await page.touchscreen.tap(point.x, point.y);
  await expect.poll(() => state.gallery[0].rating).toBe("liked");
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(viewer).toBeHidden();
  await page.touchscreen.tap(point.x, point.y);
  await expect(viewer).toBeVisible();
});

test("Returning to Gallery offers a jump only after an image arrives while away", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(result("old", "Old Bird"));
  await page.goto("/images");
  const modes = page.getByRole("navigation", { name: "Creative Modes" });
  const images = modes.getByRole("link", { name: "Images", exact: true });
  const videos = modes.getByRole("link", { name: "Videos", exact: true });
  const jump = page.getByRole("button", { name: "Jump to New Results" });
  await expect(page.getByRole("button", { name: "Open image: Old Bird" })).toBeVisible();
  await expect(jump).toBeHidden();
  await videos.click();
  await expect(videos).toHaveAttribute("aria-current", "page");
  state.gallery.unshift(result("new", "New Bird", new Date(Date.now() + 1000).toISOString()));
  await expect(jump).toBeHidden();
  await images.click();
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(page.getByRole("button", { name: "Open image: New Bird" })).toBeInViewport();
  await expect(jump).toBeHidden();
  await page.getByRole("button", { name: "Review Gallery" }).click();
  const deck = page.getByRole("dialog", { name: "Review Gallery" });
  await deck.getByRole("combobox", { name: "Review Time" }).click();
  await page.getByRole("option", { name: "New Since Last Gallery Visit" }).click();
  await expect(deck.getByText("New Bird", { exact: true })).toBeVisible();
  await expect(deck.getByText("Old Bird", { exact: true })).toBeHidden();
});

test("Gallery review rates matching results with arrows and Undo and returns to the filter", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(
    result("first", "Bird in Snow"),
    result("second", "Bird at Sea"),
    result("other", "Summer Harbour"),
    { ...result("liked", "Common Bird", new Date().toISOString()), rating: "liked" },
  );
  await page.goto("/images");
  const search = await toolbarSearch(page);
  await search.fill("Bird");
  const review = page.getByRole("button", { name: "Review Gallery" });
  await expect(page.getByRole("button", { name: "Open image: Summer Harbour" })).toBeHidden();
  await review.click();
  const deck = page.getByRole("dialog", { name: "Review Gallery" });
  await expect(deck.getByText("Bird in Snow", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => state.gallery.find(({ id }) => id === "first")?.rating).toBe("liked");
  await expect(deck.getByText("Bird at Sea", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => state.gallery.find(({ id }) => id === "second")?.rating).toBe("disliked");
  await expect(deck.getByText("No Unrated Results")).toBeVisible();
  await deck.getByRole("button", { name: "Undo" }).click();
  await expect(deck.getByText("Bird at Sea", { exact: true })).toBeVisible();
  await deck.getByRole("combobox", { name: "Review Rating" }).click();
  await page.getByRole("option", { name: "Liked", exact: true }).click();
  await deck.getByRole("combobox", { name: "Review Time" }).click();
  await page.getByRole("option", { name: "Last 24 Hours", exact: true }).click();
  await expect(deck.getByText("Common Bird", { exact: true })).toBeVisible();
  await expect(deck.getByText("Bird in Snow", { exact: true })).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(deck).toBeHidden();
  await expect(search).toHaveValue("Bird");
});

test("Gallery Review offers suggestions for the current result", async ({ page }) => {
  const state = await fixtures(page);
  state.gallery.push({ ...result("bird", "Amber Bird"), jobId: "bird-job" });
  const asked: string[] = [];
  await page.route("**/api/suggestions", (route) => {
    const body = route.request().postDataJSON();
    if (body.surface === "change")
      return route.fulfill({ json: { suggestions: [], reason: "No matching change" } });
    asked.push(body.itemId);
    return route.fulfill({
      json: {
        suggestions: [
          ...Array.from({ length: 9 }, (_, index) => ({
            label: `Idea ${index + 1}`,
            request: `try direction ${index + 1}`,
          })),
          { label: "Later Light", request: "change the light" },
        ],
      },
    });
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Review Gallery", exact: true }).click();
  const deck = page.getByRole("dialog", { name: "Review Gallery", exact: true });
  await deck.getByRole("button", { name: "Suggestions", exact: true }).click();
  const menu = page.getByRole("menu").first();
  const chosen = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/suggestions") && request.postDataJSON().surface === "change",
  );
  await menu.getByRole("menuitem", { name: "Later Light", exact: true }).click();
  expect((await chosen).postDataJSON()).toMatchObject({
    itemId: "bird",
    request: "change the light",
  });
  expect(asked).toEqual(["bird"]);
});
