import { expect, test } from "@playwright/test";

import { fixtures, image, serveRetries, signIn, stamp } from "./fixtures";

test("the visible queue puts running work first and follows dispatch order within each worker", async ({
  page,
}) => {
  await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  const jobs = [
    ["Cold Job", "waiting", "radiance"],
    ["Parallel Job", "waiting", "comfyui"],
    ["Warm Job", "waiting", "radiance"],
    ["Active Job", "running", "radiance"],
  ].map(([id, status, backend]) => ({
    id,
    jobId: id,
    status,
    backend,
    operation: "image",
    input: {
      prompt: id,
      ...(backend === "radiance" && { profileName: "Krea 2 Turbo · Radiance" }),
    },
    ...(id === "Active Job" && {
      progress: { phase: "generating", max: 8, value: 2, steps: true, etaMs: 20000 },
    }),
    ...(id === "Cold Job" && { reason: "Waiting for the model to load." }),
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  }));
  await page.route(/\/api\/queue(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        jobs,
        ids: jobs.map(({ id }) => id),
        paused: { mine: false, all: false },
        queuePositions: { "Warm Job": 1, "Parallel Job": 1, "Cold Job": 2 },
        queueOrder: ["Warm Job", "Parallel Job", "Cold Job"],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Open Status", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "Queue", exact: true });
  const labels = queue.getByText(/^(Active|Warm|Parallel|Cold) Job$/);
  await expect(labels).toHaveText(["Active Job", "Warm Job", "Parallel Job", "Cold Job"]);
  await expect(
    queue.getByRole("progressbar", { name: "Generation Progress", exact: true }),
  ).toHaveAttribute("aria-valuenow", "25");
  await expect(
    queue.getByText("Generating – Krea 2 Turbo · Step 2 of 8 · About 20s Left", { exact: true }),
  ).toBeVisible();
  await expect(
    queue.getByText("Waiting – Krea 2 Turbo · #2 in Radiance Queue", { exact: true }),
  ).toBeVisible();
  await expect(queue.getByText("Waiting for the model to load.", { exact: true })).toBeVisible();
});

test("the queue pauses, resumes and reorders the account's waiting work", async ({ page }) => {
  const state = await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  for (const [id, status] of [
    ["running-job", "running"],
    ["first", "queued"],
    ["second", "queued"],
    ["third", "waiting"],
  ])
    state.jobs.push({
      id,
      jobId: id,
      sessionId: "s",
      operation: "image",
      status,
      reason: "",
      // Each row names the profile it runs on; "first" carries the inputs its details show.
      input: {
        prompt: id,
        profileId: id === "running-job" ? "image:test" : undefined,
        ...(id === "first" && {
          negative: "blurry",
          width: 1024,
          height: 768,
          steps: 20,
          seed: 7,
          count: 2,
          loras: [{ name: "detail.safetensors", strength: 0.8, enabled: true }],
          referenceDetails: [
            { id: "ref", slot: "reference", name: "ref.png", thumbnailUrl: image },
          ],
        }),
      },
      items: [],
      outputs: [],
      createdAt: stamp,
      updatedAt: stamp,
    });
  await page.goto("/");
  await page.getByRole("button", { name: "Open Status", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "Queue", exact: true });
  const order = () => queue.getByText(/^(running-job|first|second|third)$/).allTextContents();
  await expect.poll(order).toEqual(["running-job", "first", "second", "third"]);
  await expect(queue.getByText("Generating – Image Quality", { exact: true })).toBeVisible();

  // An administrator's one Pause holds every account's work.
  await queue.getByRole("button", { name: "Pause Queue", exact: true }).click();
  await expect(queue.getByRole("button", { name: "Resume Queue", exact: true })).toBeVisible();
  await expect(queue.getByText("Queued · Paused", { exact: true })).toHaveCount(3);
  expect(state.queuePause).toEqual({ mine: false, all: true });
  await queue.getByRole("button", { name: "Resume Queue", exact: true }).click();
  await expect(queue.getByRole("button", { name: "Pause Queue", exact: true })).toBeVisible();
  expect(state.queuePause).toEqual({ mine: false, all: false });

  // Only waiting items drag, by their handles: with the pointer, then the keyboard.
  const handles = queue.getByRole("button", { name: "Drag to Reorder", exact: true });
  await expect(handles).toHaveCount(3);
  await expect(handles.first()).toBeEnabled();
  const centre = async (index: number) => {
    const box = (await handles.nth(index).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  // Emulated mobile WebKit sends no pointer drag from Playwright's mouse; a real iPhone's touch is a
  // device check, and the keyboard covers the reorder there.
  const pointer = test.info().project.name !== "phone-webkit";
  if (pointer) {
    const [from, to] = [await centre(2), await centre(0)];
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y - 8, { steps: 12 });
    await page.mouse.up();
    await expect.poll(order).toEqual(["running-job", "third", "first", "second"]);
    await expect
      .poll(() => state.jobs.map((job) => job.id))
      .toEqual(["running-job", "third", "first", "second"]);
  }
  await handles.nth(pointer ? 0 : 1).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect.poll(order).toEqual(["running-job", "first", "third", "second"]);

  // Tapping a row shows what it runs with; tapping again hides it.
  const row = queue.getByRole("button", { name: /^first\b/ });
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await expect(queue.getByText("Negative: blurry", { exact: true })).toBeVisible();
  await expect(
    queue.getByText("1024 × 768 · 20 Steps · Seed 7 · Detail Slider 0.80 · 2 Outputs", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(queue.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await expect(queue.getByText("Negative: blurry", { exact: true })).toBeHidden();
});

test("a request's jobs group as one set that moves and stops together", async ({ page }) => {
  const state = await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  const job = (id: string, status: string, queueSet?: string) => ({
    id,
    jobId: id,
    sessionId: "s",
    operation: "image",
    status,
    reason: "",
    input: {
      prompt: id,
      kind: "image",
      ...(queueSet && {
        profileName: "Krea 2 Turbo · Radiance",
        resultSet: { id: "result-set", title: "Fox Studies", index: 0 },
      }),
    },
    ...(queueSet && { queueSet }),
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
  state.jobs.push(
    job("set-done", "completed", "set"),
    job("single", "queued"),
    job("set-first", "queued", "set"),
    job("set-second", "queued", "set"),
  );
  await page.goto("/");
  const status = page.getByRole("button", {
    name: "Open Status",
    exact: true,
    includeHidden: true,
  });
  await expect(status).toHaveAccessibleDescription("Generating · 3 Pending");
  await expect(status).toHaveText("3");
  const modes = page.getByRole("navigation", { name: "Creative Modes", exact: true });
  await expect
    .poll(async () => {
      const [button, nav] = await Promise.all([status.boundingBox(), modes.boundingBox()]);
      return Boolean(button && nav && button.x + button.width <= nav.x);
    })
    .toBe(true);
  await status.click();
  const queue = page.getByRole("dialog", { name: "Queue", exact: true });
  // The set is one row: its title and progress, its jobs under it once opened.
  await expect(queue.getByText("Queue (2)", { exact: true })).toBeVisible();
  await expect(queue.getByText("1 of 4 Finished", { exact: true })).toBeVisible();
  await expect(queue.getByRole("progressbar", { name: "Overall Queue Progress" })).toHaveAttribute(
    "aria-valuenow",
    "25",
  );
  const set = queue.getByRole("button", { name: /^Fox Studies/ });
  await expect(set).toContainText("1 of 3 Done");
  await expect(set).toContainText("Queued – Krea 2 Turbo");
  // Dragging has loaded once the handles work, so the rows stay mounted.
  const handles = queue.getByRole("button", { name: "Drag to Reorder", exact: true });
  await expect(handles.first()).toBeEnabled();
  await expect(queue.getByText("set-first", { exact: true })).toBeHidden();
  await set.click();
  await expect(queue.getByText("set-first", { exact: true })).toBeVisible();
  await expect(queue.getByText("set-second", { exact: true })).toBeVisible();
  await set.click();

  // Its handle moves its waiting work together, in its order, ahead of the single job.
  await expect(handles).toHaveCount(2);
  await handles.nth(1).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  await expect
    .poll(() => state.jobs.filter((item) => item.status === "queued").map((item) => item.id))
    .toEqual(["set-first", "set-second", "single"]);

  // Stop Set stops only the set's unfinished work; Stop All names what it stops.
  await queue.getByRole("button", { name: "Stop Set", exact: true }).click();
  await expect
    .poll(() => state.jobs.map((item) => [item.id, item.status]))
    .toEqual([
      ["set-done", "completed"],
      ["set-first", "cancelled"],
      ["set-second", "cancelled"],
      ["single", "queued"],
    ]);
  await expect(set).toBeHidden();
  await expect(status).toHaveText("1");
  await expect(queue.getByText("Queue (1)", { exact: true })).toBeVisible();
  await queue.getByRole("button", { name: "Stop All", exact: true }).click();
  const stopAll = page.getByRole("dialog", { name: "Stop All Generations", exact: true });
  await expect(stopAll).toContainText("Studio stops your 1 unfinished generation.");

  // A stop its worker can't confirm fails as a row's Stop does, leaving the dialog to try again.
  const unconfirmed = "Cancellation could not be confirmed.";
  await page.route("**/api/queue/cancel-all", (route) =>
    route.fulfill({ json: { outcomes: [{ job: {}, cancelRequested: true, error: unconfirmed }] } }),
  );
  await stopAll.getByRole("button", { name: "Stop All", exact: true }).click();
  await expect(page.getByText(unconfirmed, { exact: true })).toBeVisible();
  await expect(stopAll).toBeVisible();
  const banner = page.getByRole("alert").filter({ hasText: unconfirmed });
  if (test.info().project.use.isMobile) {
    await banner.dispatchEvent("touchstart", {
      touches: [{ identifier: 1, clientX: 120, clientY: 100 }],
    });
    await banner.dispatchEvent("touchend", {
      touches: [],
      changedTouches: [{ identifier: 1, clientX: 125, clientY: 40 }],
    });
  } else {
    await banner.getByRole("button", { name: "Dismiss Notification" }).click();
  }
  await expect(banner).toBeHidden();
  await expect(stopAll).toBeVisible();
});

test("a video stays visible as stopping while its provider confirms", async ({ page }) => {
  const state = await fixtures(page);
  const video = {
    id: "stopping-video",
    operation: "animate",
    status: "running",
    input: { kind: "video", prompt: "A lighthouse in fog" },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
  state.jobs.push(video);
  let confirm!: () => void;
  const confirmed = new Promise<void>((resolve) => {
    confirm = resolve;
  });
  await page.route("**/api/queue/stopping-video/cancel", async (route) => {
    Object.assign(video, { cancelling: true });
    await confirmed;
    video.status = "cancelled";
    return route.fulfill({ json: { job: video } });
  });
  await page.goto("/videos");
  await page.getByRole("button", { name: "Open Status", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "Queue", exact: true });
  await queue.getByRole("button", { name: "Stop", exact: true }).click();
  try {
    await expect(queue.getByRole("button", { name: "Stopping", exact: true })).toBeDisabled();
    await expect(queue.getByText("A lighthouse in fog", { exact: true })).toBeVisible();
    expect(video.status).toBe("running");
  } finally {
    confirm();
  }
  await expect(queue.getByRole("button", { name: "Stopping", exact: true })).toHaveCount(0);
});

test("a request of several prompts lists each prompt once, its split runs stopping together", async ({
  page,
}) => {
  const state = await fixtures(page);
  await signIn(page, { id: "user", role: "user" });
  const job = (id: string, prompt: string, queueBatch?: string) => ({
    id,
    jobId: id,
    sessionId: "s",
    operation: "animate",
    status: "queued",
    reason: "",
    input: { prompt, kind: "video", resultSet: { id: "result-set", title: "Fox Clips", index: 0 } },
    queueSet: "request",
    ...(queueBatch && { queueBatch }),
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
  state.jobs.push(
    job("fox-1", "A fox runs", "fox-1"),
    job("fox-2", "A fox runs", "fox-1"),
    job("owl-1", "An owl flies", "owl-1"),
    job("owl-2", "An owl flies", "owl-1"),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Open Status", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "Queue", exact: true });
  await expect(queue.getByText("Queue (1)", { exact: true })).toBeVisible();
  await queue.getByRole("button", { name: /^Fox Clips/ }).click();
  const fox = queue.getByRole("button", { name: /^A fox runs/ });
  await expect(fox).toContainText("0 of 2 Done");
  await expect(queue.getByRole("button", { name: /^An owl flies/ })).toBeVisible();
  await expect(queue.getByRole("button", { name: "Stop Prompt", exact: true })).toHaveCount(2);

  // A prompt's Stop stops only its own runs.
  await queue.getByRole("button", { name: "Stop Prompt", exact: true }).first().click();
  await expect
    .poll(() => state.jobs.map((item) => [item.id, item.status]))
    .toEqual([
      ["fox-1", "cancelled"],
      ["fox-2", "cancelled"],
      ["owl-1", "queued"],
      ["owl-2", "queued"],
    ]);
  await expect(fox).toBeHidden();
});

test("Retry and a set's Retry Failed go through the shared retry, replacing the failed originals", async ({
  page,
}) => {
  const state = await fixtures(page);
  const tile = { id: "failed-tile", jobId: "set-failed", status: "failed", url: image };
  const job = (id: string, status: string, items: unknown[] = [], queueSet = "set") => ({
    id,
    jobId: id,
    sessionId: "s",
    operation: "image",
    status,
    reason: "",
    input: {
      prompt: id,
      kind: "image",
      resultSet: { id: "result-set", title: "Fox Studies", index: 0 },
    },
    queueSet,
    items,
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
  state.jobs.push(
    job("set-done", "completed"),
    job("set-failed", "failed", [tile]),
    job("lone-failed", "failed", [], ""),
  );
  state.gallery.push(tile);
  await serveRetries(page, state, (ids) =>
    ids.map((id) => {
      const next = job(`retried-${id}`, "queued", [], id === "set-failed" ? "set" : "");
      state.jobs.push(next);
      return { id, replacement: next.id };
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Open Status", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "Queue", exact: true });
  await expect(queue.getByRole("button", { name: "Clear Failed Set", exact: true })).toHaveCount(0);
  await queue.getByRole("button", { name: "Retry Failed", exact: true }).click();
  // The failed tile goes, as a retry anywhere else, and the original leaves the set.
  await expect.poll(() => state.gallery.map((item) => item.id)).not.toContain("failed-tile");
  await expect.poll(() => state.jobs.find((item) => item.id === "set-failed")?.cleared).toBe(true);
  await expect(queue.getByRole("button", { name: /^Fox Studies/ })).toContainText("1 of 2 Done");

  // A lone job's Retry clears its failed original from the queue too.
  await queue.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => state.jobs.find((item) => item.id === "lone-failed")?.cleared).toBe(true);
});

test("Clear Failed Set removes the collapsed set from the queue and keeps failed gallery records", async ({
  page,
}) => {
  const state = await fixtures(page);
  const tile = { id: "failed-tile", jobId: "failed-first", status: "failed", url: image };
  for (const [id, status, queueSet] of [
    ["failed-first", "failed", "set"],
    ["failed-second", "failed", "set"],
    ["cancelled", "cancelled", "set"],
    ["other-failed", "failed", "other"],
  ])
    state.jobs.push({
      id,
      jobId: id,
      sessionId: "s",
      operation: "image",
      status,
      reason: "",
      input: {
        prompt: id,
        resultSet: { id: queueSet, title: "Fox Studies", index: 0 },
      },
      queueSet,
      items: id === tile.jobId ? [tile] : [],
      outputs: [],
      createdAt: stamp,
      updatedAt: stamp,
    });
  state.gallery.push(tile);
  await page.goto("/");
  const status = page.getByRole("button", {
    name: "Open Status",
    exact: true,
    includeHidden: true,
  });
  await status.click();
  const queue = page.getByRole("dialog", { name: "Queue", exact: true });
  const set = queue.getByRole("button", { name: /^Fox Studies/ });
  await expect(set).toHaveAttribute("aria-expanded", "false");
  await expect(queue.getByRole("button", { name: "Retry Failed", exact: true })).toBeVisible();
  await expect(status).toHaveText("");
  await queue.getByRole("button", { name: "Clear Failed Set", exact: true }).click();
  await expect(set).toBeHidden();
  await expect(queue.getByText("other-failed", { exact: true })).toBeVisible();
  expect(state.jobs.filter((job) => job.cleared).map((job) => job.id)).toEqual([
    "failed-first",
    "failed-second",
  ]);
  expect(state.gallery).toContainEqual(tile);
});

for (const [role, link, section] of [
  ["administrator", "Open Workers", "workers"],
  ["user", "Open Where Work Runs", "where-work-runs"],
] as const) {
  test(`a ${role} opens their work settings from the queue summary`, async ({ page }) => {
    await fixtures(page);
    await signIn(page, { id: role, role });
    await page.goto("/");
    await page.getByRole("button", { name: "Open Status", exact: true }).click();
    const queue = page.getByRole("dialog", { name: "Queue", exact: true });
    await queue.getByRole("link", { name: link, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/settings#${section}$`));
    await expect(queue).toBeHidden();
  });
}

test("while work runs the queue polls only for changes and still shows the work finishing", async ({
  page,
}) => {
  const state = await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  const job = {
    id: "running-job",
    jobId: "running-job",
    sessionId: "s",
    operation: "image",
    status: "running",
    reason: "",
    input: { prompt: "running-job", profileId: "image:test" },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
  state.jobs.push(job);
  const polled = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/queue" && request.url().includes("since="),
  );
  await page.goto("/");
  const status = page.getByRole("button", {
    name: "Open Status",
    exact: true,
    includeHidden: true,
  });
  await expect(status).toHaveText("1");
  await status.click();
  const queue = page.getByRole("dialog", { name: "Queue", exact: true });
  const generating = queue.getByText("Generating – Image Quality", { exact: true });
  await expect(generating).toBeVisible();
  await polled;
  job.status = "completed";
  await expect(generating).toHaveCount(0);
  await expect(status).toHaveText("");
});
