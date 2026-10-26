import { expect, test } from "@playwright/test";
import { closeReferences, fixtures, image, stamp } from "./fixtures";
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
  const retry = page.getByRole("button", { name: "Try Again", exact: true });
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
}) => {
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
  await expect(page.getByRole("button", { name: "Search Gallery", exact: true })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("Browse");
  await page.keyboard.press("Escape");
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.click();
  await prompt.fill("Keep typing");
  await prompt.press("/");
  await expect(prompt).toHaveValue("Keep typing/");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  const picker = page.getByRole("region", { name: "References", exact: true });
  await picker.getByRole("button", { name: "Search Gallery", exact: true }).focus();
  await page.keyboard.press("ControlOrMeta+f");
  const referenceSearch = picker.getByRole("textbox", { name: "Search Gallery", exact: true });
  await expect(referenceSearch).toBeFocused();
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
  await page.goto("/images");
  const first = page.getByRole("button", { name: "Open image: Browse Result 0", exact: true });
  const second = page.getByRole("button", { name: "Open image: Browse Result 1", exact: true });
  async function touch(target: typeof first, type: string, y = 100) {
    await target.evaluate(
      (element, { type, y }) => {
        const contact = { identifier: 1, target: element, clientX: 100, clientY: y };
        const touches = type === "touchend" ? [] : [contact];
        const event = document.createEvent("TouchEvent");
        event.initEvent(type, true, true);
        Object.defineProperties(event, {
          touches: { value: touches },
          targetTouches: { value: touches },
          changedTouches: { value: [contact] },
        });
        element.dispatchEvent(event);
      },
      { type, y },
    );
  }
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
  await page.getByRole("button", { name: "Star Selected", exact: true }).click();
  await expect.poll(() => state.gallery[1].favorite).toBe(true);
  expect(state.gallery[0].favorite).not.toBe(true);
  await selection.getByRole("button", { name: "Done Selecting", exact: true }).click();
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
      status: "error",
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
    await page.getByRole("button", { name: "Select All Loaded", exact: true }).click();
    const selection = page.getByRole("group", { name: "Gallery Selection", exact: true });
    await expect(selection.getByRole("status")).toHaveText("4 Selected");
    const retry = page.getByRole("button", { name: "Retry Selected", exact: true });
    await retry.click();
    await expect(retry).toBeDisabled();
    await retry.dispatchEvent("click");
    expect(attempts).toEqual(["batch-a"]);
    release();
    await expect(selection.getByRole("status")).toHaveText("2 Selected");
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
    await expect(selection.getByRole("status")).toHaveText("1 Selected");
    expect(attempts).toEqual(["batch-a", "batch-b", "batch-b"]);
    await page.getByRole("button", { name: "Star Selected", exact: true }).click();
    await expect.poll(() => state.gallery.find((item) => item.id === "ready")?.favorite).toBe(true);
    expect(state.gallery.filter((item) => item.favorite)).toHaveLength(1);
  } finally {
    release();
  }
});

