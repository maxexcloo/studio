import { expect, test } from "@playwright/test";
import { create, fixtures, openNav, profiles, stamp } from "./fixtures";

test("Image → Refine → Animate retains one session and can reopen saved work", async ({ page }) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An amber bird");
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  await page.goto("/chat/session-1");
  await expect(page.getByRole("button", { name: "Open image: An amber bird" })).toBeVisible();
  await page
    .getByRole("article", { name: "Iteration 1", exact: true })
    .getByRole("button", { name: "Refine", exact: true })
    .click();
  // Refine and Animate stage their own card; the Chat composer keeps its references.
  const refine = page.getByRole("region", { name: "Refine Iteration 1", exact: true });
  await refine
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("An amber bird with silver wings");
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toHaveCount(1);
  await refine.getByRole("button", { name: "Refine Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  await expect(refine).toBeHidden();
  await expect(page.getByText("Refined iteration 1", { exact: true })).toBeVisible();
  await page
    .getByRole("article", { name: "Iteration 2", exact: true })
    .getByRole("button", { name: "Animate", exact: true })
    .click();
  const animate = page.getByRole("region", { name: "Animate Iteration 2", exact: true });
  await animate
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("The bird spreads its wings");
  await animate.getByRole("button", { name: "Generate Video", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(3);
  expect(state.jobs.map((j) => j.operation)).toEqual(["image", "refine", "animate"]);
  expect(state.jobs[1].parentJobId).toBe("job-1");
  expect(state.jobs[2].parentJobId).toBe("job-2");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open video: The bird spreads its wings" }),
  ).toBeVisible();
  await openNav(page, "Images");
  // The refined image is a version of the first, so Grid shows them as one tile.
  await expect(
    page.getByRole("button", { name: /^Open image: .*, Version 2 of 2$/ }),
  ).toBeVisible();
});

test("Images and Videos tabs keep an expanding bottom composer while Chat keeps sessions beside the media", async ({
  page,
}, testInfo) => {
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
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click();
  await page.getByRole("combobox", { name: "Profile", exact: true }).click();
  await page.getByRole("option", { name: "Image Fast", exact: true }).click();
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input.profileId).toBe("image:fast");
  expect(state.jobs[1].input.backendId).toBe("worker-a");
  if (testInfo.project.use.isMobile)
    await expect(page.getByRole("dialog", { name: "Generation Controls" })).toBeHidden();
  await page.screenshot({
    path: `/tmp/studio-rewrite-${testInfo.project.name}.png`,
    fullPage: false,
  });
  await page.getByRole("link", { name: "Videos", exact: true }).first().click();
  await expect(page).toHaveURL(/\/video$/);
  await expect(page.getByRole("heading", { name: "Videos", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Generate Video", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Chat", exact: true }).first().click();
  await expect(page.getByText("No Chat Selected", { exact: true })).toBeVisible();
  if (testInfo.project.use.isMobile)
    await page.getByRole("button", { name: "Open Status", exact: true }).click();
  // The Chat stays New Chat until the text model titles it.
  await expect(page.getByRole("link", { name: /New Chat/ }).first()).toBeVisible();
});

test("Retry pending state is shared while unrelated jobs remain cancellable", async ({ page }) => {
  const state = await fixtures(page);
  const input = {
    ...profiles[0].defaults,
    kind: "image",
    profileId: "image:test",
    prompt: "Retry Study",
    referenceAssets: [],
  };
  state.sessions.push({
    id: "retry-session",
    title: "Retry Session",
    inputs: input,
    createdAt: stamp,
    updatedAt: stamp,
  });
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
    await page.goto("/chat/retry-session");
    const retry = page
      .getByRole("article", { name: "Iteration 1", exact: true })
      .getByRole("button", { name: "Retry", exact: true });
    await retry.click();
    await expect.poll(() => calls).toBe(1);
    await expect(retry).toBeDisabled();
    // Gallery modes own the queue slideout; the pending retry stays shared across surfaces.
    await page.getByRole("link", { name: "Images", exact: true }).first().click();
    await page.getByRole("button", { name: "Open Status", exact: true }).click();
    const queue = page.getByRole("dialog", { name: "Generations", exact: true });
    await expect(queue.getByRole("button", { name: "Retry", exact: true })).toBeDisabled();
    await queue.getByRole("button", { name: "Stop", exact: true }).click();
    await expect.poll(() => state.jobs[1].status).toBe("cancelled");
    expect(calls).toBe(1);
    await page.keyboard.press("Escape");
    await expect(queue).toBeHidden();
    await page.goBack();
    release();
    await expect(retry).toBeEnabled();
  } finally {
    release();
  }
});
