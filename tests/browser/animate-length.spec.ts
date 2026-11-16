import { expect, test } from "@playwright/test";

import { fixtures, image, profiles, serveProfiles, stamp, viewerAction } from "./fixtures";

for (const review of [false, true]) {
  test(`Animate Length paces ${review ? "reviewed" : "queued"} motion with the submitted clip`, async ({
    page,
  }) => {
    const state = await fixtures(page);
    const local = {
      ...profiles[1],
      defaults: { ...profiles[1].defaults, frames: 192, fps: 24, steps: 8 },
      capabilities: { frames: true, fps: false },
      constraints: { frames: { min: 124, max: 362, step: 17, offset: 5 } },
    };
    const cloud = {
      ...local,
      id: "video:cloud",
      provider: "cliproxyapi",
      defaults: { duration: 6, steps: 1 },
      capabilities: { duration: true, frames: false, fps: false },
      constraints: { duration: { min: 1, max: 15, step: 1 } },
    };
    await serveProfiles(page, [profiles[0], local, cloud]);
    let switched = !review;
    await page.route("**/api/animate/profile?*", (route) =>
      route.fulfill({
        json: {
          profileId: switched ? cloud.id : local.id,
          cloud: switched,
          offers: { cloud: true, fast: false, quality: true },
        },
      }),
    );
    const written: Record<string, unknown>[] = [];
    await page.route("**/api/assistant/animate", (route) => {
      written.push(route.request().postDataJSON());
      return route.fulfill({ json: { prompt: "The bird lifts its wings.", model: "writer" } });
    });
    state.gallery.push({
      id: "length-bird",
      type: "image",
      status: "done",
      url: image,
      thumbnailUrl: image,
      prompt: "An amber bird",
      width: 1024,
      height: 1024,
      createdAt: stamp,
    });
    await page.goto("/images");
    await page.getByRole("button", { name: "Open image: Amber Bird", exact: true }).click();
    await viewerAction(page, "Animate");
    const menu = page.getByRole("menu", { name: "Animate", exact: true });
    await expect(
      menu.getByRole("menuitem", { name: "Review Prompt", exact: true }),
    ).toHaveAttribute("aria-checked", "false");
    const length = review ? "10.13" : "10";
    await menu.getByText(length, { exact: true }).click();
    await expect(menu.getByRole("radio", { name: length, exact: true })).toBeChecked();
    if (review) await menu.getByRole("menuitem", { name: "Review Prompt", exact: true }).click();
    await menu.getByRole("menuitem", { name: "Action", exact: true }).click();
    if (review) {
      const dialog = page.getByRole("dialog", { name: "Review Prompt", exact: true });
      await expect(dialog.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
        "The bird lifts its wings.",
      );
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        profileId: local.id,
        frames: 243,
        fps: 24,
        assetId: "asset-length-bird",
      });
      switched = true;
      await dialog.getByRole("button", { name: "Run", exact: true }).click();
    }
    await expect.poll(() => state.jobs.length).toBe(1);
    expect(state.jobs[0].input).toMatchObject(
      review
        ? {
            profileId: local.id,
            frames: 243,
            fps: 24,
            writing: { kind: "animate", prompt: "The bird lifts its wings." },
          }
        : { profileId: cloud.id, duration: 10, writing: { kind: "animate", theme: "action" } },
    );
    expect(state.jobs[0].input.parentItemId).toBe("length-bird");
    expect(state.jobs[0].input.referenceAssets).toEqual([
      { assetId: "asset-length-bird", slot: "start" },
    ]);
    expect(state.referenceRequests).toEqual([{ galleryItemId: "length-bird" }]);
  });
}
