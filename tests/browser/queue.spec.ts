import { expect, test } from "@playwright/test";
import { fixtures, image, signIn, stamp } from "./fixtures";

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
  const queue = page.getByRole("dialog", { name: "Generations", exact: true });
  const order = () => queue.getByText(/^(running-job|first|second|third)$/).allTextContents();
  await expect.poll(order).toEqual(["running-job", "first", "second", "third"]);
  await expect(queue.getByText("Image Quality · Generating", { exact: true })).toBeVisible();

  // An administrator's one Pause holds every account's work.
  await queue.getByRole("button", { name: "Pause Queue", exact: true }).click();
  await expect(queue.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await expect(queue.getByText("Queued · Paused", { exact: true })).toHaveCount(3);
  expect(state.queuePause).toEqual({ mine: false, all: true });
  await queue.getByRole("button", { name: "Resume", exact: true }).click();
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

test("work waiting on GPUs a text model holds offers a swap that asks first", async ({ page }) => {
  const state = await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  await page.route("**/api/services/status", (route) =>
    route.fulfill({
      json: {
        services: {},
        runtime: { configured: true, automaticLifecycle: true, swap: true, reason: "" },
      },
    }),
  );
  const swaps: unknown[] = [];
  await page.route("**/api/queue/held/swap", (route) => {
    const body = route.request().postDataJSON() ?? {};
    swaps.push(body);
    return route.fulfill({
      json: body.signature
        ? { id: "swap", status: "running", requestedBy: "account:admin: swap to images" }
        : {
            target: ["image"],
            stop: ["text"],
            start: ["image"],
            keep: [],
            signature: "fixture",
            labels: { image: "Images Worker", text: "Text" },
            runWhenIdle: "Text",
          },
    });
  });
  state.jobs.push({
    id: "held",
    jobId: "held",
    sessionId: "s",
    operation: "image",
    status: "waiting",
    reason: "Waiting for a GPU: Text (Run When Idle) is running; stop it in Settings › Workers.",
    input: { prompt: "held", kind: "image" },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
  await page.goto("/");
  // Queuing it says so once, with the swap.
  await expect(page.getByText("A text model holds the GPUs this work needs.")).toBeVisible();
  await page.getByRole("button", { name: "Open Status", exact: true }).click();
  const queue = page.getByRole("dialog", { name: "Generations", exact: true });
  await queue.getByRole("button", { name: "Swap to Images", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Swap to Images", exact: true });
  await expect(confirm).toContainText("Stop Text and start Images Worker?");
  await expect(confirm).toContainText("Run When Idle may start Text again once Studio is idle.");
  expect(swaps).toEqual([{}]);
  await confirm.getByRole("button", { name: "Swap", exact: true }).click();
  await expect(confirm).toBeHidden();
  expect(swaps).toEqual([{}, { signature: "fixture" }]);
});
