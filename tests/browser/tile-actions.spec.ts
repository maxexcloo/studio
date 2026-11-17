import { type Page, expect, test } from "@playwright/test";

import {
  combinedImageProfile,
  expandComposer,
  fixtures,
  image,
  loadSaved,
  profiles,
  selectionAction,
  serveProfiles,
  stamp,
  touch,
  viewerAction,
} from "./fixtures";
/** Opens the tile's menu by context click, which every breakpoint has (phones may hide More). */
async function tileMenu(page: Page) {
  await page
    .getByRole("button", { name: "Open image: Copper Bird", exact: true })
    .click({ button: "right" });
}

async function galleryFixture(page: Page) {
  const state = await fixtures(page);
  const input = {
    kind: "image",
    profileId: "image:test",
    prompt: "A copper bird",
    width: 1024,
    height: 1024,
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
    page.getByRole("button", { name: "Open image: Copper Bird", exact: true }),
  ).toBeVisible();
  return state;
}

test("A tile can be liked and read back without opening the viewer", async ({ page }, testInfo) => {
  const state = await galleryFixture(page);
  const tile = page.getByRole("button", { name: "Open image: Copper Bird", exact: true });
  await tile.hover();
  // Phones show a tile's Like once it is liked; until then, selection likes it.
  if (testInfo.project.use.isMobile) {
    await page.getByRole("button", { name: "Select Items", exact: true }).click();
    const selectable = page.getByRole("button", {
      name: "Select image: Copper Bird",
      exact: true,
    });
    await selectable.click();
    await selectionAction(page, "Like").click();
  } else await page.getByRole("button", { name: "Like Copper Bird", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unlike Copper Bird", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => state.gallery[0].rating).toBe("liked");
  await expect(page).toHaveURL(/\/images$/);
  await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Unlike Copper Bird", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("Dislike hides a tile, Disliked shows it and Restore brings it back", async ({ page }) => {
  const state = await galleryFixture(page);
  const select = async () => {
    await page.getByRole("button", { name: "Select Items", exact: true }).click();
    await page.getByRole("button", { name: "Select image: Copper Bird", exact: true }).click();
  };
  const tile = page.getByRole("button", { name: "Open image: Copper Bird", exact: true });
  await select();
  await selectionAction(page, "Dislike").click();
  await expect(tile).toBeHidden();
  await expect.poll(() => state.gallery[0].rating).toBe("disliked");
  // Undo is offered while the dislike's notification shows.
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  // Disliked sits beside Liked in the filter bar.
  await page.getByRole("button", { name: "Disliked", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(tile).toBeVisible();
  await select();
  await selectionAction(page, "Restore").click();
  await expect(tile).toBeHidden();
  await expect.poll(() => state.gallery[0].rating).toBeUndefined();
  await page.getByRole("button", { name: "Disliked", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(tile).toBeVisible();
});

test("The same tile menu opens by context click and More, with keyboard navigation", async ({
  page,
}, testInfo) => {
  test.skip(!!testInfo.project.use.isMobile, "Phones without captions hide More (tested below)");
  await galleryFixture(page);
  await tileMenu(page);
  // Off the menu, so no submenu opens under the pointer.
  await page.mouse.move(0, 0);
  // Select, then the bar's order with Share's options in its place: Animate, Edit, Recreate,
  // Upscale | AI, Copy Details, Copy Prompt, Download | Like, Dislike | Report, Delete.
  await expect(page.getByRole("menuitem")).toHaveText([
    "Select",
    "Animate",
    "Edit",
    "Recreate",
    "Upscale",
    "AI",
    "Copy Details",
    "Copy Prompt",
    "Download",
    "Like",
    "Dislike",
    "Report",
    "Delete",
  ]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  // The pointer leaves the tile, so hover opens no submenu under it.
  await page.mouse.move(0, 0);
  const more = page.getByRole("button", { name: "More Actions for Copper Bird", exact: true });
  await more.focus();
  await more.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menu").locator(":focus")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Select", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Animate", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
});

test("Phones without captions hide More and open the tile menu by holding or the Menu key", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, "Phones only");
  await galleryFixture(page);
  const tile = page.getByRole("button", { name: "Open image: Copper Bird", exact: true });
  await expect(
    page.getByRole("button", { name: "More Actions for Copper Bird", exact: true }),
  ).toBeHidden();
  const menu = page.getByRole("menu");
  await touch(tile, "touchstart");
  await expect(menu).toBeVisible();
  // The release neither closes the menu nor opens the viewer.
  await touch(tile, "touchend");
  await tile.dispatchEvent("click");
  await expect(menu).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toBeHidden();
  await expect(page.getByRole("group", { name: "Gallery Selection", exact: true })).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await tile.focus();
  await tile.press("Shift+F10");
  await expect(page.getByRole("menuitem", { name: "Edit", exact: true })).toBeVisible();
});

for (const operation of ["Edit", "Animate"] as const) {
  test(`Tile ${operation} stages its owned result as a reference without submitting`, async ({
    page,
  }) => {
    const state = await galleryFixture(page);
    await tileMenu(page);
    await page.getByRole("menuitem", { name: operation, exact: true }).click();
    // Animate's options show once the assistant answers.
    if (operation === "Animate")
      await expect(
        page.getByRole("menuitem", { name: "Review Prompt", exact: true }),
      ).toBeVisible();
    await page
      .getByRole("menuitem", {
        name: operation === "Animate" ? "Animate in Composer" : "Edit in Composer",
        exact: true,
      })
      .click();
    await expect.poll(() => state.referenceRequests.length).toBe(1);
    expect(state.referenceRequests[0]).toEqual({ galleryItemId: "tile-bird" });
    // An Animate draft opens the Videos composer, an Edit draft stays in Images.
    await expect(page).toHaveURL(operation === "Animate" ? /\/video\?compose=1/ : /\/images/);
    // Either way the composer opens on the staged draft.
    await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
      "A copper bird",
    );
    await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: operation === "Animate" ? "Generate Video" : "Edit Image",
        exact: true,
      }),
    ).toBeVisible();
    expect(state.jobs).toHaveLength(1);
  });
}

test("Edit submits the image with the profile's reference-mode settings", async ({ page }) => {
  const state = await galleryFixture(page);
  // Text-to-image samples from scratch; only the reference mode's partial denoise keeps the image.
  await serveProfiles(page, [
    {
      ...profiles[0],
      defaults: { ...profiles[0].defaults, denoise: 1 },
      imageModes: {
        generate: { defaults: { denoise: 1 } },
        reference: { defaults: { denoise: 0.65 } },
      },
    },
    ...profiles.slice(1),
  ]);
  await page.reload();
  await tileMenu(page);
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit in Composer", exact: true }).click();
  await expect.poll(() => state.referenceRequests.length).toBe(1);
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("A copper bird in snow");
  await page.getByRole("button", { name: "Edit Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input).toMatchObject({
    operation: "refine",
    profileId: "image:test",
    denoise: 0.65,
    referenceAssets: [{ assetId: "asset-tile-bird", slot: "image" }],
  });
});

test("Use as Reference counts every backend of a combined profile", async ({ page }) => {
  const state = await galleryFixture(page);
  // Its current backend takes none; the other, which runs with references, does.
  await serveProfiles(page, [combinedImageProfile(0), ...profiles.slice(1)]);
  await page.reload();
  await tileMenu(page);
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: "Use as Reference", exact: true }).click();
  await expect.poll(() => state.referenceRequests.length).toBe(1);
  await expect(page.getByRole("img", { name: /^Reference 1/ })).toBeVisible();
});

