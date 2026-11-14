import { expect, test } from "@playwright/test";

import { expandComposer, fixtures, profiles, stamp } from "./fixtures";

test("Images and Videos tabs keep an expanding bottom composer", async ({ page }, testInfo) => {
  const state = await fixtures(page);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An amber bird");
  const primary = page.getByRole("button", { name: "Generate Image", exact: true });
  await expect(primary).toBeEnabled();
  const visual = await primary.evaluate((element) => {
    const style = getComputedStyle(element);
    const label = element.querySelector("svg")!;
    return {
      color: style.color,
      background: style.backgroundColor,
      clipped: label.getBoundingClientRect().width === 0,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((value) => value / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(visual.color),
    b = luminance(visual.background);
  expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
  expect(visual.clipped).toBe(false);
  expect(visual.overflow).toBe(false);
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect(page).toHaveURL("/images");
  await expect.poll(() => state.jobs.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Open image: An amber bird", exact: true }),
  ).toBeVisible();
  await expandComposer(page);
  await page.getByRole("combobox", { name: "Profile", exact: true }).click();
  // Each profile option names its model, kind and backend in short facts.
  await expect(page.getByRole("option", { name: /^Image Fast\b/ })).toContainText(
    "Studio Image · Image · Local GPU",
  );
  await page.getByRole("option", { name: /^Image Fast\b/ }).click();
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input.profileId).toBe("image:fast");
  if (testInfo.project.use.isMobile)
    await expect(page.getByRole("dialog", { name: "Generate" })).toBeHidden();
  await page.screenshot({
    path: `/tmp/studio-rewrite-${testInfo.project.name}.png`,
    fullPage: false,
  });
  await page.getByRole("link", { name: "Videos", exact: true }).first().click();
  await expect(page).toHaveURL(/\/video$/);
  await expect(page.getByRole("heading", { name: "Videos", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Generate Video", exact: true })).toBeVisible();
});

test("Retry pending state holds while unrelated jobs remain cancellable", async ({ page }) => {
  const state = await fixtures(page);
  const input = {
    ...profiles[0].defaults,
    kind: "image",
    profileId: "image:test",
    prompt: "Retry Study",
    referenceAssets: [],
  };
  state.jobs.push(
    ...["failed", "running"].map((status, index) => ({
      id: `retry-${index}`,
      sessionId: "retry-session",
      operation: "image",
      input,
      status,
      items: [],
      outputs: [],
      createdAt: stamp,
      updatedAt: stamp,
    })),
  );
  let calls = 0;
  let release!: () => void;
  const accepted = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/queue/retry-0/retry", async (route) => {
    calls++;
    await accepted;
    await route.fulfill({ json: { job: state.jobs[0] } });
  });
  try {
    await page.goto("/images");
    await page.getByRole("button", { name: "Open Status", exact: true }).click();
    const queue = page.getByRole("dialog", { name: "Generations", exact: true });
    const retry = queue.getByRole("button", { name: "Retry", exact: true });
    await retry.click();
    await expect.poll(() => calls).toBe(1);
    await expect(retry).toBeDisabled();
    await queue.getByRole("button", { name: "Stop", exact: true }).click();
    await expect.poll(() => state.jobs[1].status).toBe("cancelled");
    expect(calls).toBe(1);
    release();
    // The accepted retry takes the failed original out of the queue.
    await expect(retry).toHaveCount(0);
  } finally {
    release();
  }
});
