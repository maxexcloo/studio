import { expect, test } from "@playwright/test";

import { fixtures, image, showGalleryView, stamp, toolbarSearch } from "./fixtures";

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

test("A phone tap opens the tile at once", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone touch gesture");
  const state = await fixtures(page);
  state.gallery.push(result("bird", "Amber Bird"));
  await page.goto("/images");
  const tile = page.getByRole("button", { name: "Open image: Amber Bird", exact: true });
  await expect(tile).toBeVisible();
  const box = (await tile.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toBeVisible();
  expect(state.gallery[0].rating).toBeUndefined();
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
  await showGalleryView(page, "Review");
  await expect(page).toHaveURL(/\/images\/review$/);
  const deck = page.getByRole("region", { name: "Review", exact: true });
  await deck.getByRole("button", { name: "Time", exact: true }).click();
  await page.getByRole("menuitem", { name: "New Since Last Visit", exact: true }).click();
  await expect(deck.getByText("New Bird", { exact: true })).toBeVisible();
  await expect(deck.getByText("Old Bird", { exact: true })).toBeHidden();
});

test("Gallery Review accepts without rating, supports Undo and keeps the gallery filter", async ({
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
  await expect(page.getByRole("button", { name: "Open image: Summer Harbour" })).toBeHidden();
  await showGalleryView(page, "Review");
  const deck = page.getByRole("region", { name: "Review", exact: true });
  await expect(deck.getByText("Bird in Snow", { exact: true })).toBeVisible();
  const first = state.gallery[0];
  const second = state.gallery[1];
  const card = deck.getByRole("group", { name: "Current Gallery Image", exact: true });
  const box = (await card.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + box.width * 0.45, centre.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => first.libraryReviewedAt).toBeDefined();
  expect(first.rating).toBeUndefined();
  await deck.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => first.libraryReviewedAt).toBeUndefined();
  await expect(card.getByText("Bird in Snow", { exact: true })).toBeVisible();
  await deck.getByRole("button", { name: "Accept", exact: true }).click();
  await expect.poll(() => first.libraryReviewedAt).toBeDefined();
  await expect(card.getByText("Bird at Sea", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => second.rating).toBe("disliked");
  await expect(deck.getByText("No Unrated Results")).toBeVisible();
  await deck.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => second.rating).toBeUndefined();
  await expect(card.getByText("Bird at Sea", { exact: true })).toBeVisible();
  await deck.getByRole("button", { name: "Super Like", exact: true }).click();
  await expect.poll(() => second.rating).toBe("liked");
  await expect(deck.getByText("No Unrated Results")).toBeVisible();
  await deck.getByRole("button", { name: "Rating", exact: true }).click();
  await page.getByRole("menuitem", { name: "Liked", exact: true }).click();
  await deck.getByRole("button", { name: "Time", exact: true }).click();
  await page.getByRole("menuitem", { name: "Last 24 Hours", exact: true }).click();
  await expect(deck.getByText("Common Bird", { exact: true })).toBeVisible();
  await expect(deck.getByText("Bird in Snow", { exact: true })).toBeHidden();
  await showGalleryView(page, "Gallery");
  await expect(page).toHaveURL(/\/images$/);
  await expect(deck).toBeHidden();
  await expect(search).toHaveValue("Bird");
});

test("Gallery Review loads the next five Suggestions across pages and reuses them", async ({
  page,
}) => {
  const state = await fixtures(page);
  const results = Array.from({ length: 7 }, (_, index) =>
    result(`review-${index}`, `Review Result ${index}`),
  );
  state.gallery.push(...results);
  await page.route(/\/api\/gallery\?/, (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("unrated") !== "1") return route.fallback();
    const offset = Number(params.get("cursor") || 0);
    const end = offset + 2;
    return route.fulfill({
      json: {
        items: results.slice(offset, end),
        hasMore: end < results.length,
        nextCursor: String(end),
        totalApprox: results.length,
      },
    });
  });
  const asked: string[] = [];
  await page.route("**/api/suggestions", (route) => {
    const body = route.request().postDataJSON();
    if (body.surface === "composer") return route.fallback();
    if (body.surface === "change")
      return route.fulfill({ json: { suggestions: [], reason: "No matching change" } });
    asked.push(`${body.itemId}:${body.action || body.surface}`);
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
  await showGalleryView(page, "Review");
  const deck = page.getByRole("region", { name: "Review", exact: true });
  const card = deck.getByRole("group", { name: "Current Gallery Image", exact: true });
  await expect(card.getByText("Review Result 0", { exact: true })).toBeVisible();
  const warmed = (count: number) =>
    results
      .slice(0, count)
      .flatMap(({ id }) => ["viewer", "recreate", "edit", "animate"].map((mode) => `${id}:${mode}`))
      .sort();
  await expect.poll(() => [...asked].sort()).toEqual(warmed(6));
  expect(asked.slice(0, 4)).toEqual([
    "review-0:viewer",
    "review-0:recreate",
    "review-0:edit",
    "review-0:animate",
  ]);
  await deck.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(card.getByText("Review Result 1", { exact: true })).toBeVisible();
  await expect.poll(() => [...asked].sort()).toEqual(warmed(7));
  await deck.getByRole("button", { name: "Suggestions", exact: true }).click();
  const menu = page.getByRole("menu").first();
  const chosen = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/suggestions") && request.postDataJSON().surface === "change",
  );
  await menu.getByRole("menuitem", { name: "Later Light", exact: true }).click();
  expect((await chosen).postDataJSON()).toMatchObject({
    itemId: "review-1",
    request: "change the light",
  });
  expect([...asked].sort()).toEqual(warmed(7));
});

test("Video Review opened directly leaves for the video gallery", async ({ page }) => {
  const state = await fixtures(page);
  state.gallery.push(result("image", "Still Bird"), {
    ...result("video", "Flying Bird"),
    type: "video",
  });
  await page.goto("/videos/review");
  const deck = page.getByRole("region", { name: "Review", exact: true });
  await expect(deck.getByText("Flying Bird", { exact: true })).toBeVisible();
  await expect(deck.getByText("Still Bird", { exact: true })).toBeHidden();
  // Review leaves through the view menu, as the gallery's other views do.
  await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  await showGalleryView(page, "Gallery");
  await expect(page).toHaveURL(/\/videos$/);
  await expect(page.getByRole("button", { name: "Open video: Flying Bird" })).toBeVisible();
});
