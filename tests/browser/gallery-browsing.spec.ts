import { type Locator, type Route, expect, test } from "@playwright/test";

import { dayHeading, mediaTitle } from "../../frontend/src/features/gallery/mediaLabels";
import {
  closeReferences,
  expandComposer,
  fixtures,
  image,
  openReferenceChoices,
  selectionAction,
  serveRetries,
  showGalleryView,
  showOnly,
  showViewerThumbnails,
  stamp,
  toggleGalleryFilter,
  toolbarSearch,
  touch,
} from "./fixtures";

const currentResult = (viewer: Locator) =>
  viewer.getByRole("status", { name: "Current Result", exact: true });
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
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByRole("button", { name: /^Open image: Browse Result/ }).first(),
  ).toBeVisible();
  recovered = true;
  await retry.click();
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 60", exact: true }),
  ).toBeVisible();
  await expect(retry).toBeHidden();
});

test("Select Failed can retry a cleared offscreen job and retains a refusal", async ({ page }) => {
  const state = await fixtures(page);
  const items = results(1_205);
  const failed = [602, 1_204].map((index) => {
    const jobId = `failed-${index}`;
    const item = {
      ...items[index],
      jobId,
      title: `Older failure ${index}`,
      status: "failed",
      url: "",
    };
    items[index] = item;
    state.jobs.push({
      id: jobId,
      sessionId: "older-session",
      status: "failed",
      cleared: index === 1_204,
      operation: "image",
      input: { kind: "image", profileId: "image:test", prompt: item.prompt },
      items: [],
      outputs: [],
      createdAt: stamp,
      updatedAt: stamp,
    });
    return item;
  });
  items[980] = { ...items[980], status: "failed", url: "" };
  const cursors: string[] = [];
  const picks: string[] = [];
  await page.route("**/api/gallery?**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    const match = query.get("select");
    const cursor = query.get("cursor") || "";
    const end = Number(cursor) + 60;
    if (match) picks.push(match);
    else if (cursor) cursors.push(cursor);
    return route.fulfill({
      json: match
        ? {
            items: items.filter((item) => item.status === "failed"),
            nextCursor: "",
            hasMore: false,
          }
        : {
            items: items.slice(Number(cursor), end),
            nextCursor: end < items.length ? String(end) : "",
            hasMore: end < items.length,
          },
    });
  });
  const attempts: string[][] = [];
  await serveRetries(page, { jobs: state.jobs, gallery: items }, (ids) => {
    attempts.push(ids);
    return ids.map((id) =>
      attempts.length === 1 && id === failed[1].jobId
        ? { id, error: "Worker unavailable" }
        : { id, replacement: `retry-${id}` },
    );
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  await page.getByRole("button", { name: "Failed", exact: true }).click();
  const status = page.getByRole("group", { name: "Gallery Selection" }).getByRole("status");
  await expect(status).toHaveText("3 Selected");
  expect(picks).toEqual(["failed"]);
  expect(cursors).toEqual([]);
  const retry = selectionAction(page, "Retry");
  await retry.click();
  await expect(status).toHaveText("1 Selected");
  await expect(
    page.getByText("Older failure 1204. Worker unavailable", { exact: true }),
  ).toBeVisible();
  await retry.click();
  await expect(status).toHaveCount(0);
  expect(attempts).toEqual([failed.map(({ jobId }) => jobId), [failed[1].jobId]]);
});

test("The viewer loads the next page as it nears the last loaded result and counts every match", async ({
  page,
}) => {
  await fixtures(page);
  const items = results(61);
  await page.route("**/api/gallery?**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return route.fulfill({
      json: cursor
        ? { items: items.slice(60), nextCursor: "", hasMore: false, totalApprox: 61 }
        : { items: items.slice(0, 60), nextCursor: "next", hasMore: true, totalApprox: 61 },
    });
  });
  const nextPage = page.waitForResponse((response) => response.url().includes("cursor=next"));
  await page.goto("/images/browse-59");
  const viewer = page.getByRole("dialog");
  await expect(currentResult(viewer)).toHaveText("60 / 61");
  // Navigation stops at the last loaded result, so the step waits for the page it loaded to show.
  await nextPage;
  await expect(async () => {
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/\/images\/browse-60/, { timeout: 500 });
  }).toPass();
  await expect(currentResult(viewer)).toHaveText("61 / 61");
});

test("Select All takes every match across pages, and the search and Liked stay while selecting", async ({
  page,
}) => {
  await fixtures(page);
  // Every other result is liked; the gallery pages them 60 at a time.
  const items = results(130).map((item, index) => ({
    ...item,
    rating: index % 2 === 0 ? "liked" : undefined,
  }));
  const requests: URLSearchParams[] = [];
  await page.route("**/api/gallery?**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    requests.push(query);
    const matches = items.filter(
      (item) =>
        item.prompt.includes(query.get("q") || "") &&
        (query.get("rating") !== "liked" || item.rating === "liked"),
    );
    const start = Number(query.get("cursor") || 0);
    const end = query.has("select") ? matches.length : start + Number(query.get("limit"));
    await route.fulfill({
      json: {
        items: matches.slice(start, end),
        nextCursor: end < matches.length ? String(end) : "",
        hasMore: end < matches.length,
        totalApprox: matches.length,
      },
    });
  });
  await page.goto("/images");
  await showOnly(page, "Liked");
  await (await toolbarSearch(page)).fill("Browse");
  await expect.poll(() => requests.at(-1)?.get("q")).toBe("Browse");
  const select = page.getByRole("button", { name: "Select Items", exact: true });
  await select.click();
  // Select stays in place, pressed, while selecting.
  await expect(select).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "Search Gallery", exact: true })).toHaveValue(
    "Browse",
  );
  await page.getByRole("button", { name: "All", exact: true }).click();
  const status = page.getByRole("group", { name: "Gallery Selection" }).getByRole("status");
  await expect(status).toHaveText("65 Selected");
  const quick = requests.filter((query) => query.has("select"));
  expect(quick.map((query) => [query.get("select"), query.get("q"), query.get("rating")])).toEqual([
    ["all", "Browse", "liked"],
  ]);
  expect(requests.filter((query) => query.get("cursor"))).toEqual([]);
  // The quick selects always show, disabled where they would change nothing.
  await expect(page.getByRole("button", { name: "All", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Failed", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "None", exact: true }).click();
  await expect(status).toHaveText("0 Selected");
  await expect(page.getByRole("button", { name: "None", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(status).toHaveText("65 Selected");
  if (test.info().project.use.isMobile) {
    const selection = page.getByRole("group", { name: "Gallery Selection", exact: true });
    const actions = selection.getByRole("group", { name: "Selected Item Actions", exact: true });
    // One row that scrolls sideways, starting at the count and quick selects.
    await expect(status).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "None", exact: true })).toBeInViewport({
      ratio: 1,
    });
    await page.evaluate(() => window.scrollBy(0, 800));
    await expect(status).toBeInViewport({ ratio: 1 });
    const like = actions.getByRole("button", { name: "Like", pressed: true, exact: true });
    // Scroll the row itself sideways; the page stays where it is.
    await like.evaluate((el) => el.scrollIntoView({ block: "nearest", inline: "center" }));
    await expect(like).toBeInViewport({ ratio: 1 });
    expect((await like.boundingBox())!.y).toBeLessThan((await status.boundingBox())!.y + 20);
    // Phones end the selection with Select, which stays in sight while it applies.
    await expect(select).toBeInViewport({ ratio: 1 });
    await expect(
      selection.getByRole("button", { name: "Clear Selection", exact: true }),
    ).toHaveCount(0);
  }
  const clearRating = page.waitForRequest("**/api/gallery/favorite");
  await selectionAction(page, "Like").click();
  expect((await clearRating).postDataJSON()).toMatchObject({ rating: null });
  expect((await clearRating).postDataJSON().ids).toHaveLength(65);
  // A finished action ends the selection.
  await expect(select).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("textbox", { name: "Search Gallery", exact: true })).toHaveValue(
    "Browse",
  );
  expect([requests.at(-1)?.get("q"), requests.at(-1)?.get("rating")]).toEqual(["Browse", "liked"]);
  // Pressing Select again ends selection too.
  await select.click();
  await select.click();
  await expect(page.getByRole("group", { name: "Gallery Selection" })).toHaveCount(0);
});

test("Removing the Set filter clears selected items while keeping selection mode", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(
    ...results(2).map((item, index) => ({
      ...item,
      ...(index === 0 ? { resultSet: { id: "set-a", title: "Variety Test", index: 0 } } : {}),
    })),
  );
  await page.goto("/images?set=set-a");
  await expect(page).toHaveURL(/\/images$/);
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 1", exact: true }),
  ).toHaveCount(0);
  const select = page.getByRole("button", { name: "Select Items", exact: true });
  await select.click();
  await page.getByRole("button", { name: "Select image: Browse Result 0", exact: true }).click();
  const status = page.getByRole("group", { name: "Gallery Selection" }).getByRole("status");
  await expect(status).toHaveText("1 Selected");
  await page.getByRole("button", { name: "Remove Set: Variety Test Filter", exact: true }).click();
  await expect(page).toHaveURL(/\/images$/);
  await expect(
    page.getByRole("button", { name: "Select image: Browse Result 1", exact: true }),
  ).toBeVisible();
  await expect(status).toHaveText("0 Selected");
  await expect(select).toHaveAttribute("aria-pressed", "true");
});

