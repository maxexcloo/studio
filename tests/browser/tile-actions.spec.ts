import { expect, test, type Page } from "@playwright/test";
import { fixtures, image, stamp, viewerAction } from "./fixtures";
async function galleryFixture(page: Page) {
  const state = await fixtures(page);
  const input = {
    kind: "image",
    profileId: "image:test",
    prompt: "A copper bird",
    width: 1024,
    height: 1024,
    backendId: "worker-a",
    loras: [],
    referenceAssets: [],
  };
  const item = {
    id: "tile-bird",
    jobId: "owned-job",
    status: "done",
    type: "image",
    prompt: input.prompt,
    url: image,
    thumbnailUrl: image,
    width: 1024,
    height: 1024,
    createdAt: stamp,
    settings: input,
  };
  state.gallery.push(item);
  state.sessions.push({
    id: "owned-session",
    title: "Copper Study",
    inputs: input,
    createdAt: stamp,
    updatedAt: stamp,
  });
  state.jobs.push({
    id: "owned-job",
    jobId: "owned-job",
    sessionId: "owned-session",
    operation: "image",
    status: "completed",
    input,
    items: [item],
    outputs: [item],
    createdAt: stamp,
    updatedAt: stamp,
  });
  await page.goto("/images");
  await expect(
    page.getByRole("button", { name: "Open image: A copper bird", exact: true }),
  ).toBeVisible();
  return state;
}

test("A tile can be starred and read back without opening the viewer", async ({
  page,
}, testInfo) => {
  const state = await galleryFixture(page);
  const tile = page.getByRole("button", { name: "Open image: A copper bird", exact: true });
  await tile.hover();
  if (testInfo.project.use.isMobile) {
    await page.getByRole("button", { name: "More Actions for A copper bird", exact: true }).click();
    await page.getByRole("menuitem", { name: "Star", exact: true }).click();
  } else await page.getByRole("button", { name: "Star A copper bird", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unstar A copper bird", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(state.gallery[0].favorite).toBe(true);
  await expect(page).toHaveURL(/\/images$/);
  await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Unstar A copper bird", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("The same tile menu opens by context click and More, with keyboard navigation", async ({
  page,
}) => {
  await galleryFixture(page);
  await page
    .getByRole("button", { name: "Open image: A copper bird", exact: true })
    .click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Refine", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Download", exact: true })).toHaveAttribute(
    "href",
    image,
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  const more = page.getByRole("button", { name: "More Actions for A copper bird", exact: true });
  await more.focus();
  await more.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menu").locator(":focus")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Refine", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Animate", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
});

for (const operation of ["Refine", "Animate"] as const) {
  test(`Tile ${operation} stages its owned result as a reference without submitting`, async ({
    page,
  }) => {
    const state = await galleryFixture(page);
    await page.getByRole("button", { name: "More Actions for A copper bird", exact: true }).click();
    await page.getByRole("menuitem", { name: operation, exact: true }).click();
    await expect.poll(() => state.referenceRequests.length).toBe(1);
    expect(state.referenceRequests[0]).toEqual({ galleryItemId: "tile-bird" });
    // An Animate draft opens the Videos composer, a Refine draft stays in Images.
    await expect(page).toHaveURL(operation === "Animate" ? /\/video\?compose=1/ : /\/images/);
    // Videos opens with its composer expanded; Images keeps the compact bar until it is clicked.
    if (operation === "Refine") await page.locator("[data-composer-prompt]").click();
    await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
      "A copper bird",
    );
    await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: operation === "Animate" ? "Generate Video" : "Refine Image",
        exact: true,
      }),
    ).toBeVisible();
    expect(state.jobs).toHaveLength(1);
  });
}

test("A failed tile retries its owned durable job and refreshes the gallery", async ({ page }) => {
  const state = await galleryFixture(page);
  state.jobs[0].status = "failed";
  state.gallery[0].status = "error";
  state.gallery[0].url = "";
  let attempts = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/queue/owned-job/retry", async (route) => {
    attempts++;
    await held;
    const job = { ...state.jobs[0], id: "retry-job", status: "queued" };
    state.jobs.push(job);
    state.gallery.unshift({
      ...state.gallery[0],
      id: "retry-item",
      jobId: job.id,
      prompt: "Retried copper bird",
      status: "pending",
    });
    await route.fulfill({ json: { job } });
  });
  try {
    await page.reload();
    await page.getByRole("button", { name: "More Actions for A copper bird", exact: true }).click();
    const retry = page.getByRole("menuitem", { name: "Retry", exact: true });
    await retry.click();
    await expect(retry).toBeDisabled();
    expect(attempts).toBe(1);
    release();
    await expect(page.locator('[data-media-id="retry-item"]')).toBeVisible();
    expect(attempts).toBe(1);
  } finally {
    release();
  }
});

for (const surface of ["tile", "viewer"]) {
  test(`Reference This Image from the ${surface} retains the current draft instead of recreating the source`, async ({
    page,
  }) => {
    const state = await galleryFixture(page);
    state.presets.push({
      id: "current-direction",
      title: "Current Direction",
      input: {
        kind: "image",
        profileId: "image:fast",
        prompt: "Keep this separate visual direction",
        negative: "hard shadows",
        width: 768,
        height: 1024,
        steps: 4,
        seed: "725",
        count: 1,
        loras: [],
        referenceAssets: [],
      },
    });
    await page.getByRole("textbox", { name: "Prompt", exact: true }).click();
    await page.getByRole("button", { name: "Presets", exact: true }).click();
    await page.getByRole("button", { name: "Current Direction", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Presets", exact: true })).toBeHidden();
    await page.keyboard.press("Escape");
    if (surface === "viewer") {
      await page.getByRole("button", { name: "Open image: A copper bird", exact: true }).click();
      await viewerAction(page, "Reference This Image");
    } else {
      await page
        .getByRole("button", { name: "More Actions for A copper bird", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Reference This Image", exact: true }).click();
    }
    const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
    await expect(prompt).toHaveValue("Keep this separate visual direction");
    await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toBeHidden();
    await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toHaveText(
      "Image Fast",
    );
    await page.getByRole("button", { name: "Generate Image", exact: true }).click();
    await expect.poll(() => state.jobs.length).toBe(2);
    expect(state.referenceRequests).toEqual([{ galleryItemId: "tile-bird" }]);
    expect(state.jobs[1].input).toMatchObject({
      profileId: "image:fast",
      prompt: "Keep this separate visual direction",
      negative: "hard shadows",
      seed: "725",
      width: 768,
      height: 1024,
      steps: 4,
      referenceAssets: [{ assetId: "asset-tile-bird", slot: "image" }],
    });
    expect(state.jobs[1].sessionId).not.toBe("owned-session");
  });
}
