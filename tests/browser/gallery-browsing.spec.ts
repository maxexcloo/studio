import { expect, test } from "@playwright/test";
import {
  closeReferences,
  expandComposer,
  fixtures,
  toolbarSearch,
  image,
  selectionAction,
  selectionMenuItem,
  showOnly,
  stamp,
  touch,
} from "./fixtures";
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
  await page.goto("/images?item=browse-59");
  const viewer = page.getByRole("dialog");
  await expect(viewer.getByText("60 / 61", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/item=browse-60/);
  await expect(viewer.getByText("61 / 61", { exact: true })).toBeVisible();
});

test("Select All takes every match across pages, and the search and Starred stay while selecting", async ({
  page,
}) => {
  await fixtures(page);
  // Every other result is starred; the gallery pages them 60 at a time unless asked for more.
  const items = results(130).map((item, index) => ({ ...item, favorite: index % 2 === 0 }));
  const requests: URLSearchParams[] = [];
  await page.route("**/api/gallery?**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    requests.push(query);
    const matches = items.filter(
      (item) =>
        item.prompt.includes(query.get("q") || "") &&
        (query.get("favorites") !== "1" || item.favorite),
    );
    const start = Number(query.get("cursor") || 0);
    const end = start + Number(query.get("limit"));
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
  const starred = page.getByRole("button", { name: "Starred", exact: true });
  await starred.click();
  await expect(starred).toHaveAttribute("aria-pressed", "true");
  await (await toolbarSearch(page)).fill("Browse");
  await expect.poll(() => requests.at(-1)?.get("q")).toBe("Browse");
  const select = page.getByRole("button", { name: "Select Items", exact: true });
  await select.click();
  // Select stays in place, pressed, while selecting.
  await expect(select).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "Search Gallery", exact: true })).toHaveValue(
    "Browse",
  );
  await page.getByRole("button", { name: "Select All", exact: true }).click();
  const status = page.getByRole("group", { name: "Gallery Selection" }).getByRole("status");
  await expect(status).toHaveText("65 Selected");
  // The rest loaded in one larger page, within the same search and filter.
  const rest = requests.find((query) => query.get("limit") === "500");
  expect([rest?.get("q"), rest?.get("favorites")]).toEqual(["Browse", "1"]);
  // With everything selected, Select None takes Select All's place.
  await expect(page.getByRole("button", { name: "Select All", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Select None", exact: true }).click();
  await expect(status).toHaveText("0 Selected");
  await expect(page.getByRole("button", { name: "Select None", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Select All", exact: true }).click();
  await expect(status).toHaveText("65 Selected");
  const unstar = page.waitForRequest("**/api/gallery/favorite");
  await selectionAction(page, "Unstar").click();
  expect((await unstar).postDataJSON().ids).toHaveLength(65);
  // A finished action ends the selection.
  await expect(select).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("textbox", { name: "Search Gallery", exact: true })).toHaveValue(
    "Browse",
  );
  expect([requests.at(-1)?.get("q"), requests.at(-1)?.get("favorites")]).toEqual(["Browse", "1"]);
  // Pressing Select again ends selection too.
  await select.click();
  await select.click();
  await expect(page.getByRole("group", { name: "Gallery Selection" })).toHaveCount(0);
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

test("Single-item viewer keyboard actions star and request deletion through the existing confirmation", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(...results(1));
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(viewer).toBeVisible();
  await page.keyboard.press("f");
  await expect.poll(() => state.gallery[0].favorite).toBe(true);
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
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  const picker = page.getByRole("region", { name: "References", exact: true });
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
  // With captions shown, holding selects; without, it opens the tile's menu (tile-actions.spec.ts).
  state.preferences.preferences.tileCaptions = true;
  await page.goto("/images");
  const first = page.getByRole("button", { name: "Open image: Browse Result 0", exact: true });
  const second = page.getByRole("button", { name: "Open image: Browse Result 1", exact: true });
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
  await selectionAction(page, "Star").click();
  await expect.poll(() => state.gallery[1].favorite).toBe(true);
  expect(state.gallery[0].favorite).not.toBe(true);
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
  const attempts: string[] = [];
  let failSecond = true;
  await page.route("**/api/queue/*/retry", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[3];
    attempts.push(id);
    if (id === "batch-a") await held;
    if (id === "batch-b" && failSecond) {
      await route.fulfill({ status: 503, json: { error: "Second worker remains offline" } });
      return;
    }
    const job = {
      ...state.jobs.find((job) => job.id === id),
      id: `retried-${id}`,
      status: "queued",
    };
    state.jobs.push(job);
    await route.fulfill({ json: { job } });
  });
  try {
    await page.goto("/images");
    await page.getByRole("button", { name: "Select Items", exact: true }).click();
    await page.getByRole("button", { name: "Select All", exact: true }).click();
    const selection = page.getByRole("group", { name: "Gallery Selection", exact: true });
    await expect(selection.getByRole("status")).toHaveText("4 Selected");
    const retry = selectionAction(page, "Retry");
    await retry.click();
    await expect(retry).toBeDisabled();
    await retry.dispatchEvent("click");
    expect(attempts).toEqual(["batch-a"]);
    release();
    // Only the item whose retry failed stays selected.
    await expect(selection.getByRole("status")).toHaveText("1 Selected");
    expect(attempts).toEqual(["batch-a", "batch-b"]);
    await expect(
      page.getByRole("checkbox", { name: "Select Failed third", exact: true }),
    ).toBeChecked();
    // The accepted retry's new tiles replace its failed ones.
    await expect(
      page.getByRole("checkbox", { name: "Select Failed first", exact: true }),
    ).toHaveCount(0);
    failSecond = false;
    await retry.click();
    // Once every retry is accepted the selection ends.
    await expect(selection).toHaveCount(0);
    expect(attempts).toEqual(["batch-a", "batch-b", "batch-b"]);
  } finally {
    release();
  }
});

test("Runs fan a stacked run out in place and open it to flip through", async ({ page }) => {
  const state = await fixtures(page);
  state.gallery.push(
    ...results(3).map((item, index) => ({
      ...item,
      id: `run-${index}`,
      jobId: "run-job",
      prompt: `Bird study ${index}`,
    })),
    ...results(1),
  );
  await page.goto("/images");
  // The view is a Filter choice; the popup closes like any other.
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await page.getByText("Runs", { exact: true }).click();
  await page.keyboard.press("Escape");
  const stack = page.getByRole("button", { name: "Run: Bird study 0, 3 Images", exact: true });
  await stack.click();
  await expect(stack).toHaveAttribute("aria-expanded", "true");
  const run = page.getByRole("region", { name: "Run: Bird study 0", exact: true });
  await expect(run.getByRole("button", { name: /^Open image: Bird study/ })).toHaveCount(3);
  await run.getByRole("button", { name: "Open image: Bird study 2", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  // A run's result flips through that run alone, as Open All does from its first.
  await expect(viewer.getByText(/^\d \/ 3$/)).toBeVisible();
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await run.getByRole("button", { name: "Open All", exact: true }).click();
  await expect(viewer.getByRole("img", { name: "Bird study 0", exact: true })).toBeVisible();
  await expect(viewer.getByText("1 / 3", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await run.getByRole("button", { name: "Close Run", exact: true }).click();
  await expect(run).toBeHidden();
  await expect(stack).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Runs" })).toBeChecked();
});

test("An MCP result set is one titled run whose viewer names each result's place and jumps along its strip", async ({
  page,
}, testInfo) => {
  // Phones show only the place; Details names the set.
  const place = (title: string, index: number) =>
    testInfo.project.use.isMobile ? `${index} / 3` : `Variety Test › ${title} (${index} of 3)`;
  const state = await fixtures(page);
  const set = { id: "set-a", title: "Variety Test", source: "LibreChat" };
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
    page.getByRole("button", { name: "Open image: Set prompt 1", exact: true }),
  ).toBeVisible();
  // Runs stacks the set under its title, in prompt order.
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await page.getByText("Runs", { exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Run: Variety Test, 3 Images", exact: true }).click();
  const run = page.getByRole("region", { name: "Run: Variety Test", exact: true });
  const tiles = run.getByRole("button", { name: /^Open image: / });
  await expect(tiles).toHaveCount(3);
  expect(await tiles.evaluateAll((all) => all.map((tile) => tile.ariaLabel))).toEqual([
    "Open image: Fox Wizard",
    "Open image: Set prompt 1",
    "Open image: Bear Hug",
  ]);
  // The viewer names the result's place in its set and jumps along the set's strip.
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  // WebKit can drop a tap while the run's tiles are still fanning out.
  await expect(async () => {
    if (!(await viewer.isVisible()))
      await run.getByRole("button", { name: "Open All", exact: true }).click();
    await expect(viewer.getByText(place("Fox Wizard", 1), { exact: true })).toBeVisible({
      timeout: 1000,
    });
  }).toPass();
  const strip = viewer.getByRole("list", { name: "Set: Variety Test", exact: true });
  await expect(strip.getByRole("listitem")).toHaveCount(3);
  await strip.getByRole("listitem", { name: "Show Bear Hug (3 of 3)", exact: true }).click();
  await expect(viewer.getByText(place("Bear Hug", 3), { exact: true })).toBeVisible();
  await expect(
    viewer.getByRole("img", { name: "Set prompt 2, detailed", exact: true }),
  ).toBeVisible();
  await strip.getByRole("listitem", { name: "Show Set prompt 1 (2 of 3)", exact: true }).click();
  await expect(viewer.getByText(place("Set prompt 1", 2), { exact: true })).toBeVisible();
});

test("Select Set picks a set's results to upscale together", async ({ page }) => {
  const state = await fixtures(page);
  state.gallery.push(
    ...["Bear Hug", "Owl Librarian", "Fox Wizard"].map((variation, position) => ({
      ...results(1)[0],
      id: `set-${2 - position}`,
      jobId: `set-job-${2 - position}`,
      prompt: `Set prompt ${2 - position}`,
      createdAt: `2026-10-23T00:00:0${3 - position}.000Z`,
      resultSet: { id: "set-a", title: "Variety Test", index: 2 - position, variation },
    })),
    ...results(1),
  );
  const upscales: any[] = [];
  await page.route("**/api/upscale", (route) => {
    upscales.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/images");
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await page.getByText("Runs", { exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Run: Variety Test, 3 Images", exact: true }).click();
  const run = page.getByRole("region", { name: "Run: Variety Test", exact: true });
  await run.getByRole("button", { name: "Select Set", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Gallery Selection", exact: true }).getByRole("status"),
  ).toHaveText("3 Selected");
  await (await selectionMenuItem(page, "Upscale")).click();
  await expect
    .poll(() => upscales.map((body) => body.galleryItemId).sort())
    .toEqual(["set-0", "set-1", "set-2"]);
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
      progress: { value: 5, max: 10, phase: "Sampling" },
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
  await page.route("**/api/queue/failed-job/retry", async (route) => {
    const retried = job("retried-job", "queued");
    state.jobs.push(retried);
    state.gallery.unshift({
      ...results(1)[0],
      id: "retried",
      jobId: "retried-job",
      prompt: "Failed study",
      status: "pending",
    });
    await route.fulfill({ json: { job: retried } });
  });
  await page.goto("/images");
  await expect(page.getByText("Sampling · 50%", { exact: true })).toHaveCount(2);
  await expect(page.getByText("The worker ran out of memory.", { exact: true })).toBeVisible();
  // One Stop for the two-output run.
  await expect(page.getByRole("button", { name: "Stop Live study", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Stop Live study", exact: true }).click();
  await expect.poll(() => state.jobs[0].status).toBe("cancelled");
  await page.getByRole("button", { name: "Retry Failed study", exact: true }).click();
  await expect(page.locator('[data-media-id="failed"]')).toHaveCount(0);
  await expect(page.locator('[data-media-id="retried"]')).toBeVisible();
  expect(state.gallery.map((item) => item.id)).not.toContain("failed");
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
  await page.getByRole("button", { name: "Select In Progress", exact: true }).click();
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
  await page.getByRole("button", { name: "Select Failed", exact: true }).click();
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
  await selectionAction(page, "Star").hover();
  await expect(page.getByRole("tooltip", { name: "Star" })).toBeVisible();
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
  await page.getByRole("button", { name: "Select All", exact: true }).click();
  const status = page.getByRole("group", { name: "Gallery Selection" }).getByRole("status");
  await expect(status).toHaveText("700 Selected");
  const download = page.waitForEvent("download");
  await selectionAction(page, "Download").click();
  expect((await download).url()).toMatch(/\/api\/gallery\/export\?selection=token$/);
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
  // Starred and Uploads are toolbar toggles, one at a time.
  await showOnly(page, "Starred");
  await showOnly(page, "Uploads");
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  // The view (Grid or Runs) leads the popup.
  await expect(page.getByRole("radiogroup", { name: "Gallery View", exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "All Versions", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  const status = page.getByRole("button", { name: "Open Status", exact: true });
  await expect(status).toHaveAttribute("aria-description", "Generating");
  await status.click();
  const queue = page.getByRole("dialog", { name: "Generations", exact: true });
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
  await expect(selectionAction(page, "Edit")).toHaveCount(0);
  // A phone bar shows every action while they fit, Animate and Upscale included.
  await expect(selectionAction(page, "Animate")).toBeVisible();
  await expect(selectionAction(page, "More")).toHaveCount(0);
  // The selects sit beside the count; phones name them by what they select.
  await expect(page.getByRole("button", { name: "Select All", exact: true })).toHaveText(
    phone ? "All" : "Select All",
  );
  await page.getByRole("button", { name: "Select All", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("3 Selected");
  await expect(selectionAction(page, "Edit")).toHaveCount(0);
  await expect(selectionAction(page, "More")).toHaveCount(0);
  // Phones that share natively share instead of downloading.
  const sharing = phone && (await page.evaluate(() => typeof navigator.share === "function"));
  if (sharing) await expect(selectionAction(page, "Share")).toBeEnabled();
  await selectionAction(page, "Star").click();
  await expect.poll(() => state.gallery.filter((item) => item.favorite).length).toBe(2);
  // Each finished action ends the selection.
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "Select Items", exact: true }).click();
  await page.getByRole("button", { name: "Select All", exact: true }).click();
  await selectionAction(page, "Delete").click();
  await page
    .getByRole("dialog", { name: "Delete Selected Items", exact: true })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect.poll(() => state.gallery.map((item) => item.id)).toEqual(["selection-2"]);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible();
});

test("Uploads stay out of the gallery until its Uploads filter is on", async ({ page }) => {
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

test("Gallery filters submit repeated models together with LoRA, size, aspect and date", async ({
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
  await page.getByRole("button", { name: "Up to 1K", exact: true }).click();
  await page.getByRole("button", { name: "Square", exact: true }).click();
  await page.getByText("Week", { exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(filter).toHaveAttribute("aria-expanded", "false");
  // The active filters show in the toolbar row as removable chips.
  const chips = page.getByRole("group", { name: "Active Filters", exact: true });
  const removable = chips.getByRole("button", { name: /^Remove / });
  await expect(removable).toHaveCount(6);
  await chips.getByRole("button", { name: "Remove Square Filter", exact: true }).click();
  await expect(removable).toHaveCount(5);
  // The search narrows within them.
  const search = await toolbarSearch(page);
  await search.fill("bird");
  await expect
    .poll(() => {
      const query = new URLSearchParams(state.galleryRequests.at(-1));
      return {
        model: query.getAll("model"),
        lora: query.getAll("lora"),
        size: query.getAll("size"),
        aspect: query.getAll("aspect"),
        since: query.has("since"),
        q: query.get("q"),
      };
    })
    .toEqual({
      model: ["image.safetensors", "video.safetensors"],
      lora: ["detail.safetensors"],
      size: ["up-to-1k"],
      aspect: [],
      since: true,
      q: "bird",
    });
  // Closing the phone's search clears it; desktop keeps its box and query.
  const phone = test.info().project.use.isMobile;
  const expected = phone ? "" : "bird";
  await search.press("Escape");
  await page.getByRole("button", { name: "Clear All", exact: true }).click();
  await expect(removable).toHaveCount(0);
  // The cleared search is served fresh from cache or requested again, never with the old facets.
  await expect
    .poll(() =>
      state.galleryRequests.some((search) => {
        const query = new URLSearchParams(search);
        return query.get("q") === expected && !query.has("model") && !query.has("since");
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
  const drawer = page.getByRole("dialog", { name: "Generations", exact: true });
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

test("The viewer's strip moves to the sets either side of its own", async ({ page }) => {
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
  const strip = viewer.getByRole("list", { name: "Set: Set A", exact: true });
  await expect(strip.getByRole("listitem")).toHaveCount(3);
  await strip.getByRole("listitem", { name: "Previous Set: Set B", exact: true }).click();
  await expect(viewer.getByRole("img", { name: "Prompt b-0", exact: true })).toBeVisible();
  const other = viewer.getByRole("list", { name: "Set: Set B", exact: true });
  await other.getByRole("listitem", { name: "Next Set: Set A", exact: true }).click();
  await expect(viewer.getByRole("img", { name: "Prompt a-0", exact: true })).toBeVisible();
});

test("The open item is in the URL: Back closes the viewer and a link opens it", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.gallery.push(...results(2));
  // An item not on a loaded page is read on its own.
  const unlisted = { ...results(1)[0], id: "unlisted", prompt: "Unlisted Result" };
  await page.route("**/api/gallery/items/unlisted", (route) =>
    route.fulfill({ json: { item: unlisted } }),
  );
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: Browse Result 0", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(page).toHaveURL(/\/images\?item=browse-0$/);
  await expect(viewer.getByRole("img", { name: "Browse Result 0", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/images\?item=browse-1$/);
  await page.goBack();
  await expect(viewer).toBeHidden();
  await expect(page).toHaveURL(/\/images$/);
  await page.goto("/images?item=unlisted");
  await expect(viewer.getByRole("img", { name: "Unlisted Result", exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await expect(viewer).toBeHidden();
  await expect(page).toHaveURL(/\/images$/);
});