test("An MCP result link shows its turn, then the whole chat, then every result", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(
    ...results(3).map((item, index) => ({
      ...item,
      ...(index < 2
        ? {
            chat: { conversationId: "chat-a", turnId: index ? "turn-2" : "turn-1" },
            resultSet: { id: `set-${index}`, title: "Lighting", index: 0 },
          }
        : {}),
    })),
  );
  const tile = (index: number) =>
    page.getByRole("button", { name: `Open image: Browse Result ${index}`, exact: true });
  state.gallery.push({
    ...results(1)[0],
    id: "chat-video",
    type: "video",
    prompt: "Chat Video",
    chat: { conversationId: "chat-a", turnId: "turn-2" },
  });
  await page.route("**/api/gallery/chat-sets?**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    const sets = [
      { id: "set-0", title: "Lighting", count: 1, series: null, notes: "Window light", at: null },
      {
        id: "set-1",
        title: "Lighting",
        count: 1,
        series: "Night Studies",
        notes: "Hard flash",
        at: null,
      },
    ];
    return route.fulfill({ json: { sets: query.has("turn") ? sets.slice(0, 1) : sets } });
  });
  await page.goto("/images?chat=chat-a&turn=turn-1");
  await expect(tile(0)).toBeVisible();
  await expect(tile(1)).toHaveCount(0);
  await page.getByRole("button", { name: "This Turn", exact: true }).click();
  await page
    .getByRole("radiogroup", { name: "Chat Results", exact: true })
    .getByText("This Chat", { exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(tile(1)).toBeVisible();
  await expect(tile(2)).toHaveCount(0);
  const chatSets = page.getByRole("combobox", { name: "Chat Sets", exact: true });
  await chatSets.click();
  await page.getByRole("option").filter({ hasText: "Night Studies · Hard flash" }).click();
  await expect(tile(1)).toBeVisible();
  await expect(tile(0)).toHaveCount(0);
  await chatSets.click();
  await page.getByRole("option", { name: "All Sets", exact: true }).click();
  await expect(tile(0)).toBeVisible();
  await expect(tile(2)).toHaveCount(0);
  await tile(0).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(currentResult(viewer)).toHaveText(/^[12] \/ 2$/);
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  const modes = page.getByRole("navigation", { name: "Creative Modes", exact: true });
  await modes.getByRole("link", { name: "Videos", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove This Chat Filter" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open video: Chat Video", exact: true }),
  ).toBeVisible();
  await modes.getByRole("link", { name: "Images", exact: true }).click();
  await expect(tile(1)).toBeVisible();
  await expect(tile(2)).toHaveCount(0);
  const output = page.getByRole("radiogroup", { name: "Generation Output", exact: true });
  await expandComposer(page);
  await output.locator("label").filter({ hasText: "Video" }).click();
  await expect(page).toHaveURL(/\/videos$/);
  await page.keyboard.press("Escape");
  await expect(output).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Open video: Chat Video", exact: true }),
  ).toBeVisible();
  await expandComposer(page);
  await output.locator("label").filter({ hasText: "Image" }).click();
  await expect(page).toHaveURL(/\/images$/);
  await page.keyboard.press("Escape");
  await expect(output).toBeHidden();
  await expect(tile(1)).toBeVisible();
  await expect(tile(2)).toHaveCount(0);
  await page.getByRole("button", { name: "Remove This Chat Filter", exact: true }).click();
  await expect(page).toHaveURL(/\/images$/);
  await expect(tile(2)).toBeVisible();
  await expect(chatSets).toHaveCount(0);
});

test("Ctrl+scroll zooms the grid around the tile under the pointer and is remembered", async ({
  page,
}, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), "Phones pinch instead");
  const state = await fixtures(page);
  state.gallery.push(...results(80));
  await page.goto("/images");
  const tile = (index: number) =>
    page.getByRole("button", { name: `Open image: Browse Result ${index}`, exact: true });
  await expect(tile(0)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 900));
  const anchored = tile(22);
  await expect(anchored).toBeInViewport();
  const before = (await anchored.boundingBox())!;
  const width = before.width;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  // Fewer columns: larger tiles, with the one under the pointer still under it.
  await expect.poll(async () => (await anchored.boundingBox())?.width).toBeGreaterThan(width * 1.1);
  await page.waitForFunction(() => !document.getAnimations().length);
  const after = (await anchored.boundingBox())!;
  const pointer = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  expect(after.y).toBeLessThan(pointer.y);
  expect(after.y + after.height).toBeGreaterThan(pointer.y);
  const zoomed = after.width;
  await page.reload();
  await expect.poll(async () => (await tile(0).boundingBox())?.width).toBeCloseTo(zoomed, 0);
  await expect(page.getByRole("slider", { name: "Tile Size" })).toBeVisible();
});

test("Pinching the phone gallery enlarges the tiles", async ({ page, isMobile, browserName }) => {
  test.skip(!isMobile || browserName !== "chromium", "Requires Chromium touch input");
  const state = await fixtures(page);
  state.gallery.push(...results(80));
  await page.goto("/images");
  const tile = page.getByRole("button", { name: "Open image: Browse Result 0", exact: true });
  await expect(tile).toBeInViewport();
  const { x, y, width, height } = (await tile.boundingBox())!;
  const centre = { x: x + width / 2, y: y + height / 2 };
  const points = (distance: number) => [
    { x: centre.x - distance, y: centre.y },
    { x: centre.x + distance, y: centre.y },
  ];
  const touch = await page.context().newCDPSession(page);
  try {
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points(10).slice(0, 1),
    });
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(10) });
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(30) });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await touch.detach();
  }
  await expect.poll(async () => (await tile.boundingBox())?.width).toBeGreaterThan(width);
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
  // Phones swipe instead of showing the arrows; the arrow key navigates the same way.
  const phone = (page.viewportSize()?.width || 1440) < 768;
  for (let index = 0; index < 25; index++)
    if (phone) await page.keyboard.press("ArrowRight");
    else await dialog.getByRole("button", { name: "Next Generation", exact: true }).click();
  await expect(dialog.getByRole("img", { name: "Browse Result 25", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close Generation", exact: true }).click();
  await expect(dialog).toBeHidden();
  const current = page.getByRole("button", { name: "Open image: Browse Result 25", exact: true });
  await expect(current).toBeFocused();
  await expect(current).toBeInViewport();
});

test("The installed app opens and closes the viewer without adding history entries", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      query === "(display-mode: standalone)"
        ? ({ ...matchMedia(query), matches: true } as MediaQueryList)
        : matchMedia(query);
  });
  await fixtures(page);
  await page.route("**/api/gallery?**", (route) =>
    route.fulfill({ json: { items: results(3), nextCursor: "", hasMore: false } }),
  );
  await page.goto("/images");
  const entries = await page.evaluate(() => history.length);
  await page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/images\/.+/);
  await dialog.getByRole("button", { name: "Close Generation", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/images$/);
  expect(await page.evaluate(() => history.length)).toBe(entries);
});

test("Single-item viewer keyboard actions like and request deletion through the existing confirmation", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(...results(1));
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(viewer).toBeVisible();
  await page.keyboard.press("f");
  await expect.poll(() => state.gallery[0].rating).toBe("liked");
  await page.keyboard.press("Delete");
  const confirm = page.getByRole("dialog", { name: "Delete Item", exact: true });
  await expect(confirm).toBeVisible();
  expect(state.gallery).toHaveLength(1);
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  // Focus stays in the fading confirmation until its exit transition ends, then returns.
  await expect(confirm).toBeHidden();
  await expect
    .poll(() => viewer.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press("Delete");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect.poll(() => state.gallery.length).toBe(0);
});

test("Search shortcuts follow the active gallery or reference picker and leave prompt typing alone", async ({
  page,
}, testInfo) => {
  const state = await fixtures(page);
  state.gallery.push(...results(1));
  await page.goto("/images");
  const tile = page.getByRole("button", { name: "Open image: Browse Result 0", exact: true });
  await tile.focus();
  await page.keyboard.press("/");
  const search = page.getByRole("textbox", { name: "Search Gallery", exact: true });
  await expect(search).toBeFocused();
  await search.fill("Browse");
  await page.keyboard.press("Escape");
  // Phones close the search row back to its icon; desktop keeps the box and leaves it.
  if (testInfo.project.use.isMobile)
    await expect(page.getByRole("button", { name: "Search Gallery", exact: true })).toBeFocused();
  else await expect(search).not.toBeFocused();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(search).toBeFocused();
  // Closing the phone's search cleared it.
  await expect(search).toHaveValue(testInfo.project.use.isMobile ? "" : "Browse");
  await page.keyboard.press("Escape");
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await expandComposer(page);
  await prompt.fill("Keep typing");
  await prompt.press("/");
  await expect(prompt).toHaveValue("Keep typing/");
  const picker = await openReferenceChoices(page);
  // The picker's search sits inline and takes focus when it opens.
  const referenceSearch = picker.getByRole("textbox", { name: "Search Gallery", exact: true });
  await referenceSearch.fill("Result 0");
  await expect(
    picker.getByRole("button", { name: "Use reference: Browse Result 0", exact: true }),
  ).toBeVisible();
  await picker.getByRole("button", { name: "Use reference: Browse Result 0", exact: true }).click();
  await closeReferences(page);
  await expect(picker).toBeHidden();
  await expect(prompt).toHaveValue("Keep typing/");
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
});

test("Touch scrolling cancels hold selection and a held tile remains selected after release", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, "Touch gesture applies to phone projects");
  const state = await fixtures(page);
  state.gallery.push(...results(2));
  state.preferences.preferences.tileCaptions = true;
  await page.goto("/images");
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  const first = page.getByRole("button", { name: "Select image: Browse Result 0", exact: true });
  const second = page.getByRole("button", { name: "Select image: Browse Result 1", exact: true });
  // A touch screen's hold is Studio's: no native drag lift takes it first.
  await expect(first).toHaveAttribute("draggable", "false");
  await touch(first, "touchstart");
  await touch(first, "touchmove", 140);
  await touch(first, "touchend", 140);
  await touch(second, "touchstart");
  const selection = page.getByRole("group", { name: "Gallery Selection", exact: true });
  await expect(selection.getByRole("status")).toHaveText("1 Selected");
  const selected = page.getByRole("button", { name: "Select image: Browse Result 1", exact: true });
  await touch(selected, "touchend");
  await selected.dispatchEvent("click");
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  // While selecting, a tap toggles a tile.
  const other = page.getByRole("button", { name: "Select image: Browse Result 0", exact: true });
  await other.click();
  await expect(selection.getByRole("status")).toHaveText("2 Selected");
  await other.click();
  await expect(selection.getByRole("status")).toHaveText("1 Selected");
  await selectionAction(page, "Like").click();
  await expect.poll(() => state.gallery[1].rating).toBe("liked");
  expect(state.gallery[0].rating).toBeUndefined();
  await expect(selection).toHaveCount(0);
  await page.getByRole("button", { name: "Open image: Browse Result 1", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toBeVisible();
});