test("Use as Reference moves to a model that takes references, or is disabled where none does", async ({
  page,
}) => {
  const state = await galleryFixture(page);
  const none = { ...profiles[0], mediaInputs: [] };
  await serveProfiles(page, [none, ...profiles.slice(1)]);
  await page.reload();
  await tileMenu(page);
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const reference = page.getByRole("menuitem", { name: "Use as Reference", exact: true });
  await reference.click();
  await expect.poll(() => state.referenceRequests.length).toBe(1);
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
  // With no image model that takes one, it stays disabled.
  await serveProfiles(page, [none, profiles[1], { ...profiles[2], mediaInputs: [] }]);
  await page.goto("/images");
  await tileMenu(page);
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(reference).toBeDisabled();
});

test("A reference placed by hand applies the profile's reference-mode settings", async ({
  page,
}) => {
  const state = await galleryFixture(page);
  await serveProfiles(page, [
    {
      ...profiles[0],
      defaults: { ...profiles[0].defaults, denoise: 1 },
      imageModes: {
        generate: { defaults: { denoise: 1 } },
        reference: { defaults: { denoise: 0.65 } },
      },
    },
    ...profiles.slice(1),
  ]);
  await page.reload();
  await tileMenu(page);
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: "Use as Reference", exact: true }).click();
  await expect.poll(() => state.referenceRequests.length).toBe(1);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("A copper bird in snow");
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input).toMatchObject({
    denoise: 0.65,
    referenceAssets: [{ assetId: "asset-tile-bird", slot: "image" }],
  });
});

