import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import ffmpeg from 'ffmpeg-static';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const video = execFileSync(ffmpeg!, ['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10', '-t', '2', '-an', '-c:v', 'libx264', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', '-loglevel', 'error', 'pipe:1']);

test.beforeEach(async ({ page }) => {
  await page.route('**/api/loras/*', route => route.fulfill({ json: { found: false, loras: [] } }));
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) profile.capabilities.negativePrompt = true;
  await page.route('**/api/models', route => route.fulfill({ json: models }));
});

for (const kind of ['image', 'video'] as const) {
  for (const failed of [false, true]) {
    test(`reusing ${failed ? 'failed' : 'completed'} ${kind} settings keeps its viewer open`, async ({ page, isMobile }) => {
      const item = {
        id: `reuse-${kind}`,
        url: failed ? '' : kind === 'image' ? picture : '/reuse-video.mp4',
        filename: `reuse.${kind === 'image' ? 'png' : 'mp4'}`,
        type: kind,
        status: failed ? 'error' : 'done',
        prompt: `Keep this ${kind} open while reusing its settings`,
        negative: 'Keep the negative prompt too',
        model: kind === 'image' ? 'flux1-schnell.safetensors' : 'wan2.1_i2v_480p.safetensors',
        createdAt: new Date().toISOString(),
        width: 512,
        height: 512,
        error: failed ? 'Test generation failed' : undefined,
        settings: { profileId: kind === 'image' ? 'mock-flux-schnell' : 'mock-wan-video', steps: 4, cfg: 1, seed: '123' }
      };
      await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: new URL(route.request().url()).searchParams.get('type') === kind ? [item] : [], revision: 1, hasMore: false } }));
      await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
      await page.route('**/reuse-video.mp4*', (route) => route.fulfill({ body: video, contentType: 'video/mp4' }));
      await page.goto('/');
      if (kind === 'video') await page.locator(isMobile ? '.phone-mode-select' : '.gallery-generation-mode').getByRole('button', { name: /^Videos?$/ }).click();
      await page.locator(`[data-tile-id="${item.id}"]`).click();
      const viewer = page.getByRole('dialog', { name: 'Image Viewer', exact: true });
      await expect(viewer).toBeVisible();
      await viewer.evaluate((element) => { element.setAttribute('data-reuse-check', 'original-viewer'); });
      const media = viewer.locator(`.viewer-canvas ${kind === 'video' ? 'video' : 'img'}`).first();
      const source = failed ? null : await media.getAttribute('src');
      const reuse = isMobile
        ? viewer.locator('.viewer-phone-bar').getByRole('button', { name: 'Use This Model', exact: true })
        : (failed ? viewer.locator('.failure-panel') : viewer).getByRole('button', { name: failed ? /Use (?:This Model|these settings)/ : 'Use This Model', exact: true });

      for (const dismiss of isMobile ? ['button', 'escape', 'back'] : ['viewer']) {
        await reuse.click();
        await expect(viewer).toHaveAttribute('data-reuse-check', 'original-viewer');
        if (isMobile) {
          const composer = page.locator('.phone-create');
          await expect(composer).toBeVisible();
          await expect(composer.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue(item.prompt);
          await expect(composer.getByRole('textbox', { name: 'Negative Prompt', exact: true })).toHaveValue(item.negative);
          if (dismiss === 'button') await composer.getByRole('button', { name: 'Close', exact: true }).click();
          else if (dismiss === 'escape') await page.keyboard.press('Escape');
          else await page.evaluate(() => window.history.back());
          await expect(composer).toHaveCount(0);
          await expect(viewer).toBeVisible();
          await expect(viewer).toHaveAttribute('data-reuse-check', 'original-viewer');
        }
        if (failed) await expect(viewer.locator('.failure-panel')).toBeVisible();
        else await expect(media).toHaveAttribute('src', source!);
      }

      await viewer.getByRole('button', { name: isMobile ? 'Close Viewer' : 'Close', exact: true }).click();
      await expect(viewer).toHaveCount(0);
      if (isMobile) await page.locator('.phone-create-open').click();
      await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue(item.prompt);
    });
  }
}