test("Retry Selected deduplicates owned jobs and retains partial failures for another attempt", async ({
  page,
}) => {
  const state = await fixtures(page);
  for (const id of ["batch-a", "batch-b"])
    state.jobs.push({
      id,
      sessionId: "batch-session",
      status: "failed",
      operation: "image",
      input: { kind: "image", profileId: "image:test", prompt: id },
      items: [],
      outputs: [],
      createdAt: stamp,
      updatedAt: stamp,
    });
  state.gallery.push(
    ...["first", "second", "third"].map((name, index) => ({
      ...results(1)[0],
      id: name,
      prompt: `Failed ${name}`,
      jobId: index < 2 ? "batch-a" : "batch-b",
      status: "failed",
      url: "",
    })),
    { ...results(1)[0], id: "ready", prompt: "Ready result" },
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let releaseRefresh!: () => void;
  const heldRefresh = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let refreshing = false;
  const holdRefresh = async (route: Route) => {
    if (attempts.length) {
      refreshing = true;
      await heldRefresh;
    }
    await route.fallback();
  };
  await page.route("**/api/gallery?**", holdRefresh);
  await page.route(/\/api\/queue(?:\?.*)?$/, holdRefresh);
  const attempts: string[][] = [];
  let failSecond = true;
  await serveRetries(page, state, async (ids) => {
    attempts.push(ids);
    await held;
    return ids.map((id) => {
      if (id === "batch-b" && failSecond) return { id, error: "Second worker remains offline" };
      const job = {
        ...state.jobs.find((job) => job.id === id),
        id: `retried-${id}`,
        status: "queued",
      };
      state.jobs.push(job);
      return { id, replacement: job.id };
    });
  });
  try {
    await page.goto("/images");
    await page.getByRole("button", { name: "Select Items", exact: true }).click();
    await page.getByRole("button", { name: "All", exact: true }).click();
    const selection = page.getByRole("group", { name: "Gallery Selection", exact: true });
    await expect(selection.getByRole("status")).toHaveText("4 Selected");
    const retry = selectionAction(page, "Retry");
    await retry.click();
    await expect(retry).toBeDisabled();
    await retry.dispatchEvent("click");
    await expect.poll(() => attempts).toEqual([["batch-a", "batch-b"]]);
    release();
    // The selection settles on admission while the gallery and queue refresh.
    await expect.poll(() => refreshing).toBe(true);
    await expect(selection.getByRole("status")).toHaveText("1 Selected");
    expect(attempts).toEqual([["batch-a", "batch-b"]]);
    await expect(
      page.getByRole("checkbox", { name: "Select Failed Third", exact: true }),
    ).toBeChecked();
    releaseRefresh();
    // The accepted retry's new tiles replace its failed ones.
    await expect(
      page.getByRole("checkbox", { name: "Select Failed First", exact: true }),
    ).toHaveCount(0);
    failSecond = false;
    await retry.click();
    // Once every retry is accepted the selection ends.
    await expect(selection).toHaveCount(0);
    expect(attempts).toEqual([["batch-a", "batch-b"], ["batch-b"]]);
  } finally {
    release();
    releaseRefresh();
  }
});

test("MCP set results appear individually and the viewer can jump along the set strip", async ({
  page,
}) => {
  const place = (title: string, index: number) => `${title} · ${index} / 3`;
  const state = await fixtures(page);
  const set = { id: "set-a", title: "Variety Test", source: "LibreChat" };
  const untitled = mediaTitle({ prompt: "Set prompt 1, detailed" });
  // Newest first, as the gallery lists them; the second prompt has no title of its own.
  state.gallery.push(
    ...[
      ["Bear Hug", 2],
      [undefined, 1],
      ["Fox Wizard", 0],
    ].map(([variation, index], position) => ({
      ...results(1)[0],
      id: `set-${index}`,
      jobId: `set-job-${index}`,
      prompt: `Set prompt ${index}, detailed`,
      createdAt: `2026-10-23T00:00:0${3 - position}.000Z`,
      resultSet: { ...set, index, ...(variation ? { variation } : {}) },
    })),
    ...results(1),
  );
  await page.goto("/images");
  // The grid captions each result by its own title, or its prompt's first words.
  await expect(
    page.getByRole("button", { name: "Open image: Fox Wizard", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Open image: ${untitled}`, exact: true }),
  ).toBeVisible();
  const tiles = page.getByRole("button", { name: /^Open image: / });
  expect(await tiles.evaluateAll((all) => all.map((tile) => tile.ariaLabel))).toEqual([
    "Open image: Bear Hug",
    `Open image: ${untitled}`,
    "Open image: Fox Wizard",
    "Open image: Browse Result 0",
  ]);
  await page.getByRole("button", { name: "Open image: Bear Hug", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const current = currentResult(viewer);
  await expect(current).toHaveText(place("Bear Hug", 1));
  await showViewerThumbnails(viewer);
  const strip = viewer.getByRole("list", { name: "Set: Variety Test", exact: true });
  await expect(strip.getByRole("listitem")).toHaveCount(3);
  await strip.getByRole("listitem", { name: "Show Fox Wizard (3 of 3)", exact: true }).click();
  await expect(current).toHaveText(place("Fox Wizard", 3));
  await expect(
    viewer.getByRole("img", { name: "Set prompt 0, detailed", exact: true }),
  ).toBeVisible();
  await strip.getByRole("listitem", { name: `Show ${untitled} (2 of 3)`, exact: true }).click();
  await expect(current).toHaveText(place(untitled, 2));
});

test("Running tiles show progress with Stop and Retry replaces a failed tile", async ({ page }) => {
  const state = await fixtures(page);
  const job = (id: string, status: string, extra = {}) => ({
    id,
    sessionId: "chat-a",
    status,
    operation: "image",
    input: { kind: "image", prompt: id },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
    ...extra,
  });
  state.jobs.push(
    job("live-job", "running", {
      progress: {
        value: 5,
        max: 10,
        phase: "Sampling",
        steps: true,
        estimated: true,
        etaMs: 30000,
      },
      items: [
        { id: "live", status: "pending" },
        { id: "live-2", status: "pending" },
      ],
    }),
    job("failed-job", "failed", { reason: "The worker ran out of memory." }),
  );
  state.gallery.push(
    { ...results(1)[0], id: "live", jobId: "live-job", prompt: "Live study", status: "pending" },
    { ...results(1)[0], id: "live-2", jobId: "live-job", prompt: "Live study", status: "pending" },
    {
      ...results(1)[0],
      id: "failed",
      jobId: "failed-job",
      prompt: "Failed study",
      status: "failed",
    },
  );
  // The newest result, so the retry has a place below it to keep.
  state.gallery.unshift({ ...results(1)[0], id: "newest", prompt: "Newest study" });
  await serveRetries(page, state, ([id]) => {
    const retried = job("retried-job", "queued", { galleryAt: stamp });
    state.jobs.push(retried);
    // The retry's tile lists where the failed one did, not first.
    state.gallery.splice(
      state.gallery.findIndex((item) => item.id === "failed"),
      0,
      {
        ...results(1)[0],
        id: "retried",
        jobId: "retried-job",
        prompt: "Failed study",
        status: "pending",
      },
    );
    return [{ id, replacement: retried.id }];
  });
  await page.goto("/images");
  await expect(page.getByText("Sampling · About Step 5 of 10 · About 30s Left")).toHaveCount(2);
  const progress = page.getByRole("progressbar", { name: "Generation Progress" });
  await expect(progress).toHaveCount(2);
  await expect(progress.first()).toHaveAttribute("aria-valuenow", "50");
  await expect(page.getByText("The worker ran out of memory.", { exact: true })).toBeVisible();
  // One Stop for the two-output run.
  await expect(page.getByRole("button", { name: "Stop Live Study", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Stop Live Study", exact: true }).click();
  await expect.poll(() => state.jobs[0].status).toBe("cancelled");
  await page.getByRole("button", { name: "Retry Failed Study", exact: true }).click();
  await expect(page.locator('[data-media-id="failed"]')).toHaveCount(0);
  await expect(page.locator('[data-media-id="retried"]')).toBeVisible();
  expect(state.gallery.map((item) => item.id)).not.toContain("failed");
  const tiles = await page
    .locator("[data-media-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-media-id")));
  expect(tiles.indexOf("retried")).toBeGreaterThan(tiles.indexOf("newest"));
});

test("A second dislike replaces the first Undo and restores only its result", async ({ page }) => {
  const state = await fixtures(page);
  state.gallery.push(...results(2));
  await page.goto("/images");
  for (const index of [0, 1]) {
    await page.getByRole("button", { name: "Select Items", exact: true }).click();
    await page
      .getByRole("button", { name: `Select image: Browse Result ${index}`, exact: true })
      .click();
    await selectionAction(page, "Dislike").click();
    await expect.poll(() => state.gallery[index].rating).toBe("disliked");
    await expect(page.getByRole("button", { name: "Select Items", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  }
  const banner = page.getByRole("status").filter({ hasText: "Disliked" });
  await expect(banner).toHaveCount(1);
  await banner.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => state.gallery[1].rating).toBeUndefined();
  expect(state.gallery[0].rating).toBe("disliked");
  await expect(banner).toHaveCount(0);
});

test("New results wait behind a pill while the gallery is scrolled, keeping the tiles in view", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(...results(60));
  await page.goto("/images");
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }),
  ).toBeVisible();
  await page
    .locator("[data-gallery-view]")
    .evaluate((host) =>
      window.scrollTo(0, host.getBoundingClientRect().top + window.scrollY + 1500),
    );
  const scrolled = await page.evaluate(() => window.scrollY);
  state.gallery.unshift({ ...results(1)[0], id: "fresh", prompt: "Fresh Result" });
  // Returning to the tab reads the newest results.
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true })),
  );
  const pill = page.getByRole("button", { name: "New Results", exact: true });
  await expect(pill).toBeVisible();
  const fresh = page.getByRole("button", { name: "Open image: Fresh Result", exact: true });
  await expect(fresh).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  await pill.click();
  await expect(fresh).toBeVisible();
  await expect(pill).toBeHidden();
});

test("Selection extends with Shift, picks in-progress or failed work and acts from keys and menus", async ({
  page,
}, testInfo) => {
  test.skip(
    Boolean(testInfo.project.use.isMobile),
    "Shift, Delete and context keys need a keyboard",
  );
  const state = await fixtures(page);
  state.jobs.push({
    id: "live-job",
    sessionId: "chat-a",
    status: "running",
    operation: "image",
    input: { kind: "image", prompt: "Live" },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
  state.gallery.push(
    { ...results(1)[0], id: "live", jobId: "live-job", prompt: "Live study", status: "pending" },
    { ...results(1)[0], id: "failed", prompt: "Failed study", status: "failed", url: "" },
    ...results(4),
  );
  await page.goto("/images");
  const first = page.getByRole("button", { name: "Open image: Browse Result 0", exact: true });
  await first.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menuitem", { name: "Edit", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  const status = page.getByRole("group", { name: "Gallery Selection" }).getByRole("status");
  await page.getByRole("button", { name: "Select image: Browse Result 0", exact: true }).click();
  await page
    .getByRole("button", { name: "Select image: Browse Result 2", exact: true })
    .click({ modifiers: ["Shift"] });
  await expect(status).toHaveText("3 Selected");
  await page.getByRole("button", { name: "None", exact: true }).click();
  await page.getByRole("button", { name: /^Select image: Live Study$/i }).click();
  await expect(status).toHaveText("1 Selected");
  // A disabled action says why.
  await expect(selectionAction(page, "Delete")).toHaveAttribute("aria-disabled", "true");
  await expect(selectionAction(page, "Delete")).toHaveAccessibleDescription(
    "Stop work in progress before deleting it.",
  );
  await selectionAction(page, "Stop").click();
  await expect.poll(() => state.jobs[0].status).toBe("cancelled");
  await expect(status).toHaveCount(0);
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  await page.getByRole("button", { name: "Failed", exact: true }).click();
  await expect(status).toHaveText("1 Selected");
  await page
    .getByRole("button", { name: "Select image: Browse Result 3", exact: true })
    .click({ button: "right" });
  await expect(status).toHaveText("2 Selected");
  await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Delete");
  const confirm = page.getByRole("dialog", { name: "Delete Selected Items", exact: true });
  await expect(confirm).toContainText("Delete 2 items");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect
    .poll(() => state.gallery.map((item) => item.id))
    .toEqual(["live", "browse-0", "browse-1", "browse-2"]);
});

test("Tiles select as in a file manager: Ctrl toggles, Shift selects a range, Escape ends", async ({
  page,
}, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), "Click modifiers need a keyboard");
  const state = await fixtures(page);
  state.gallery.push(...results(6));
  await page.goto("/images");
  const tile = (index: number) =>
    page.getByRole("button", { name: new RegExp(`image: Browse Result ${index}$`) });
  const status = page.getByRole("group", { name: "Gallery Selection" }).getByRole("status");
  // Ctrl or Cmd starts selecting from the gallery without opening the tile.
  await tile(1).click({ modifiers: ["ControlOrMeta"] });
  await expect(status).toHaveText("1 Selected");
  await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toHaveCount(0);
  await expect(tile(1)).toHaveAttribute("aria-pressed", "true");
  await tile(3).click({ modifiers: ["Shift"] });
  await expect(status).toHaveText("3 Selected");
  await tile(5).click({ modifiers: ["ControlOrMeta"] });
  await expect(status).toHaveText("4 Selected");
  // Shift alone replaces the selection with the range from the last clicked tile.
  await tile(4).click({ modifiers: ["Shift"] });
  await expect(status).toHaveText("2 Selected");
  await expect(tile(1)).toHaveAttribute("aria-pressed", "false");
  await tile(0).click({ modifiers: ["ControlOrMeta"] });
  // Shift with Ctrl or Cmd adds the range.
  await tile(1).click({ modifiers: ["Shift", "ControlOrMeta"] });
  await expect(status).toHaveText("4 Selected");
  // A plain click toggles while selecting.
  await tile(4).click();
  await expect(status).toHaveText("3 Selected");
  // An open tooltip doesn't take the Escape.
  await selectionAction(page, "Like").hover();
  await expect(page.getByRole("tooltip", { name: "Like" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(status).toHaveCount(0);
  await tile(2).focus();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(status).toHaveText("6 Selected");
  await page.keyboard.press("Escape");
  await tile(2).click();
  await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toBeVisible();
});

test("Download takes a selection of any size as one archive", async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), "Phones may share instead");
  const state = await fixtures(page);
  state.gallery.push(...results(700));
  let posted: string[] = [];
  await page.route("**/api/gallery/export**", (route) =>
    route.request().method() === "POST"
      ? ((posted = route.request().postDataJSON().ids),
        route.fulfill({ json: { href: "/api/gallery/export?selection=token" } }))
      : route.fulfill({ body: "archive", contentType: "application/zip" }),
  );
  await page.goto("/images");
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  const status = page.getByRole("group", { name: "Gallery Selection" }).getByRole("status");
  await expect(status).toHaveText("700 Selected");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    selectionAction(page, "Download").click(),
  ]);
  expect(download.url()).toMatch(/\/api\/gallery\/export\?selection=token$/);
  expect(posted).toHaveLength(700);
  await expect(status).toHaveCount(0);
});

test("Offline views report the API error and support retry", async ({ page }) => {
  await fixtures(page);
  let fails = true;
  await page.route("**/api/gallery?**", (route) =>
    fails
      ? route.fulfill({ status: 503, json: { error: "The gallery is temporarily unavailable" } })
      : route.fulfill({ json: { items: [], hasMore: false } }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("The gallery is temporarily unavailable");
  fails = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("No Images", { exact: true })).toBeVisible();
});

test("Gallery search closes cleanly and the status panel stops active and clears failed work", async ({
  page,
}) => {
  const state = await fixtures(page);
  for (const [id, status] of [
    ["waiting-job", "waiting"],
    ["queued-job", "queued"],
    ["finished-job", "completed"],
    ["failed-job", "failed"],
  ])
    state.jobs.push({
      id,
      jobId: id,
      sessionId: "s",
      operation: "image",
      status,
      input: { prompt: id },
      items: [],
      createdAt: stamp,
      updatedAt: stamp,
    });
  await page.goto("/");
  const search = await toolbarSearch(page);
  await search.fill("birds");
  await search.press("Escape");
  // Desktop keeps its box and query; closing the phone's search clears it.
  const phone = test.info().project.use.isMobile;
  await expect(await toolbarSearch(page)).toHaveValue(phone ? "" : "birds");
  await search.press("Escape");
  // Liked applies in Gallery, while Uploads is its own view.
  await showOnly(page, "Liked");
  await showOnly(page, "Uploads");
  const status = page.getByRole("button", { name: "Open Status", exact: true });
  await expect(status).toHaveAttribute("aria-description", /^Generating/);
  await status.click();
  const queue = page.getByRole("dialog", { name: "Queue", exact: true });
  await expect(queue.getByText("waiting-job", { exact: true })).toBeVisible();
  await expect(queue.getByText("queued-job", { exact: true })).toBeVisible();
  for (const action of ["Stop All", "Clear Failed"]) {
    await queue.getByRole("button", { name: action, exact: true }).click();
    await page
      .getByRole("dialog", { name: `${action} Generations`, exact: true })
      .getByRole("button", { name: action, exact: true })
      .click();
  }
  await expect
    .poll(() => state.jobs.map((job) => [job.status, Boolean(job.cleared)]))
    .toEqual([
      ["cancelled", false],
      ["cancelled", false],
      ["completed", false],
      ["failed", true],
    ]);
  await expect(queue.getByText("Empty Queue", { exact: true })).toBeVisible();
});

test("Retry All retries every failed job in the queue", async ({ page }) => {
  const state = await fixtures(page);
  for (const [id, status] of [
    ["failed-a", "failed"],
    ["waiting-job", "waiting"],
    ["failed-b", "failed"],
  ])
    state.jobs.push({
      id,
      jobId: id,
      sessionId: "s",
      operation: "image",
      status,
      input: { prompt: id },
      items: [],
      createdAt: stamp,
      updatedAt: stamp,
    });
  await serveRetries(page, state, (ids) => ids.map((id) => ({ id, replacement: `${id}-again` })));
  await page.goto("/");
  await page.getByRole("button", { name: "Open Status", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "Queue", exact: true });
  const retried = page.waitForRequest("**/api/queue/retry");
  await queue.getByRole("button", { name: "Retry All", exact: true }).click();
  expect((await retried).postDataJSON()).toEqual({ ids: ["failed-a", "failed-b"] });
  await expect(queue.getByRole("button", { name: "Retry All", exact: true })).toHaveCount(0);
  await expect(queue.getByText("waiting-job", { exact: true })).toBeVisible();
});

test("Gallery selection stars, downloads and deletes only selected finished records", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(
    ...["First Study", "Second Study", "Pending Study"].map((prompt, index) => ({
      id: `selection-${index}`,
      jobId: `selection-job-${index}`,
      type: "image",
      status: index === 2 ? "running" : "done",
      url: image,
      thumbnailUrl: image,
      prompt,
      width: 1024,
      height: 1024,
      settings: { profileId: "image:test" },
    })),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  // The bar holds only the selection's actions, even for one item: its own stay on its tile.
  const phone = test.info().project.use.isMobile;
  await page.getByRole("button", { name: "Select image: First Study", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("1 Selected");
  await expect(selectionAction(page, "Animate")).toBeVisible();
  await expect(selectionAction(page, "Edit")).toHaveCount(0);
  await selectionAction(page, "Upscale").click();
  await expect(page.getByRole("menuitem", { name: "Upscale", exact: true })).toBeVisible();
  await expect(
    page.getByRole("radiogroup", { name: "Upscale Quality", exact: true }),
  ).toBeVisible();
  await selectionAction(page, "Upscale").click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("3 Selected");
  // Phones that share natively offer Share beside Download; elsewhere Share is Download itself.
  const sharing = phone && (await page.evaluate(() => typeof navigator.share === "function"));
  if (sharing) {
    await selectionAction(page, "Share").click();
    await expect(page.getByRole("menuitem")).toHaveText(["Download", "Share"]);
    await selectionAction(page, "Share").click();
    await expect(page.getByRole("menu")).toHaveCount(0);
  } else {
    await expect(selectionAction(page, "Download")).toBeVisible();
    await expect(selectionAction(page, "Share")).toHaveCount(0);
  }
  await selectionAction(page, "Like").click();
  await expect.poll(() => state.gallery.filter((item) => item.rating === "liked").length).toBe(2);
  // Each finished action ends the selection.
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await selectionAction(page, "Delete").click();
  await page
    .getByRole("dialog", { name: "Delete Selected Items", exact: true })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect.poll(() => state.gallery.map((item) => item.id)).toEqual(["selection-2"]);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible();
});

test("Uploads stay out of the main gallery until the Uploads view is opened", async ({ page }) => {
  const state = await fixtures(page);
  const item = { type: "image", status: "done", url: image, thumbnailUrl: image, createdAt: stamp };
  state.gallery.push(
    { ...item, id: "made", jobId: "job-made", prompt: "Made here" },
    { ...item, id: "uploaded", uploaded: true, prompt: "" },
  );
  await page.goto("/");
  const tile = (id: string) => page.locator(`[data-media-id="${id}"]`);
  await expect(tile("made")).toBeVisible();
  await expect(tile("uploaded")).toHaveCount(0);
  await showOnly(page, "Uploads");
  await expect(tile("uploaded")).toBeVisible();
  await expect(tile("made")).toHaveCount(0);
});

test("Model filters list each clean name once and find it by any part", async ({ page }) => {
  const state = await fixtures(page);
  await page.route("**/api/gallery/filters*", (route) =>
    route.fulfill({
      json: {
        models: [
          "image.safetensors",
          "image:test",
          "ideogram-3-fp8.safetensors",
          "Ideogram_3_ComfyUI.safetensors",
          "custom:ideogram-turbo",
        ],
        loras: [],
        sizes: [],
        aspects: [],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  const models = page.getByRole("combobox", { name: "Models", exact: true });
  await models.click();
  // Files and ids read as the composer's names, without folder, backend or quantisation.
  await expect(page.getByRole("option")).toHaveText([
    "Ideogram 3",
    "Ideogram Turbo",
    "Image Quality",
    "Studio Image",
  ]);
  await models.fill("ideo");
  await expect(page.getByRole("option")).toHaveText(["Ideogram 3", "Ideogram Turbo"]);
  await page.getByRole("option", { name: "Ideogram 3", exact: true }).click();
  await models.press("Escape");
  await page.keyboard.press("Escape");
  const chips = page.getByRole("group", { name: "Active Filters", exact: true });
  await expect(chips.getByRole("button", { name: /^Remove / })).toHaveText(["Ideogram 3"]);
  // One name filters by every file it covers.
  await expect
    .poll(() => new URLSearchParams(state.galleryRequests.at(-1)).getAll("model"))
    .toEqual(["ideogram-3-fp8.safetensors", "Ideogram_3_ComfyUI.safetensors"]);
});

test("Gallery filters submit repeated models and origins together with LoRA, size, aspect and date", async ({
  page,
}) => {
  const state = await fixtures(page);
  await page.goto("/");
  const filter = page.getByRole("button", { name: "Gallery Filters", exact: true });
  await filter.click();
  const pick = async (facet: string, option: string) => {
    await page.getByRole("combobox", { name: facet, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
    await page.getByRole("combobox", { name: facet, exact: true }).press("Escape");
  };
  await pick("Models", "Studio Image");
  await pick("Models", "Motion Quality");
  await pick("LoRAs", "Detail Slider");
  const show = page.getByRole("group", { name: "Show", exact: true });
  await show.getByRole("button", { name: "Dream", exact: true }).click();
  await show.getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByRole("button", { name: "Up to 1K", exact: true }).click();
  await page.getByRole("button", { name: "Square", exact: true }).click();
  await page.getByText("Week", { exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(filter).toHaveAttribute("aria-expanded", "false");
  // The active filters show in the toolbar row as removable chips.
  const chips = page.getByRole("group", { name: "Active Filters", exact: true });
  const removable = chips.getByRole("button", { name: /^Remove / });
  await expect(removable).toHaveCount(8);
  await chips.getByRole("button", { name: "Remove Square Filter", exact: true }).click();
  await expect(removable).toHaveCount(7);
  // The search narrows within them.
  const search = await toolbarSearch(page);
  await search.fill("bird");
  await expect
    .poll(() => {
      const query = new URLSearchParams(state.galleryRequests.at(-1));
      return {
        model: query.getAll("model"),
        origin: query.getAll("origin"),
        lora: query.getAll("lora"),
        size: query.getAll("size"),
        aspect: query.getAll("aspect"),
        since: query.has("since"),
        q: query.get("q"),
      };
    })
    .toEqual({
      model: ["image.safetensors", "video.safetensors"],
      origin: ["dream", "chat"],
      lora: ["detail.safetensors"],
      size: ["up-to-1k"],
      aspect: [],
      since: true,
      q: "bird",
    });
  // Closing the phone's search clears it; desktop keeps its box and query.
  const expected = test.info().project.use.isMobile ? "" : "bird";
  await search.press("Escape");
  await page.getByRole("button", { name: "Clear All", exact: true }).click();
  await expect(removable).toHaveCount(0);
  // The cleared search is served fresh from cache or requested again, never with the old facets.
  await expect
    .poll(() =>
      state.galleryRequests.some((search) => {
        const query = new URLSearchParams(search);
        return (
          query.get("q") === expected &&
          !query.has("model") &&
          !query.has("origin") &&
          !query.has("since")
        );
      }),
    )
    .toBe(true);
  await expect(await toolbarSearch(page)).toHaveValue(expected);
});

test("The phone Generations drawer fills the screen height and swipes away", async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.use.isMobile || testInfo.project.use.browserName === "webkit",
    "Touch input is dispatched through Chromium's protocol.",
  );
  await fixtures(page);
  await page.goto("/images");
  await page.getByRole("button", { name: "Open Status", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Queue", exact: true });
  await expect(drawer).toBeVisible();
  const viewport = page.viewportSize()!;
  // Once it has slid in, it spans the full height and most of the width.
  await expect.poll(async () => (await drawer.boundingBox())!.x).toBe(0);
  const box = (await drawer.boundingBox())!;
  expect(box.height).toBe(viewport.height);
  expect(box.width).toBeGreaterThan(viewport.width * 0.8);
  const touch = await page.context().newCDPSession(page);
  const x = viewport.width / 2;
  const y = viewport.height / 2;
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (const step of [40, 80, 150])
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x - step, y }],
    });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(drawer).toBeHidden();
});

test("On a phone held sideways, Gallery Filters fits the screen and scrolls", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, "Touch screens only");
  await fixtures(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/images");
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  const filters = page.locator("[data-chip-popup]");
  await expect(filters).toBeVisible();
  const bottom = async () => {
    const box = (await filters.boundingBox())!;
    return box.y + box.height;
  };
  await expect.poll(bottom).toBeLessThanOrEqual(390);
  // The last filter is reachable by scrolling inside the popup.
  const square = filters.getByRole("button", { name: "Square", exact: true });
  await square.scrollIntoViewIfNeeded();
  await expect(square).toBeInViewport();
});

test("On an iPad held upright, the gallery toolbar fits without scrolling sideways", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.use.isMobile === true, "Tablet width only");
  await fixtures(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/images");
  await expect(page.getByRole("button", { name: "Select Items" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Larger Tiles" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(820);
});

test("The grid heads each day, and the date scrubber names the day while it scrolls the gallery", async ({
  page,
}) => {
  const state = await fixtures(page);
  const day = 86_400_000;
  // Today's, yesterday's, then a long run from a week ago, so the gallery spans many screens.
  state.gallery.push(
    ...results(90).map((item, index) => ({
      ...item,
      createdAt: new Date(Date.now() - (index < 2 ? 0 : index < 4 ? day : 7 * day)).toISOString(),
    })),
  );
  await page.goto("/images");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Yesterday", exact: true })).toBeVisible();
  // Each day starts below the one before.
  const today = (await page.getByRole("heading", { name: "Today" }).boundingBox())!;
  const first = (await page
    .getByRole("button", { name: "Open image: Browse Result 0", exact: true })
    .boundingBox())!;
  expect(first.y).toBeGreaterThan(today.y);
  const yesterday = (await page.getByRole("heading", { name: "Yesterday" }).boundingBox())!;
  expect(yesterday.y).toBeGreaterThan(first.y + first.height);

  const scrubber = page.getByRole("scrollbar", { name: "Gallery Dates" });
  await page.evaluate(() => window.scrollBy(0, 400));
  await expect(scrubber).toHaveAttribute("data-active", "true");
  // Dragging the thumb to the end scrolls to the oldest day, named beside it.
  const thumb = scrubber.locator("div");
  const box = (await thumb.boundingBox())!;
  const track = (await scrubber.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, track.y + track.height, { steps: 5 });
  await expect(scrubber).not.toHaveAttribute("aria-valuetext", /^(Today|Yesterday)$/);
  await expect(thumb).toHaveText((await scrubber.getAttribute("aria-valuetext")) ?? "");
  await page.mouse.up();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  // Virtualisation still renders only the tiles near the screen.
  expect(await page.getByRole("button", { name: /^Open image:/ }).count()).toBeLessThan(90);
});

test("Gallery Dates jumps past unloaded pages and scrolls either way from the chosen date", async ({
  page,
}) => {
  await fixtures(page);
  const days = ["2025-04-04", "2025-04-03", "2025-04-02", "2025-04-01"];
  const created = await page.evaluate(
    (days) =>
      days.map((day) => {
        const [year, month, date] = day.split("-").map(Number);
        return new Date(year, month - 1, date, 12).toISOString();
      }),
    days,
  );
  const items = results(240).map((item, index) => ({
    ...item,
    createdAt: created[Math.floor(index / 60)],
  }));
  const requests: string[] = [];
  let searchedDates = false;
  await page.route("**/api/gallery/timeline?**", (route) => {
    const { searchParams } = new URL(route.request().url());
    const filtered = searchParams.get("q") === "Browse Result 0";
    searchedDates ||= filtered;
    return route.fulfill({
      json: {
        days: filtered
          ? [{ day: days[0], count: 1, cursor: "" }]
          : days.map((day, index) => ({
              day,
              count: 60,
              cursor: index ? `seek-${index}` : "",
            })),
      },
    });
  });
  await page.route("**/api/gallery?**", (route) => {
    const { searchParams } = new URL(route.request().url());
    const cursor = searchParams.get("cursor") || "";
    const before = searchParams.get("beforeCursor") || "";
    const windowed = searchParams.get("window") === "1";
    const search = searchParams.get("q");
    requests.push(before || cursor || (search ? "filtered" : "head"));
    if (windowed && before)
      return route.fulfill({
        json: {
          items: before === "before-1" ? items.slice(0, 60) : items.slice(60, 120),
          previousCursor: before === "before-1" ? "" : "before-1",
          nextCursor: before === "before-1" ? "seek-1" : "seek-2",
          hasMore: true,
          totalApprox: 240,
        },
      });
    if (windowed && cursor)
      return route.fulfill({
        json: {
          items: cursor === "seek-3" ? items.slice(180) : items.slice(120, 180),
          previousCursor: cursor === "seek-3" ? "before-3" : "before-2",
          nextCursor: cursor === "seek-3" ? "" : "seek-3",
          hasMore: cursor !== "seek-3",
          totalApprox: 240,
        },
      });
    return route.fulfill({
      json: {
        items: items.slice(0, search ? 1 : 60),
        previousCursor: "",
        nextCursor: search ? "" : "walk-to-1",
        hasMore: !search,
        totalApprox: search ? 1 : 240,
      },
    });
  });
  await page.goto("/images");
  const scrubber = page.getByRole("scrollbar", { name: "Gallery Dates" });
  await expect(scrubber).toHaveAttribute("data-indexed", "true");
  // Scrolling reveals the date control on touch screens too.
  await page.evaluate(() => window.scrollBy(0, 1));
  await expect(scrubber).toHaveAttribute("data-active", "true");
  const track = (await scrubber.boundingBox())!;
  const x = track.x + track.width / 2;
  await page.mouse.move(x, track.y + track.height / 8);
  await page.mouse.down();
  await page.mouse.move(x, track.y + (track.height * 5) / 8);
  await expect(scrubber).toHaveAttribute("aria-valuetext", `${dayHeading(days[2])} · 60 results`);
  expect(requests).not.toContain("seek-2");
  await page.mouse.up();
  await expect.poll(() => requests.includes("seek-2")).toBe(true);
  expect(requests).not.toContain("walk-to-1");
  await expect(page.getByRole("heading", { name: dayHeading(days[2]) })).toBeInViewport();
  await expect(scrubber).toHaveAttribute("aria-valuetext", `${dayHeading(days[2])} · 60 results`);
  await expect.poll(() => requests.includes("before-2")).toBe(true);
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 120" }),
  ).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => requests.includes("seek-3")).toBe(true);
  await scrubber.press("End");
  await expect(scrubber).toHaveAttribute("aria-valuetext", `${dayHeading(days[3])} · 60 results`);

  await (await toolbarSearch(page)).fill("Browse Result 0");
  await expect.poll(() => searchedDates).toBe(true);
  await expect(page.getByRole("button", { name: "Open image: Browse Result 0" })).toBeVisible();
  await expect(scrubber).toBeHidden();
});

test("The Tags facet lists the most used caption tags with counts and filters by them", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(
    ...results(3).map((item, index) => ({
      ...item,
      caption: { text: "", tags: index ? ["beach", "sunset"] : ["snow"] },
    })),
  );
  await page.goto("/images");
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  // A list, most used first, each with its count.
  await page.getByRole("combobox", { name: "Tags", exact: true }).click();
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options).toHaveText(["beach2", "sunset2", "snow1"]);
  await options.filter({ hasText: "snow" }).click();
  await expect.poll(() => state.galleryRequests.at(-1)).toContain("tag=snow");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 1", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Remove snow Filter", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 1", exact: true }),
  ).toBeVisible();
});

test("The viewer's set strip shows only its own set", async ({ page }) => {
  const state = await fixtures(page);
  // Newest first: set B's results, then set A's.
  state.gallery.push(
    ...[
      ["b-0", "Set B", 0],
      ["a-1", "Set A", 1],
      ["a-0", "Set A", 0],
    ].map(([id, title, index], position) => ({
      ...results(1)[0],
      id,
      prompt: `Prompt ${id}`,
      createdAt: `2026-10-23T00:00:0${3 - position}.000Z`,
      resultSet: { id: title, title, index },
    })),
  );
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Prompt a-1", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await showViewerThumbnails(viewer);
  const strip = viewer.getByRole("list", { name: "Set: Set A", exact: true });
  await expect(strip.getByRole("listitem")).toHaveCount(2);
  await strip.getByRole("listitem", { name: "Show Prompt a-0 (2 of 2)", exact: true }).click();
  await expect(viewer.getByRole("img", { name: "Prompt a-0", exact: true })).toBeVisible();
});

test("A result of work started elsewhere shows as soon as its job finishes", async ({ page }) => {
  const state = await fixtures(page);
  state.gallery.push(...results(1));
  await page.goto("/images");
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }),
  ).toBeVisible();
  // An MCP client's job, finished between the idle queue's checks.
  state.jobs.push({
    id: "elsewhere",
    sessionId: "s",
    operation: "image",
    status: "completed",
    reason: "",
    input: { prompt: "Made Elsewhere", profileId: "image:test" },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
  state.gallery.unshift({
    ...results(1)[0],
    id: "elsewhere-0",
    jobId: "elsewhere",
    prompt: "Made Elsewhere",
  });
  await expect(
    page.getByRole("button", { name: "Open image: Made Elsewhere", exact: true }),
  ).toBeVisible();
});

test("Returning to the tab reads the gallery's newest results at once", async ({ page }) => {
  const state = await fixtures(page);
  state.gallery.push(...results(1));
  await page.goto("/images");
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }),
  ).toBeVisible();
  const visibility = (hidden: boolean) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => (hidden ? "hidden" : "visible"),
      });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    }, hidden);
  await visibility(true);
  // Saved from another app while Studio was hidden: no job announces it.
  state.gallery.unshift({ ...results(1)[0], id: "away-0", prompt: "Saved While Away" });
  await visibility(false);
  await expect(
    page.getByRole("button", { name: "Open image: Saved While Away", exact: true }),
  ).toBeVisible();
});

test("The open item is in the URL: Back closes the viewer and a link opens it", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(...results(2).map((item, index) => ({ ...item, number: 41 + index })));
  // An item not on a loaded page is read on its own.
  const unlisted = { ...results(1)[0], id: "unlisted", number: 43, prompt: "Unlisted Result" };
  await page.route("**/api/gallery/results/43", (route) =>
    route.fulfill({ json: { item: unlisted } }),
  );
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(page).toHaveURL(/\/images\/41$/);
  await expect(viewer.getByRole("img", { name: "Browse Result 0", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/images\/42$/);
  await page.goBack();
  await expect(viewer).toBeHidden();
  await expect(page).toHaveURL(/\/images$/);
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 1", exact: true }),
  ).toBeFocused();
  await page.goForward();
  await expect(page).toHaveURL(/\/images\/42$/);
  await expect(viewer).toBeVisible();
  await page.goto("/images/43");
  await expect(viewer.getByRole("img", { name: "Unlisted Result", exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page).toHaveURL(/\/images$/);
  // Links shared before items had their own paths still open them, at the new path.
  await page.goto("/images?item=browse-0");
  await expect(viewer.getByRole("img", { name: "Browse Result 0", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/images\/41$/);
  await page.goto("/images/999999999");
  await expect(page.getByText("That item is no longer in the gallery.")).toBeVisible();
  await expect(viewer).toBeHidden();
});

test("Desktop gallery controls stay available while scrolling and rating changes preserve search", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.use.isMobile === true, "Desktop toolbar only");
  const state = await fixtures(page);
  state.gallery.push(...results(90));
  await page.goto("/images");
  const filter = page.getByRole("button", { name: "Gallery Filters", exact: true });
  await expect(filter).toHaveAttribute("aria-expanded", "false");
  // Liked and Disliked are filters in the panel, not toolbar buttons.
  await expect(page.getByRole("button", { name: "Liked", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Disliked", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Gallery Selection", exact: true }).getByRole("status"),
  ).toHaveText("90 Selected");
  await page.evaluate(() => window.scrollBy(0, 800));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(selectionAction(page, "Download")).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await expect(filter).toBeInViewport({ ratio: 1 });
  await filter.click();
  await expect(page.getByRole("combobox", { name: "Models", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const search = await toolbarSearch(page);
  await search.fill("Browse");
  await toggleGalleryFilter(page, "Liked");
  const likedChip = page.getByRole("button", { name: "Remove Liked Filter", exact: true });
  await expect(likedChip).toBeVisible();
  // Disliked takes Liked's place.
  await toggleGalleryFilter(page, "Disliked");
  await expect(likedChip).toHaveCount(0);
  await expect
    .poll(() => {
      const query = new URLSearchParams(state.galleryRequests.at(-1));
      return [query.get("q"), query.get("rating")];
    })
    .toEqual(["Browse", "disliked"]);
  await expect(search).toHaveValue("Browse");
  const dislikedChip = page.getByRole("button", { name: "Remove Disliked Filter", exact: true });
  await expect(dislikedChip).toBeVisible();
  await filter.click();
  await page.getByText("Week", { exact: true }).click();
  await page.keyboard.press("Escape");
  // Clear All takes every filter, Disliked included.
  await page.getByRole("button", { name: "Clear All", exact: true }).click();
  await expect(dislikedChip).toHaveCount(0);
  await toggleGalleryFilter(page, "Liked");
  await filter.click();
  await expect(page.getByRole("radio", { name: "Any", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("Browse");
  // Filters persist across reloads; the transient search does not.
  await page.reload();
  await expect
    .poll(() => {
      const query = new URLSearchParams(state.galleryRequests.at(-1));
      return [query.get("q"), query.get("rating"), query.has("since"), query.has("comparisons")];
    })
    .toEqual(["", "liked", false, false]);
});

test("Incoming results wait behind New Results while scrolled, keeping loaded pages, the scroll anchor and selection", async ({
  page,
}) => {
  const state = await fixtures(page);
  const original = results(120);
  let incoming: typeof original = [];
  const requests: string[] = [];
  await page.route("**/api/gallery?**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor") || "";
    requests.push(cursor);
    return route.fulfill({
      json: {
        items: cursor ? original.slice(60) : [...incoming, ...original].slice(0, 60),
        nextCursor: cursor ? "" : "older",
        hasMore: !cursor,
        totalApprox: original.length + incoming.length,
      },
    });
  });
  await page.goto("/images");
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  const firstHeight = await page
    .locator("[data-gallery-view]")
    .evaluate((host) => host.style.height);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => requests.includes("older")).toBe(true);
  await expect
    .poll(() => page.locator("[data-gallery-view]").evaluate((host) => host.style.height))
    .not.toBe(firstHeight);
  // Exercise the date scrubber too: it must stay interactive over the sticky toolbar.
  await page.evaluate(() => window.scrollBy(0, 1));
  const scrubber = page.getByRole("scrollbar", { name: "Gallery Dates", exact: true });
  await expect(scrubber).toHaveAttribute("data-active", "true");
  const track = (await scrubber.boundingBox())!;
  const thumb = (await scrubber.locator("div").first().boundingBox())!;
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width / 2, track.y + track.height * 0.6, { steps: 4 });
  await page.mouse.up();
  const selectedTile = page.getByRole("button", {
    name: "Select image: Browse Result 70",
    exact: true,
  });
  await selectedTile.scrollIntoViewIfNeeded();
  await selectedTile.click();
  await expect(selectedTile).toHaveAttribute("aria-pressed", "true");
  const before = await selectedTile.boundingBox();
  const heightBefore = await page
    .locator("[data-gallery-view]")
    .evaluate((host) => host.style.height);
  const previousReads = requests.length;
  const point = { x: before!.x + before!.width / 2, y: before!.y + before!.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  incoming = results(5).map((item, index) => ({
    ...item,
    id: `incoming-${index}`,
    prompt: `Incoming ${index}`,
  }));
  state.jobs.push({
    id: "incoming",
    sessionId: "s",
    operation: "image",
    status: "completed",
    input: { prompt: "Incoming", profileId: "image:test" },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
  await expect.poll(() => requests.length).toBeGreaterThan(previousReads);
  const pill = page.getByRole("button", { name: "New Results", exact: true });
  const selection = page.getByRole("group", { name: "Gallery Selection", exact: true });
  await expect(pill).toBeInViewport();
  await expect
    .poll(async () => {
      const [banner, controls] = await Promise.all([pill.boundingBox(), selection.boundingBox()]);
      return Boolean(banner && controls && banner.y >= controls.y + controls.height);
    })
    .toBe(true);
  expect(await page.locator("[data-gallery-view]").evaluate((host) => host.style.height)).toBe(
    heightBefore,
  );
  await expect(selection.getByRole("status")).toHaveText("1 Selected");
  await expect(selectedTile).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => Math.abs((await selectedTile.boundingBox())!.y - before!.y))
    .toBeLessThan(2);
  // An arrival during a tap must keep the hit target over the gallery, not a toolbar filter.
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Remove Liked Filter", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Gallery View", exact: true })).toHaveText(
    "Gallery",
  );
  await expect(page.getByRole("button", { name: "Gallery Filters", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(requests.filter(Boolean)).toEqual(["older"]);
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(
    page.getByRole("button", { name: "Open image: Incoming 0", exact: true }),
  ).toBeVisible();
});

test("Work stopped elsewhere leaves the open Gallery when the queue refreshes", async ({
  page,
}) => {
  const state = await fixtures(page);
  const [ready] = results(1);
  state.gallery.push(
    {
      ...ready,
      id: "stopped-item",
      jobId: "stopped-job",
      title: "Queued Result",
      status: "pending",
      url: "",
    },
    ready,
  );
  const job = {
    id: "stopped-job",
    sessionId: "s",
    operation: "image",
    status: "queued",
    input: { prompt: "Queued Result", profileId: "image:test" },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
  state.jobs.push(job);
  await page.goto("/images");
  const queued = page.getByRole("button", { name: "Open image: Queued Result", exact: true });
  const finished = page.getByRole("button", { name: "Open image: Browse Result 0", exact: true });
  await expect(queued).toBeVisible();
  await expect(finished).toBeVisible();

  job.status = "cancelled";
  state.gallery.shift();
  await expect(queued).toHaveCount(0);
  await expect(finished).toBeVisible();
});

test("Incoming results keep the viewer on its current item and return focus to that tile", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(...results(30));
  await page.goto("/images");
  const tile = page.getByRole("button", { name: "Open image: Browse Result 10", exact: true });
  await tile.click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(viewer.getByRole("img", { name: "Browse Result 10", exact: true })).toBeVisible();
  const previousReads = state.galleryRequests.length;
  state.gallery.unshift({ ...results(1)[0], id: "incoming-viewer", prompt: "Incoming In Viewer" });
  state.jobs.push({
    id: "incoming-viewer",
    sessionId: "s",
    operation: "image",
    status: "completed",
    input: { prompt: "Incoming", profileId: "image:test" },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
  await expect.poll(() => state.galleryRequests.length).toBeGreaterThan(previousReads);
  await expect(viewer.getByRole("img", { name: "Browse Result 10", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/images\/browse-10$/);
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await expect(tile).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(
    page.getByRole("button", { name: "Open image: Incoming in Viewer", exact: true }),
  ).toBeVisible();
});

test("A result loaded at the front is reachable to the left of an open viewer", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(...results(3));
  await page.goto("/images/browse-0");
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(currentResult(viewer)).toHaveText("1 / 3");
  const [first] = results(1);
  state.gallery.unshift({ ...first, id: "viewer-arrival", prompt: "New Arrival" });
  state.jobs.push({
    id: "viewer-arrival",
    sessionId: "s",
    operation: "image",
    status: "completed",
    input: { prompt: "New Arrival", profileId: "image:test" },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });

  await expect(currentResult(viewer)).toHaveText("2 / 4");
  await expect(viewer.getByRole("img", { name: "Browse Result 0", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByRole("img", { name: "New Arrival", exact: true })).toBeVisible();
  await expect(currentResult(viewer)).toHaveText("1 / 4");
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByRole("img", { name: "Browse Result 0", exact: true })).toBeVisible();
});

test("Returning after more than a page of incoming results leaves no gap before held items", async ({
  page,
}) => {
  await fixtures(page);
  const original = results(10);
  let incoming: typeof original = [];
  const cursors: string[] = [];
  let release!: () => void;
  const initialRefresh = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/gallery?**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor") || "";
    cursors.push(cursor);
    const matches = [...incoming, ...original];
    // Return while the startup head refresh still holds the old results.
    if (cursors.length === 2) await initialRefresh;
    const start = Number(cursor);
    return route.fulfill({
      json: {
        items: matches.slice(start, start + 60),
        hasMore: start + 60 < matches.length,
        nextCursor: start + 60 < matches.length ? String(start + 60) : "",
        totalApprox: matches.length,
      },
    });
  });
  await page.goto("/images/browse-0");
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(currentResult(viewer)).toHaveText("1 / 10");
  await expect.poll(() => cursors.length).toBe(2);
  const visibility = (hidden: boolean) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => (hidden ? "hidden" : "visible"),
      });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    }, hidden);
  await visibility(true);
  incoming = results(65).map((item, index) => ({
    ...item,
    id: `away-${index}`,
    prompt: `Away ${index}`,
  }));
  const previousReads = cursors.length;
  try {
    await visibility(false);
  } finally {
    release();
  }
  await expect.poll(() => cursors.length).toBe(previousReads + 2);
  await expect(currentResult(viewer)).toHaveText("66 / 75");
  await expect(page).toHaveURL(/\/images\/browse-0$/);
  expect(cursors.slice(previousReads)).toEqual(["", "60"]);
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByRole("img", { name: "Away 64", exact: true })).toBeVisible();
  await expect(currentResult(viewer)).toHaveText("65 / 75");
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByRole("img", { name: "Browse Result 0", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByRole("img", { name: "Browse Result 1", exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 1", exact: true }),
  ).toBeFocused();
  await page
    .locator("[data-gallery-view]")
    .evaluate((host) =>
      window.scrollTo(
        0,
        host.getBoundingClientRect().top + window.scrollY + (host.clientHeight * 64) / 75,
      ),
    );
  await expect(
    page.getByRole("button", { name: "Open image: Away 64", exact: true }),
  ).toBeVisible();
});

test("Viewer navigation keeps decoded media visible while the next image loads and advances once", async ({
  page,
}) => {
  const state = await fixtures(page);
  const nextUrl = "/sample-media/delayed-next.svg";
  state.gallery.push(
    results(1)[0],
    { ...results(2)[1], url: nextUrl, thumbnailUrl: nextUrl },
    { ...results(3)[2], id: "third" },
  );
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/sample-media/delayed-next.svg", async (route) => {
    requested = true;
    await pending;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: decodeURIComponent(image.slice(image.indexOf(",") + 1)),
    });
  });
  await page.goto("/images/browse-0");
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  const previous = viewer.getByRole("img", { name: "Browse Result 0", exact: true });
  await expect(previous).toBeVisible();
  await previous.evaluate((node: HTMLImageElement) => node.decode());
  try {
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/\/images\/browse-1$/);
    await expect.poll(() => requested).toBe(true);
    await expect(previous).toBeVisible();
    await expect(previous).toHaveAttribute("src", image);
  } finally {
    release();
  }
  await expect(viewer.getByRole("img", { name: "Browse Result 1", exact: true })).toHaveAttribute(
    "src",
    nextUrl,
  );
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/images\/third$/);
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/images\/third$/);
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/\/images\/browse-1$/);
});

test("A pending output becomes saved media without losing the viewer or its return focus", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push({
    ...results(1)[0],
    id: "working-0",
    jobId: "working",
    index: 0,
    status: "pending",
    url: "",
  });
  state.jobs.push({
    id: "working",
    sessionId: "s",
    operation: "image",
    status: "running",
    input: { prompt: "Browse Result 0", profileId: "image:test" },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
  await page.goto("/images/working-0");
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(viewer).toBeVisible();
  state.gallery[0] = {
    ...state.gallery[0],
    id: "saved-output",
    number: 501,
    status: "done",
    url: image,
  };
  state.jobs[0].status = "completed";
  await expect(viewer.getByRole("img", { name: "Browse Result 0", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/images\/501$/);
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }),
  ).toBeFocused();
  await expect(page.locator('[data-media-id="working-0"]')).toHaveCount(0);
  await expect(page.locator('[data-media-id="saved-output"]')).toBeFocused();
});

for (const navigation of ["arrows", "keyboard", "swipe"] as const)
  test(`Dislike preserves viewer neighbours, Undo and bounds with ${navigation}`, async ({
    page,
  }, testInfo) => {
    const phone = testInfo.project.use.isMobile === true;
    test.skip(navigation === "arrows" && phone, "Phones use swipes instead of arrow buttons");
    test.skip(navigation === "swipe" && !phone, "Phone touch navigation");
    const state = await fixtures(page);
    state.gallery.push(...results(3));
    await page.goto("/images/browse-1");
    const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
    await expect(viewer.getByRole("img", { name: "Browse Result 1", exact: true })).toBeVisible();
    async function move(direction: "next" | "previous", atBound = false) {
      if (navigation === "arrows") {
        const arrow = viewer.getByRole("button", {
          name: direction === "next" ? "Next Generation" : "Previous Generation",
          exact: true,
        });
        if (atBound) await expect(arrow).toBeDisabled();
        else await arrow.click();
      } else if (navigation === "keyboard")
        await page.keyboard.press(direction === "next" ? "ArrowRight" : "ArrowLeft");
      else {
        const photo = viewer.getByRole("img");
        const start = direction === "next" ? (page.viewportSize()?.width ?? 390) - 1 : 1;
        const end = direction === "next" ? start - 160 : start + 160;
        // WebKit's OS history gesture is not emulated; verify the cancellable edge start and
        // the same viewer navigation, including bounds, that follows it.
        expect(
          await photo.evaluate((target, x) => {
            const contact = { identifier: 7, target, clientX: x, clientY: 250 };
            const event = new Event("touchstart", { bubbles: true, cancelable: true });
            Object.defineProperties(event, {
              touches: { value: [contact] },
              targetTouches: { value: [contact] },
              changedTouches: { value: [contact] },
            });
            return target.dispatchEvent(event);
          }, start),
        ).toBe(false);
        const pointer = {
          pointerId: 7,
          pointerType: "touch",
          button: 0,
          clientY: 250,
          isPrimary: true,
        };
        await photo.dispatchEvent("pointerdown", { ...pointer, clientX: start });
        await photo.dispatchEvent("pointermove", { ...pointer, clientX: end });
        await photo.dispatchEvent("pointerup", { ...pointer, clientX: end });
        await photo.dispatchEvent("touchend", { touches: [], changedTouches: [] });
      }
    }
    const saved = page.waitForResponse("**/api/gallery/favorite");
    await viewer.getByRole("button", { name: "Dislike", exact: true }).focus();
    await page.keyboard.press("Space");
    await expect.poll(() => state.gallery[1].rating).toBe("disliked");
    await saved;
    await expect(
      viewer.getByRole("button", { name: "Dislike", pressed: true, exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Open image: Browse Result 1", exact: true }),
    ).toHaveCount(0);
    await expect(viewer.getByRole("img", { name: "Browse Result 1", exact: true })).toBeVisible();
    await move("next");
    await expect(page).toHaveURL(/\/images\/browse-2$/);
    await expect(viewer.getByRole("img", { name: "Browse Result 2", exact: true })).toBeVisible();
    await move("previous");
    await expect(page).toHaveURL(/\/images\/browse-1$/);
    await expect(viewer.getByRole("img", { name: "Browse Result 1", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => state.gallery[1].rating).toBeUndefined();
    await expect(
      page.getByRole("button", { name: "Open image: Browse Result 1", exact: true }),
    ).toHaveCount(1);
    await move("previous");
    await expect(page).toHaveURL(/\/images\/browse-0$/);
    await expect(viewer.getByRole("img", { name: "Browse Result 0", exact: true })).toBeVisible();
    await move("previous", true);
    await expect(page).toHaveURL(/\/images\/browse-0$/);
    await move("next");
    await expect(page).toHaveURL(/\/images\/browse-1$/);
    await expect(viewer.getByRole("img", { name: "Browse Result 1", exact: true })).toBeVisible();
    await move("next");
    await expect(page).toHaveURL(/\/images\/browse-2$/);
    await expect(viewer.getByRole("img", { name: "Browse Result 2", exact: true })).toBeVisible();
    await move("next", true);
    await expect(page).toHaveURL(/\/images\/browse-2$/);
    await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open image: Browse Result 2", exact: true }),
    ).toBeFocused();
  });

test("Closing a disliked item focuses its next visible gallery neighbour", async ({ page }) => {
  const state = await fixtures(page);
  state.gallery.push(...results(3));
  await page.goto("/images/browse-1");
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(viewer.getByRole("img", { name: "Browse Result 1", exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Dislike", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect.poll(() => state.gallery[1].rating).toBe("disliked");
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 1", exact: true }),
  ).toHaveCount(0);
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 2", exact: true }),
  ).toBeFocused();
});

test("Completing every held pending output refreshes one head page without walking history", async ({
  page,
}) => {
  const state = await fixtures(page);
  const held = results(60).map((item, index) => ({
    ...item,
    id: `working-${index}`,
    jobId: "working",
    index,
    status: "pending",
    url: "",
  }));
  const saved = held.map((item, index) => ({
    ...item,
    id: `saved-${index}`,
    status: "done",
    url: image,
  }));
  state.jobs.push({
    id: "working",
    sessionId: "s",
    operation: "image",
    status: "running",
    input: { profileId: "image:test" },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
  const cursors: string[] = [];
  await page.route("**/api/gallery?**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor") || "";
    cursors.push(cursor);
    return route.fulfill({
      json: {
        items: cursor ? results(60) : state.jobs[0].status === "completed" ? saved : held,
        hasMore: !cursor,
        nextCursor: cursor ? "" : "history",
        totalApprox: 120,
      },
    });
  });
  await page.goto("/images/working-0");
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(viewer).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Status", exact: true })).toHaveAttribute(
    "aria-description",
    /^Generating/,
  );
  const previousReads = cursors.length;
  state.jobs[0].status = "completed";
  await expect(viewer.getByRole("img", { name: "Browse Result 0", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/images\/saved-0$/);
  expect(cursors.slice(previousReads)).toEqual([""]);
});

test("The final job completing during pagination defers one head refresh until the page settles", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.jobs.push({
    id: "working",
    sessionId: "s",
    operation: "image",
    status: "running",
    input: { profileId: "image:test" },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
  const original = results(120);
  const finished = { ...original[0], id: "finished-0", prompt: "Finished While Paging" };
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let paging = false;
  const cursors: string[] = [];
  await page.route("**/api/gallery?**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor") || "";
    cursors.push(cursor);
    if (cursor) {
      paging = true;
      await held;
    }
    const completed = state.jobs[0].status === "completed";
    await route.fulfill({
      json: {
        items: cursor
          ? original.slice(60)
          : completed
            ? [finished, ...original.slice(0, 59)]
            : original.slice(0, 60),
        hasMore: !cursor,
        nextCursor: cursor ? "" : "older",
        totalApprox: completed ? 121 : 120,
      },
    });
  });
  await page.goto("/images/browse-59");
  const status = page.getByRole("button", { name: "Open Status", exact: true });
  await expect(status).toHaveAttribute("aria-description", /^Generating/);
  await expect.poll(() => paging).toBe(true);
  const previousReads = cursors.length;
  try {
    state.jobs[0].status = "completed";
    await expect(status).not.toHaveAttribute("aria-description", /^Generating/);
    expect(cursors.length).toBe(previousReads);
  } finally {
    release();
  }
  await expect.poll(() => cursors.slice(previousReads)).toEqual([""]);
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(viewer.getByRole("img", { name: "Browse Result 59", exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  // Let the viewer reveal its current tile before scrolling away from it.
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 59", exact: true }),
  ).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(
    page.getByRole("button", { name: "Open image: Finished While Paging", exact: true }),
  ).toBeVisible();
  expect(cursors.filter(Boolean)).toEqual(["older"]);
});

for (const captions of [false, true])
  test(`Phone gallery holds open item menus with captions ${captions ? "shown" : "hidden"}`, async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.use.isMobile, "Phone touch menus");
    const state = await fixtures(page);
    state.preferences.preferences.tileCaptions = captions;
    state.gallery.push(...results(2));
    await page.goto("/images");
    const first = page.getByRole("button", { name: "Open image: Browse Result 0", exact: true });
    const second = page.getByRole("button", { name: "Open image: Browse Result 1", exact: true });
    await touch(first, "touchstart");
    await touch(first, "touchmove", 140);
    await touch(first, "touchend", 140);
    await touch(second, "touchstart");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await touch(second, "touchend");
    // Native contextmenu after the hold must not open a second surface.
    expect(
      await second.evaluate(
        (node) =>
          !node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
      ),
    ).toBe(true);
    await second.dispatchEvent("click");
    await expect(menu).toHaveCount(1);
    await expect(menu).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toBeHidden();
    await expect(page.getByRole("group", { name: "Gallery Selection", exact: true })).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await first.click();
    await expect(
      page
        .getByRole("dialog", { name: "Generation", exact: true })
        .getByRole("img", { name: "Browse Result 0", exact: true }),
    ).toBeVisible();
  });

test("Comparisons lists each comparison and kept Dream comparison as a card that opens all its variants", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(...results(4).map((item, index) => ({ ...item, jobId: `job-${index}` })));
  state.comparisons.push(
    {
      id: "dream-pair",
      seed: "5",
      requests: [
        { input: { prompt: "Browse Result 2" } },
        { input: { prompt: "Browse Result 3" } },
      ],
      jobIds: ["job-2", "job-3"],
      itemIds: ["browse-2", "browse-3"],
      labels: ["20 Steps", "30 Steps"],
      vote: "job-3",
      winnerItemId: "browse-3",
      dream: { question: "Which Steps?" },
    },
    {
      id: "compare-1",
      seed: "",
      requests: [
        { input: { prompt: "Browse Result 0" } },
        { input: { prompt: "Browse Result 1" } },
      ],
      jobIds: ["job-0", "job-1"],
      itemIds: ["browse-0", "browse-1"],
      labels: ["Variant A", "Variant B"],
      vote: null,
    },
  );
  await page.goto("/images");
  await showGalleryView(page, "Comparisons");
  // A kept Dream comparison opens read-only, its kept side as the winner.
  await page.getByRole("button", { name: "Open Comparison: Which Steps?", exact: true }).click();
  await expect(page).toHaveURL(/\/compare\/dream-pair$/);
  await expect(page.getByRole("button", { name: "Open 30 Steps", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Pick|Clear Winner)/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to Comparisons", exact: true }).click();
  const card = page.getByRole("button", { name: "Open Comparison: Browse Result 0", exact: true });
  await expect(card).toBeVisible();
  await expect(page.getByText(/^2 Variants\b/)).toHaveCount(2);
  // One card per comparison, without the gallery's tiles.
  await expect(page.getByRole("button", { name: /^Open (Comparison|image):/ })).toHaveCount(2);
  await card.click();
  await expect(page).toHaveURL(/\/compare\/compare-1$/);
  for (const label of ["Variant A", "Variant B"])
    await expect(page.getByRole("button", { name: `Open ${label}`, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to Comparisons", exact: true }).click();
  await expect(page.getByRole("button", { name: "Gallery View", exact: true })).toHaveText(
    "Comparisons",
  );
  await showGalleryView(page, "Gallery");
  await expect(
    page.getByRole("button", { name: "Open image: Browse Result 2", exact: true }),
  ).toBeVisible();
});

test("Saved views keep a search, filters and sort with the account and show their counts", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(...results(3));
  await page.goto("/images");
  const view = page.getByRole("button", { name: "Gallery View", exact: true });
  const tile = (index: number) =>
    page.getByRole("button", { name: `Open image: Browse Result ${index}`, exact: true });
  const menu = async (item: string) => {
    await view.click();
    await page.getByRole("menuitem", { name: item, exact: true }).click();
  };
  const name = async (title: string, value: string) => {
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(value);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
  };
  const search = await toolbarSearch(page);
  await search.fill("Result 1");
  await expect(tile(0)).toHaveCount(0);
  // Save View names it after what the gallery shows.
  await menu("Save View…");
  await expect(
    page
      .getByRole("dialog", { name: "Save View", exact: true })
      .getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Result 1");
  await name("Save View", "Ones");
  await expect(view).toHaveText("Ones");
  await expect
    .poll(() => state.preferences.preferences.galleryViews)
    .toMatchObject([
      { name: "Ones", search: "Result 1", sort: "newest", filters: { uploads: false } },
    ]);
  // Leaving it shows the whole gallery; choosing it restores its search, with its count.
  await menu("Gallery");
  await expect(tile(0)).toBeVisible();
  await view.click();
  await expect(page.getByRole("menuitem", { name: "Ones", exact: true })).toContainText("1");
  await page.getByRole("menuitem", { name: "Ones", exact: true }).click();
  await expect(view).toHaveText("Ones");
  await expect(tile(1)).toBeVisible();
  await expect(tile(0)).toHaveCount(0);
  await menu("Rename View…");
  await name("Rename View", "Singles");
  await expect(view).toHaveText("Singles");
  await menu("Delete View");
  await page
    .getByRole("dialog", { name: "Delete View", exact: true })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(view).toHaveText("Gallery");
  await expect.poll(() => state.preferences.preferences.galleryViews).toEqual([]);
});
