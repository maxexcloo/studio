import { expect, test, type Page } from "@playwright/test";
import { dreamItem, fixtures, serveDream } from "./fixtures";

const current = (page: Page) => page.getByRole("group", { name: "Current Dream", exact: true });
const verdicts = (state: Awaited<ReturnType<typeof serveDream>>) =>
  state.requests.map((request) => `${request.method} ${request.path}`);

test("The Dream deck judges results with keys, a drag and its buttons", async ({ page }) => {
  await fixtures(page);
  const dream = await serveDream(page, {
    unseen: ["one", "two", "three", "four", "five"].map((id) => dreamItem(id)),
  });
  await page.goto("/images");
  await page.getByRole("link", { name: "Dream", exact: true }).click();
  await expect(page).toHaveURL(/\/dream$/);
  await expect(current(page)).toContainText("Because you star one.");
  await expect(current(page)).toContainText("Dream prompt one");
  await expect(page.getByRole("status", { name: "Dream Status" })).toContainText(
    "Waiting for idle time",
  );

  await page.keyboard.press("ArrowRight");
  await expect(current(page)).toContainText("Dream prompt two");
  await page.keyboard.press("ArrowLeft");
  await expect(current(page)).toContainText("Dream prompt three");
  await page.keyboard.press("ArrowUp");
  await expect(current(page)).toContainText("Dream prompt four");

  // A drag past a third of the card's width discards it; a short one springs back.
  const box = (await current(page).boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x - 20, centre.y, { steps: 4 });
  await page.mouse.up();
  await expect(current(page)).toContainText("Dream prompt four");
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x - box.width / 2, centre.y + 10, { steps: 8 });
  await page.mouse.up();
  await expect(current(page)).toContainText("Dream prompt five");

  await page.getByRole("button", { name: "Star", exact: true }).click();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();
  expect(verdicts(dream)).toEqual([
    "POST /api/dream/one/keep",
    "POST /api/dream/two/discard",
    "POST /api/dream/three/variations",
    "POST /api/dream/four/discard",
    "POST /api/dream/five/keep",
  ]);
});

test("Dream explains itself while off and saves its settings on the deck", async ({ page }) => {
  await fixtures(page);
  const dream = await serveDream(page, { enabled: false, spicyAvailable: true });
  await page.goto("/dream");
  await expect(page.getByText("Dream Is Off", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn On", exact: true }).click();
  await expect(page.getByText("Nothing New Yet", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Dream Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Dream Settings" });
  const videos = settings.getByRole("switch", { name: /^Videos/ });
  await videos.click();
  await expect(videos).toBeChecked();
  const buffer = settings.getByRole("textbox", { name: "Unseen Buffer" });
  await buffer.fill("20");
  await buffer.press("Enter");
  await expect(settings.getByRole("switch", { name: /^Spicy/ })).toBeVisible();
  await expect
    .poll(() => dream.requests.map((request) => request.body))
    .toEqual([{ enabled: true }, { videos: true }, { buffer: 20 }]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Pause Dream", exact: true }).click();
  await expect(page.getByText("Dream Is Paused", { exact: true })).toBeVisible();
  expect(dream.settings.paused).toBe(true);
});

test("Animate keeps a Dream image and stages it in the Videos composer", async ({ page }) => {
  const state = await fixtures(page);
  const dream = await serveDream(page, { unseen: [dreamItem("fox")] });
  await page.goto("/dream");
  await page.getByRole("button", { name: "Animate", exact: true }).click();
  await expect(page).toHaveURL(/\/video/);
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Dream prompt fox",
  );
  expect(verdicts(dream)).toEqual(["POST /api/dream/fox/keep"]);
  expect(state.referenceRequests).toEqual([{ galleryItemId: "fox" }]);
});

test("Calibration judges gallery images, singly and as a pair, even while Dream is off", async ({
  page,
}) => {
  await fixtures(page);
  const gallery = ["g1", "g2", "g3", "g4"].map((id) => ({
    ...dreamItem(id),
    dream: undefined,
  }));
  const dream = await serveDream(page, { enabled: false, calibration: gallery });
  await page.goto("/dream");
  await page.getByRole("button", { name: "Tune Your Taste", exact: true }).click();
  const card = page.getByRole("group", { name: "Current Gallery Image", exact: true });
  await expect(card).toContainText("From Your Gallery");
  await expect(page.getByRole("button", { name: "Animate", exact: true })).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(card).toContainText("Dream prompt g2");
  await page.getByRole("button", { name: "Pass", exact: true }).click();
  await expect(page.getByRole("group", { name: "Which Do You Prefer?" })).toBeVisible();
  await page.getByRole("button", { name: "Prefer Second Image", exact: true }).click();
  await expect(page.getByText("Dream Is Off", { exact: true })).toBeVisible();
  expect(dream.requests.map((request) => request.body)).toEqual([
    { liked: ["g1"] },
    { passed: ["g2"] },
    { liked: ["g4"], passed: ["g3"] },
  ]);
});

test("Discarded Dream results stay listed and can be kept after all", async ({ page }) => {
  await fixtures(page);
  const dream = await serveDream(page, {
    discarded: [dreamItem("gone", { dream: { prompt: "p", why: "", at: "", state: "discarded" } })],
  });
  await page.goto("/dream");
  await page.getByText("Discarded", { exact: true }).click();
  await page.getByRole("button", { name: "Keep Dream prompt gone", exact: true }).click();
  await expect(page.getByText("No Discards", { exact: true })).toBeVisible();
  expect(verdicts(dream)).toEqual(["POST /api/dream/gone/keep"]);
});