test("A failed tile retries its owned durable job and refreshes the gallery", async ({ page }) => {
  const state = await galleryFixture(page);
  state.jobs[0].status = "failed";
  state.gallery[0].status = "failed";
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
    await tileMenu(page);
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
  test(`Reference from the ${surface} retains the current draft instead of recreating the source`, async ({
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
    await expandComposer(page);
    await page.getByRole("button", { name: "Presets", exact: true }).click();
    await loadSaved(page, "Current Direction");
    await expect(page.getByRole("dialog", { name: "Presets", exact: true })).toBeHidden();
    await page.keyboard.press("Escape");
    if (surface === "viewer") {
      await page.getByRole("button", { name: "Open image: Copper Bird", exact: true }).click();
      await viewerAction(page, "Edit");
    } else {
      await tileMenu(page);
      await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    }
    await page.getByRole("menuitem", { name: "Use as Reference", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toBeHidden();
    const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
    await expect(prompt).toHaveValue("Keep this separate visual direction");
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

test("On a phone held sideways, the tile menu fits the screen and expands options in place", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, "Touch screens only");
  await page.setViewportSize({ width: 844, height: 390 });
  await galleryFixture(page);
  // The phone layout hides More on a tile without a caption.
  await tileMenu(page);
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const bottom = async () => {
    const box = (await menu.boundingBox())!;
    return box.y + box.height;
  };
  await expect.poll(bottom).toBeLessThanOrEqual(390);
  await page.getByRole("menuitem", { name: "Recreate", exact: true }).click();
  await expect(page.getByRole("group", { name: "Recreate", exact: true })).toBeVisible();
  // Delete, last, is reachable by scrolling inside the menu.
  const remove = page.getByRole("menuitem", { name: "Delete", exact: true });
  await remove.scrollIntoViewIfNeeded();
  await expect(remove).toBeInViewport();
});

test("Similar ranks the gallery by an image from its tile menu or the viewer, as a removable filter", async ({
  page,
}) => {
  const state = await galleryFixture(page);
  state.gallery.push({ ...state.gallery[0], id: "tile-moth", jobId: "", prompt: "A paper moth" });
  await page.reload();
  await tileMenu(page);
  await page.getByRole("menuitem", { name: "AI", exact: true }).click();
  await page.getByRole("menuitem", { name: "Similar", exact: true }).click();
  const chip = (label: string) =>
    page.getByRole("button", { name: `Remove ${label} Filter`, exact: true });
  await expect(chip("Similar to Copper Bird")).toBeVisible();
  expect(state.galleryRequests.at(-1)).toContain("similar=tile-bird&strictness=similar");

  // The chip changes it in place, and Similar ▾ keeps the choice.
  await page.getByRole("button", { name: "Similar to Copper Bird", exact: true }).click();
  await page
    .getByRole("radiogroup", { name: "Strictness", exact: true })
    .getByText("Close", { exact: true })
    .click();
  await expect(chip("Close to Copper Bird")).toBeVisible();
  await expect.poll(() => state.galleryRequests.at(-1)).toContain("strictness=close");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Open image: Paper Moth", exact: true }).click();
  // The chip's choice holds for the next Similar.
  await viewerAction(page, "AI", "Similar");
  await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toBeHidden();
  await expect(chip("Close to Paper Moth")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open image:/ }).first()).toHaveAccessibleName(
    "Open image: Paper Moth",
  );

  await chip("Close to Paper Moth").click();
  await expect(page).not.toHaveURL(/similar=/);
  await expect(chip("Close to Paper Moth")).toBeHidden();
});
