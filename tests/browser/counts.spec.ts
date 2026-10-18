import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page, phone: boolean, imageMaximum = 8) {
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) {
    profile.defaults.count = 1;
    profile.constraints.count = { min: 1, max: profile.kind === 'video' ? 1 : imageMaximum, step: 1 };
    profile.capabilities.variations = profile.kind === 'image';
    profile.mediaInputs = [];
    profile.capabilities.startImageRequired = false;
  }
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.goto('/');
  if (phone) await page.locator('.phone-create-open').click();
  else await composer(page, phone).getByRole('textbox', { name: 'Prompt', exact: true }).focus();
}

function composer(page: Page, phone: boolean) {
  return page.locator(phone ? '.phone-create' : '.zen-prompt').filter({ visible: true });
}

async function setCount(page: Page, phone: boolean, kind: 'Images' | 'Videos', count: number) {
  const root = composer(page, phone);
  if (!phone) await root.getByRole('textbox', { name: 'Prompt', exact: true }).focus();
  await root.getByRole('button', { name: new RegExp(`^${kind}: \\d+, click to edit$`) }).click();
  const input = root.locator('.number-picker-input');
  await input.fill(String(count));
  await input.press('Enter');
  await expect(root.getByRole('button', { name: `${kind}: ${count}, click to edit`, exact: true })).toBeVisible();
}

async function mode(page: Page, phone: boolean, kind: 'Image' | 'Video') {
  if (!phone) await composer(page, phone).getByRole('textbox', { name: 'Prompt', exact: true }).focus();
  await composer(page, phone).getByRole('group', { name: 'Generation Mode', exact: true }).getByRole('button', { name: kind, exact: true }).click();
}

async function generate(page: Page, phone: boolean, prompt: string) {
  const root = composer(page, phone);
  await root.getByRole('textbox', { name: 'Prompt', exact: true }).fill(prompt);
  await root.locator('.composer-submit-actions button').click();
}

test('image and video default to two, retaining independent choices and reloads', async ({ page, isMobile }) => {
  await prepare(page, isMobile);
  await expect(composer(page, isMobile).getByRole('button', { name: 'Images: 2, click to edit', exact: true })).toBeVisible();
  await setCount(page, isMobile, 'Images', 6);
  await mode(page, isMobile, 'Video');
  await expect(composer(page, isMobile).getByRole('button', { name: 'Videos: 2, click to edit', exact: true })).toBeVisible();
  await setCount(page, isMobile, 'Videos', 3);
  await mode(page, isMobile, 'Image');
  await expect(composer(page, isMobile).getByRole('button', { name: 'Images: 6, click to edit', exact: true })).toBeVisible();
  await mode(page, isMobile, 'Video');
  await expect(composer(page, isMobile).getByRole('button', { name: 'Videos: 3, click to edit', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('heiss-ui-draft') || '{}').count)).toBe(3);
  await page.reload();
  if (isMobile) await page.locator('.phone-create-open').click();
  else await composer(page, isMobile).getByRole('textbox', { name: 'Prompt', exact: true }).focus();
  await expect(composer(page, isMobile).getByRole('button', { name: 'Videos: 3, click to edit', exact: true })).toBeVisible();
  await mode(page, isMobile, 'Image');
  await expect(composer(page, isMobile).getByRole('button', { name: 'Images: 6, click to edit', exact: true })).toBeVisible();
  const layout = await composer(page, isMobile).evaluate((element) => ({ scroll: element.scrollWidth, width: element.clientWidth }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.width + 1);
});

test('image payload batches two while video counts queue independent single-video jobs', async ({ page, isMobile }) => {
  await prepare(page, isMobile);
  const requests: Record<string, any>[] = [];
  await page.route('**/api/generate', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { jobId: `count-job-${requests.length}`, items: [] } });
  });
  await page.route('**/api/jobs/count-job-*', (route) => route.fulfill({ json: { status: 'done', outputs: [] } }));
  await generate(page, isMobile, 'Two images');
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ kind: 'image', count: 2, variationCount: 2 });
  if (isMobile) await page.locator('.phone-create-open').click();
  await mode(page, isMobile, 'Video');
  await setCount(page, isMobile, 'Videos', 3);
  await generate(page, isMobile, 'Three videos');
  await expect.poll(() => requests.length).toBe(4);
  for (const request of requests.slice(1)) {
    expect(request).toMatchObject({ kind: 'video', count: 1 });
    expect(request).not.toHaveProperty('variationCount');
    expect(request.profileId).toBe(requests[1].profileId);
    expect(request.model).toBe(requests[1].model);
  }
  expect(new Set(requests.map((request) => request.clientJobId)).size).toBe(4);
});

