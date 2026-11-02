import { expect, test } from "@playwright/test";
import { fixtures, signIn, stamp } from "./fixtures";

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
      input: { prompt: id },
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

  await queue.getByRole("button", { name: "Pause Queue", exact: true }).click();
  await expect(queue.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await expect(queue.getByText("Queued · Paused", { exact: true })).toHaveCount(3);
  await queue.getByRole("button", { name: "Pause All", exact: true }).click();
  await queue.getByRole("button", { name: "Resume All", exact: true }).click();
  await queue.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(queue.getByRole("button", { name: "Pause Queue", exact: true })).toBeVisible();
  expect(state.queuePause).toEqual({ mine: false, all: false });

  // Only waiting items move; the first can't go up and the last can't go down.
  const move = (index: number) =>
    queue.getByRole("button", { name: "Move", exact: true }).nth(index);
  await expect(queue.getByRole("button", { name: "Move", exact: true })).toHaveCount(3);
  await move(2).click();
  await expect(page.getByRole("menuitem", { name: "Move Down", exact: true })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Move to Top", exact: true }).click();
  await expect.poll(order).toEqual(["running-job", "third", "first", "second"]);
  await move(0).click();
  await expect(page.getByRole("menuitem", { name: "Move Up", exact: true })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Move Down", exact: true }).click();
  await expect.poll(order).toEqual(["running-job", "first", "third", "second"]);
});