for (const promptsOnly of [false, true]) {
  test(`${promptsOnly ? 'prompts-only reuse preserves' : 'missing-model reuse safely adapts to'} the current model`, async ({ page, isMobile }) => {
    const models = await (await page.request.get('/api/models')).json();
    const current = models.profiles.find((profile: any) => profile.id === models.defaults.imageModel);
    current.capabilities.negativePrompt = true;
    current.constraints.steps = { min: 1, max: 50, step: 1 };
    current.constraints.width = { min: 256, max: 2048, step: 32 };
    current.constraints.height = { min: 256, max: 2048, step: 32 };
    const item = { id: 'missing-model-output', url: picture, filename: 'missing.png', type: 'image', status: 'done', prompt: 'Reuse my prompts safely', negative: 'A different negative prompt', model: 'removed-model.safetensors', createdAt: new Date().toISOString(), width: 901, height: 701, settings: { profileId: 'removed-model', workflow: current.workflow, steps: 9999, cfg: 999, sampler: 'absent-sampler', vae: 'absent-vae', seed: '123', loras: [{ name: 'absent-lora', strength: 1 }] } };
    const reference = { id: 'preserved-reference', source: 'upload', name: 'Current Reference', url: picture, thumbnailUrl: picture, mime: 'image/png', width: 1024, height: 1024, size: 1, createdAt: '', privacyDomain: 'gallery' };
    await page.route('**/api/models', (route) => route.fulfill({ json: models }));
    await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
    await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
    await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [reference], hasMore: false, nextCursor: '' } }));
    let body: Record<string, any> | null = null;
    await page.route('**/api/generate', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ status: 400, json: { error: 'Test request captured' } }); });
    await page.goto('/');
    if (isMobile) await page.locator('.phone-create-open').click();
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Original draft');
    await page.getByRole('button', { name: 'Reference Image', exact: true }).click();
    await page.getByRole('button', { name: reference.name, exact: true }).click();
    if (isMobile) await page.locator('.phone-create').getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator(`[data-tile-id="${item.id}"]`).click();
    const viewer = page.getByRole('dialog', { name: 'Image Viewer', exact: true });
    if (promptsOnly) {
      const actions = viewer.locator(isMobile ? '.viewer-phone-bar' : '.viewer-actions');
      if (isMobile) {
        for (const width of [320, 390]) {
          await page.setViewportSize({ width, height: 844 });
          for (const button of await actions.locator('.viewer-reuse-split > button').all()) {
            const box = await button.boundingBox();
            expect(box!.width).toBeGreaterThanOrEqual(44);
            expect(box!.height).toBeGreaterThanOrEqual(44);
            expect(box!.x).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(width);
          }
        }
      }
      await actions.getByRole('button', { name: 'Reuse Options', exact: true }).click();
      await actions.getByRole('menuitem', { name: 'Prompts Only', exact: true }).click();
    } else await viewer.locator(isMobile ? '.viewer-phone-bar' : '.viewer-actions').getByRole('button', { name: 'Use This Model', exact: true }).click();
    if (isMobile && await page.locator('.phone-create').isVisible()) await page.locator('.phone-create').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(viewer).toBeVisible();
    await viewer.getByRole('button', { name: isMobile ? 'Close Viewer' : 'Close', exact: true }).click();
    if (isMobile) await page.locator('.phone-create-open').click();
    else await page.getByRole('textbox', { name: 'Prompt', exact: true }).focus();
    await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue(item.prompt);
    await expect(page.getByRole('textbox', { name: 'Negative Prompt', exact: true })).toHaveValue(item.negative);
    await (isMobile ? page.locator('.phone-create') : page).getByRole('button', { name: 'Generate', exact: true }).click();
    await expect.poll(() => body).not.toBeNull();
    expect(body!.profileId).toBe(current.id);
    expect(body!.width % 32).toBe(0);
    expect(body!.height % 32).toBe(0);
    expect(body!.sampler).not.toBe('absent-sampler');
    expect(body!.vae).not.toBe('absent-vae');
    expect(body!.loras || []).toEqual([]);
    const referenceSlot = current.mediaInputs?.find((input: any) => input.kind === 'image')?.id || 'reference';
    expect(body!.referenceAssets).toEqual([{ slot: referenceSlot, assetId: reference.id }]);
    if (promptsOnly) {
      expect(body!.width).toBe(current.defaults.width);
      expect(body!.height).toBe(current.defaults.height);
      expect(body!.steps).toBe(current.defaults.steps);
      expect(body!.seed).not.toBe('123');
    } else {
      expect(body!.width).toBe(896);
      expect(body!.height).toBe(704);
      expect(body!.steps).toBeLessThanOrEqual(current.constraints.steps.max);
    }
  });
}
