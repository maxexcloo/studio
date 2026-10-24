import { expect, test, type Page } from "@playwright/test";
import { fixtures, image, stamp, viewerAction } from "./fixtures";

async function seed(page: Page) {
  const state = await fixtures(page);
  const settings = { profileId: "image:test", seed: 1234567, steps: 28, count: 2 };
  const item = {
    id: "hub",
    jobId: "job-hub",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "An amber bird",
    width: 1024,
    height: 1024,
    createdAt: stamp,
    settings,
  };
  state.sessions.push({
    id: "session-hub",
    title: "Hub",
    inputs: {},
    createdAt: stamp,
    updatedAt: stamp,
  });
  state.jobs.push({
    id: "job-hub",
    jobId: "job-hub",
    sessionId: "session-hub",
    status: "completed",
    operation: "image",
    input: { kind: "image", prompt: item.prompt, ...settings },
    items: [item],
    outputs: [item],
    createdAt: stamp,
    updatedAt: stamp,
  });
  state.gallery.push(item);
  await page.goto("/images");
  await page.getByRole("button", { name: "Open image: An amber bird", exact: true }).click();
  return { state, viewer: page.getByRole("dialog", { name: "Generation", exact: true }) };
}

test("The viewer prompt bar queues variations into a strip and choosing one makes it current", async ({
  page,
}) => {
  const { state, viewer } = await seed(page);
  const prompt = viewer.getByRole("textbox", { name: "Variation Prompt", exact: true });
  await expect(prompt).toHaveValue("An amber bird");
  await prompt.fill("An amber bird in snow");
  await prompt.press("Enter");
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1]).toMatchObject({
    sessionId: "session-hub",
    parentJobId: "job-hub",
    operation: "image",
    input: { prompt: "An amber bird in snow", seed: "", count: 1, steps: 28 },
  });
  const strip = viewer.getByRole("list", { name: "Variations", exact: true });
  await expect(strip.getByRole("listitem")).toHaveCount(2);
  await strip.getByRole("listitem", { name: "Show Variation 2", exact: true }).click();
  await expect(
    viewer.getByRole("img", { name: "An amber bird in snow", exact: true }),
  ).toBeVisible();
  await expect(strip.getByRole("listitem").nth(1)).toHaveAttribute("aria-current", "true");

  await viewer.getByRole("button", { name: "Regenerate", exact: true }).click();
  await page.getByRole("menuitem", { name: "Exact Repeat", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(3);
  expect(state.jobs[2]).toMatchObject({ parentJobId: state.jobs[1].id, input: { count: 1 } });
  await expect(strip.getByRole("listitem")).toHaveCount(3);
});

test("Recreate and New Seed draw a new seed; only Exact Repeat keeps it", async ({ page }) => {
  const { state, viewer } = await seed(page);
  await viewer.getByRole("button", { name: "Regenerate", exact: true }).click();
  await page.getByRole("menuitem", { name: "New Seed", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input).toMatchObject({ seed: "", steps: 28 });
  await viewer.getByRole("button", { name: "Regenerate", exact: true }).click();
  await page.getByRole("menuitem", { name: "Exact Repeat", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(3);
  expect(state.jobs[2].input).toMatchObject({ seed: 1234567, steps: 28 });
  await viewerAction(page, "Recreate");
  await expect(viewer).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "An amber bird",
  );
  await expect(page.getByRole("button", { name: /^Clear Seed/ })).toHaveCount(0);
});

test("Animate themes write the motion prompt and queue a video from the image", async ({
  page,
}) => {
  const { state, viewer } = await seed(page);
  // Registered after the shared fixtures so it takes precedence.
  const written: any[] = [];
  await page.route("**/api/assistant/animate", (route) => {
    written.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, prompt: "The bird takes flight" } });
  });
  await viewer.getByRole("button", { name: "Animate", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Spicy", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Living Photo", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(written).toEqual([{ profileId: "video:test", prompt: "An amber bird", theme: "living" }]);
  expect(state.jobs[1]).toMatchObject({
    operation: "animate",
    parentJobId: "job-hub",
    input: {
      kind: "video",
      prompt: "The bird takes flight",
      referenceAssets: [{ assetId: "asset-hub", slot: "start" }],
    },
  });
});

test("Desktop details stay where the viewer left them", async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.isMobile), "Phones show details in a sheet.");
  const { viewer } = await seed(page);
  const details = viewer.getByRole("complementary", { name: "Generation Details", exact: true });
  await expect(details.getByText("1234567", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Generation Details", exact: true }).click();
  await expect(details).toBeHidden();
  await viewer.getByRole("button", { name: "Close Generation", exact: true }).click();
  await page.getByRole("button", { name: "Open image: An amber bird", exact: true }).click();
  await expect(
    viewer.getByRole("button", { name: "Generation Details", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(details).toBeHidden();
});

test("Phone swipes reveal details and close the viewer", async ({ page }, testInfo) => {
  test.skip(
    !testInfo.project.use.isMobile || testInfo.project.use.browserName === "webkit",
    "Touch input is dispatched through Chromium's protocol.",
  );
  const { viewer } = await seed(page);
  const picture = viewer.getByRole("img", { name: "An amber bird", exact: true });
  await expect(picture).toBeVisible();
  const touch = await page.context().newCDPSession(page);
  async function swipe(dy: number) {
    const box = (await picture.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + dy }],
    });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await swipe(-120);
  const sheet = page.getByRole("dialog", { name: "An amber bird", exact: true });
  await expect(sheet.getByText("1234567", { exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Close Details", exact: true }).click();
  await expect(sheet).toBeHidden();
  await swipe(120);
  await expect(viewer).toBeHidden();
});
