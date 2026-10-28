import { expect, test } from "@playwright/test";
import { create, fixtures, image, stamp } from "./fixtures";

test("Compare Variants from the composer queues one seeded set and starring the winner loads it", async ({
  page,
}) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("A copper fox");
  await page.getByRole("button", { name: "Compare Variants", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Compare Variants", exact: true });
  await expect(dialog.getByRole("group", { name: "Variant B", exact: true })).toContainText(
    "Image Fast",
  );
  await dialog.getByRole("button", { name: "Compare 2 Variants", exact: true }).click();

  await expect(page).toHaveURL(/\/compare\/compare-1$/);
  const [run] = state.comparisons;
  expect(run.requests.map((variant: any) => [variant.label, variant.input.profileId])).toEqual([
    ["Image Quality", "image:test"],
    ["Image Fast", "image:fast"],
  ]);
  expect(run.requests.map((variant: any) => variant.input.count)).toEqual([1, 1]);
  await expect(page.getByRole("heading", { name: "Compare", exact: true })).toBeVisible();
  await expect(page.getByText("A copper fox", { exact: true })).toBeVisible();

  const star = page.getByRole("button", { name: "Star Image Fast as Winner", exact: true });
  await star.click();
  await expect(
    page.getByRole("button", { name: "Clear Winner Image Fast", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(run.vote).toBe(run.jobIds[1]);
  expect(state.gallery.find((item) => item.jobId === run.jobIds[1]).favorite).toBe(true);

  await page.getByRole("link", { name: "Open Composer", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toContainText(
    "Image Fast",
  );
  await expect(page.getByRole("button", { name: "Clear Seed 4242", exact: true })).toBeVisible();
});

test("Compare Variants from the tile menu keeps the result's seed and opens variants in the viewer", async ({
  page,
}) => {
  const state = await fixtures(page);
  const settings = { profileId: "image:test", seed: 1234567, steps: 28, cfg: 5 };
  state.gallery.push({
    id: "source",
    jobId: "job-source",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "An amber bird",
    width: 1024,
    height: 1024,
    createdAt: stamp,
    settings,
  });
  await page.goto("/images");
  await page
    .getByRole("button", { name: "Open image: An amber bird", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Compare", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Compare Variants", exact: true });
  await expect(dialog).toContainText("Every variant uses seed 1234567.");
  await dialog.getByText("Steps & Guidance", { exact: true }).click();
  await dialog.getByRole("button", { name: "Compare 2 Variants", exact: true }).click();

  await expect(page).toHaveURL(/\/compare\//);
  const [run] = state.comparisons;
  expect(run.requests.map((variant: any) => [variant.input.seed, variant.input.steps])).toEqual([
    [1234567, 28],
    [1234567, 56],
  ]);
  await expect(page.getByText("Seed 1234567", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Open 56 Steps · Guidance 5", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Generation", exact: true })).toBeVisible();
});