test("Runs fan a stacked run out in place, link its Chat and filter by it", async ({ page }) => {
  const state = await fixtures(page);
  state.sessions.push({ id: "chat-a", title: "Bird Chat", inputs: {}, createdAt: stamp });
  state.gallery.push(
    ...results(3).map((item, index) => ({
      ...item,
      id: `run-${index}`,
      jobId: "run-job",
      sessionId: "chat-a",
      prompt: `Bird study ${index}`,
    })),
    ...results(1),
  );
  await page.goto("/images");
  await page.getByText("Runs", { exact: true }).click();
  const stack = page.getByRole("button", { name: "Run: Bird study 0, 3 Images", exact: true });
  await stack.click();
  await expect(stack).toHaveAttribute("aria-expanded", "true");
  const run = page.getByRole("region", { name: "Run: Bird study 0", exact: true });
  await expect(run.getByRole("button", { name: /^Open image: Bird study/ })).toHaveCount(3);
  await expect(run.getByRole("link", { name: "Bird Chat", exact: true })).toHaveAttribute(
    "href",
    "/chat/chat-a",
  );
  await run.getByRole("button", { name: "Open image: Bird study 2", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Generation", exact: true });
  await expect(viewer).toBeVisible();
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await run.getByRole("button", { name: "Close Run", exact: true }).click();
  await expect(run).toBeHidden();
  await expect(stack).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(page.getByRole("radio", { name: "Runs" })).toBeChecked();
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await page.getByRole("button", { name: "Filter By Chats", exact: true }).click();
  await page.getByRole("checkbox", { name: "Bird Chat", exact: true }).check();
  await expect
    .poll(() => new URLSearchParams(state.galleryRequests.at(-1)).getAll("chat"))
    .toEqual(["chat-a"]);
});

test("Running tiles show progress with Cancel and Try Again replaces a failed tile", async ({
  page,
}) => {
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
      status: "error",
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
  // One Cancel for the two-output run.
  await expect(page.getByRole("button", { name: "Cancel Live study", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Cancel Live study", exact: true }).click();
  await expect.poll(() => state.jobs[0].status).toBe("cancelled");
  await page.getByRole("button", { name: "Try Again: Failed study", exact: true }).click();
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
    { ...results(1)[0], id: "failed", prompt: "Failed study", status: "error", url: "" },
    ...results(4),
  );
  await page.goto("/images");
  const first = page.getByRole("button", { name: "Open image: Browse Result 0", exact: true });
  await first.focus();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: "Recreate in Composer", exact: true }),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Stop Selected", exact: true }).click();
  await expect.poll(() => state.jobs[0].status).toBe("cancelled");
  await page.getByRole("button", { name: "Select Failed", exact: true }).click();
  await expect(status).toHaveText("1 Selected");
  await page
    .getByRole("button", { name: "Select image: Browse Result 3", exact: true })
    .click({ button: "right" });
  await expect(status).toHaveText("2 Selected");
  await expect(page.getByRole("menuitem", { name: "Delete Selected", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Delete");
  const confirm = page.getByRole("dialog", { name: "Delete Selected Items", exact: true });
  await expect(confirm).toContainText("Delete 2 items");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect
    .poll(() => state.gallery.map((item) => item.id))
    .toEqual(["live", "browse-0", "browse-1", "browse-2"]);
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
  await page.getByRole("button", { name: "Try Again" }).click();
  await expect(page.getByText("No Images", { exact: true })).toBeVisible();
});

test("Gallery search preserves the query and status panel cancels only active work", async ({
  page,
}) => {
  const state = await fixtures(page);
  for (const [id, status] of [
    ["waiting-job", "waiting"],
    ["queued-job", "queued"],
    ["finished-job", "completed"],
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
  await page.getByRole("button", { name: "Search Gallery", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search Gallery", exact: true });
  await expect(search).toBeFocused();
  await search.fill("birds");
  await search.press("Escape");
  await page.getByRole("button", { name: "Search Gallery", exact: true }).click();
  await expect(search).toHaveValue("birds");
  await search.press("Escape");
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await expect(page.getByRole("button", { name: "Starred", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const status = page.getByRole("button", { name: "Open Status", exact: true });
  await expect(status).toHaveAttribute("aria-description", "Generating");
  await status.click();
  const queue = page.getByRole("dialog", { name: "Generations", exact: true });
  await expect(queue.getByText("waiting-job", { exact: true })).toBeVisible();
  await expect(queue.getByText("queued-job", { exact: true })).toBeVisible();
  await queue.getByRole("button", { name: "Cancel All", exact: true }).click();
  await expect
    .poll(() => state.jobs.map((job) => job.status))
    .toEqual(["cancelled", "cancelled", "completed"]);
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
  await page.getByRole("button", { name: "Select All Loaded", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("3 Selected");
  await expect(page.getByRole("link", { name: "Download Selected", exact: true })).toHaveAttribute(
    "href",
    /ids=selection-0%2Cselection-1/,
  );
  await page.getByRole("button", { name: "Star Selected", exact: true }).click();
  await expect.poll(() => state.gallery.filter((item) => item.favorite).length).toBe(2);
  await page.getByRole("button", { name: "Delete Selected", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete Selected Items", exact: true })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect.poll(() => state.gallery.map((item) => item.id)).toEqual(["selection-2"]);
  await page.getByRole("button", { name: "Done Selecting", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible();
});

test("Gallery facets submit repeated models together with LoRA, size and aspect filters", async ({
  page,
}) => {
  const state = await fixtures(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Search Gallery", exact: true }).click();
  await page.getByRole("textbox", { name: "Search Gallery", exact: true }).fill("bird");
  await page.getByRole("textbox", { name: "Search Gallery", exact: true }).press("Escape");
  await page.getByRole("button", { name: "Gallery Filters", exact: true }).click();
  await page.getByRole("button", { name: "Filter By Models", exact: true }).click();
  await page.getByRole("checkbox", { name: "Studio Image", exact: true }).check();
  await page.getByRole("checkbox", { name: "Motion Quality", exact: true }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Filter By LoRAs", exact: true }).click();
  await page.getByRole("checkbox", { name: "Detail Slider", exact: true }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Filter By Size", exact: true }).click();
  await page.getByRole("checkbox", { name: "Up to 1K", exact: true }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Filter By Aspect Ratio", exact: true }).click();
  await page.getByRole("checkbox", { name: "1:1", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect
    .poll(() => {
      const query = new URLSearchParams(state.galleryRequests.at(-1));
      return {
        model: query.getAll("model"),
        lora: query.getAll("lora"),
        size: query.getAll("size"),
        aspect: query.getAll("aspect"),
        q: query.get("q"),
      };
    })
    .toEqual({
      model: ["image.safetensors", "video.safetensors"],
      lora: ["detail.safetensors"],
      size: ["up-to-1k"],
      aspect: ["1:1"],
      q: "bird",
    });
  await page.getByRole("button", { name: "Clear Filters", exact: true }).click();
  await expect(page.getByRole("button", { name: "Clear Filters", exact: true })).toBeHidden();
  // The cleared search is served fresh from cache or requested again, never with the old facets.
  await expect
    .poll(() =>
      state.galleryRequests.some((search) => {
        const query = new URLSearchParams(search);
        return query.get("q") === "bird" && !query.has("model") && !query.has("lora");
      }),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Close Filters", exact: true }).click();
  await page.getByRole("button", { name: "Search Gallery", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search Gallery", exact: true })).toHaveValue(
    "bird",
  );
});