test('image defaults and outgoing count honour a model maximum of one', async ({ page, isMobile }) => {
  await prepare(page, isMobile, 1);
  const root = composer(page, isMobile);
  if (!isMobile) await expect(root.getByRole('button', { name: 'Images: 1, click to edit', exact: true })).toBeVisible();
  const increase = root.getByRole('button', { name: 'Increase images', exact: true });
  if (await increase.count()) await expect(increase).toBeDisabled();
  let payload: Record<string, any> | null = null;
  await page.route('**/api/generate', (route) => {
    payload = route.request().postDataJSON();
    return route.fulfill({ status: 400, json: { error: 'Captured count payload' } });
  });
  await generate(page, isMobile, 'One image within the model limit');
  await expect.poll(() => payload).not.toBeNull();
  expect(payload).toMatchObject({ kind: 'image', count: 1, variationCount: 1 });
});

test('a failed video submission stops the remainder and preserves queued jobs', async ({ page, isMobile }) => {
  await prepare(page, isMobile);
  await mode(page, isMobile, 'Video');
  await setCount(page, isMobile, 'Videos', 3);
  let submissions = 0;
  let polls = 0;
  await page.route('**/api/generate', (route) => {
    submissions += 1;
    return submissions === 1
      ? route.fulfill({ json: { jobId: 'partial-count-job', items: [] } })
      : route.fulfill({ status: 400, json: { error: 'Video queue unavailable' } });
  });
  await page.route('**/api/jobs/partial-count-job', (route) => { polls += 1; return route.fulfill({ json: { status: 'done', outputs: [] } }); });
  await generate(page, isMobile, 'A partially accepted video queue');
  await expect(page.getByText('1 of 3 generations queued. Video queue unavailable', { exact: true }).first()).toBeVisible();
  await expect.poll(() => polls).toBeGreaterThan(0);
  expect(submissions).toBe(2);
});

test('Stop All prevents further video submissions and cancels an in-flight accepted job', async ({ page, isMobile }) => {
  await prepare(page, isMobile);
  await mode(page, isMobile, 'Video');
  await setCount(page, isMobile, 'Videos', 3);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let submissions = 0;
  let queueStopped = false;
  let lateJobStopped = false;
  await page.route('**/api/generate', async (route) => {
    submissions += 1;
    await held;
    await route.fulfill({ json: { jobId: 'late-count-job', items: [] } });
  });
  await page.route('**/api/queue/cancel', (route) => { queueStopped = true; return route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/jobs/late-count-job/cancel', (route) => { lateJobStopped = true; return route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/jobs/late-count-job', (route) => route.fulfill({ json: { status: 'canceled', outputs: [] } }));
  await generate(page, isMobile, 'A stoppable video selection');
  await expect.poll(() => submissions).toBe(1);
  if (isMobile) {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Stop All Generations', exact: true }).click();
  } else await page.locator('.dock-chip.is-cancel').filter({ hasText: /Stop/i }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Stop all', exact: true }).click();
  await expect.poll(() => queueStopped).toBe(true);
  release();
  await expect.poll(() => lateJobStopped).toBe(true);
  expect(submissions).toBe(1);
});
