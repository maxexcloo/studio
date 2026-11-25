import { expect, test } from "@playwright/test";

import {
  editDefinition,
  fixtures,
  openNav,
  profiles,
  section,
  serveProfiles,
  signIn,
} from "./fixtures";

test("Profile edits preserve workflow metadata and retain unsaved text after a conflict", async ({
  page,
}) => {
  await fixtures(page);
  const original = {
    studio: {
      id: "owned",
      name: "Owned Profile",
      kind: "image",
      family: "flux2",
      defaults: { steps: 8 },
      controls: { prompt: { node: "1", input: "text" } },
      customMetadata: { preserved: true },
    },
    graph: { 1: { class_type: "CLIPTextEncode", inputs: { text: "source" } } },
    extra: { retained: [1, 2] },
  };
  let document = structuredClone(original),
    attempts = 0;
  const requests: { text: string; baseHash: string }[] = [];
  await page.route("**/api/profiles/editable**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/profiles/editable")
      return route.fulfill({
        json: {
          profiles: [
            {
              id: "owned",
              name: document.studio.name,
              family: "flux2",
              kind: "image",
              version: attempts > 1 ? 2 : 1,
            },
          ],
        },
      });
    if (path !== "/api/profiles/editable/owned") return route.fallback();
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      requests.push(body);
      if (++attempts === 1) {
        document.studio.name = "Changed by Another Editor";
        return route.fulfill({
          status: 409,
          json: { error: "This profile changed while you were editing." },
        });
      }
      document = JSON.parse(body.text);
    }
    return route.fulfill({
      json: {
        id: "owned",
        text: JSON.stringify(document),
        hash: attempts ? "latest-hash" : "opened-hash",
        blockName: "studio",
        version: { version: attempts > 1 ? 2 : 1 },
      },
    });
  });
  const editor = await editDefinition(page, "Model");
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("My Edited Profile");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("changed while you were editing");
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "My Edited Profile",
  );
  expect(JSON.parse(requests[0].text)).toEqual({
    ...original,
    studio: { ...original.studio, name: "My Edited Profile" },
  });
  expect(requests[0].baseHash).toBe("opened-hash");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toBeHidden();
  await editDefinition(page, "Model");
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Changed by Another Editor",
  );
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("My Edited Profile");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(requests[1].baseHash).toBe("latest-hash");
  await editDefinition(page, "Model");
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "My Edited Profile",
  );
  expect(document.graph).toEqual(original.graph);
  expect(document.extra).toEqual(original.extra);
  expect(document.studio.customMetadata).toEqual(original.studio.customMetadata);
});

test("Guide editing and restoring an earlier version create distinct saved revisions", async ({
  page,
}) => {
  await fixtures(page);
  const original = {
    name: "Owned Guide",
    summary: "Original guidance.",
    rules: ["Preserve the subject."],
    customPolicy: { retained: true },
  };
  let pack = structuredClone(original),
    version = 1;
  await page.route("**/api/profiles/editable", (route) =>
    route.fulfill({
      json: {
        profiles: [
          { id: "fox", name: "Fox Quality", family: "test", kind: "image", version: 1 },
          { id: "owl", name: "Owl Fast", family: "test", kind: "image", version: 1 },
        ],
      },
    }),
  );
  await page.route("**/api/profiles/guide-bindings", (route) =>
    route.fulfill({
      json: { bindings: { profiles: {}, families: { test: { image: "owned" } } } },
    }),
  );
  const saved: (typeof original)[] = [structuredClone(original)];
  const removals: unknown[] = [];
  await page.route("**/api/profiles/guides**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/profiles/guides")
      return route.fulfill({ json: { packs: [{ packId: "owned", name: pack.name, version }] } });
    if (path.endsWith("/versions"))
      return route.fulfill({
        json: {
          versions: saved
            .map((_, i) => ({ version: i + 1, origin: "studio", savedBy: "Administrator" }))
            .reverse(),
        },
      });
    if (/\/versions\/\d+$/.test(path))
      return route.fulfill({
        json: { version: { pack: saved[Number(path.split("/").at(-1)) - 1] } },
      });
    if (path.endsWith("/remove")) {
      removals.push(route.request().postDataJSON());
      return route.fulfill({
        status: 409,
        json: { ok: false, error: "This guide is still used by custom:fixture." },
      });
    }
    if (path.endsWith("/revert")) {
      const body = route.request().postDataJSON();
      expect(body.baseHash).toBe(`hash-${version}`);
      pack = structuredClone(saved[body.version - 1]);
      saved.push(structuredClone(pack));
      version++;
    } else if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      expect(body.baseHash).toBe(`hash-${version}`);
      pack = body.pack;
      saved.push(structuredClone(pack));
      version++;
    }
    return route.fulfill({
      json: { packId: "owned", pack, hash: `hash-${version}`, meta: { version, origin: "studio" } },
    });
  });
  const editor = await editDefinition(page, "Guide");
  await editor.getByRole("textbox", { name: "Summary", exact: true }).fill("Updated guidance.");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(saved[1]).toEqual({ ...original, summary: "Updated guidance." });
  // Library › Guides lists a guide by its name.
  await expect(page.getByRole("table", { name: "Editable Guides", exact: true })).toContainText(
    "Owned Guide",
  );
  // Its profile count reveals their names.
  const usedBy = page.getByRole("button", { name: "2 Models", exact: true });
  await usedBy.click();
  await expect(
    page.getByRole("dialog", { name: "Models Using Owned Guide", exact: true }),
  ).toContainText("Fox QualityOwl Fast");
  // Escape from the count closes only the popover.
  await usedBy.press("Escape");
  await expect(page.getByRole("dialog", { name: "Models Using Owned Guide" })).toBeHidden();
  await expect(page.getByRole("table", { name: "Editable Guides", exact: true })).toBeVisible();
  await editDefinition(page, "Guide");
  await expect(editor.getByRole("textbox", { name: "Summary", exact: true })).toHaveValue(
    "Updated guidance.",
  );
  await editor.getByRole("button", { name: "Close Definition Editor", exact: true }).click();
  await expect(editor).toBeHidden();
  // Versions… lists its saved versions; Restore… opens the editor on one as an unsaved change.
  const rowAction = async (name: string) => {
    await page.getByRole("button", { name: "Actions for Owned Guide", exact: true }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  await rowAction("Versions…");
  const versions = page.getByRole("dialog", { name: "Owned Guide Versions", exact: true });
  await expect(versions.getByRole("table", { name: "Versions", exact: true })).toContainText(
    "Administrator",
  );
  await versions.getByRole("button", { name: "Actions for Version 1", exact: true }).click();
  await page.getByRole("menuitem", { name: "Restore…", exact: true }).click();
  await expect(versions).toBeHidden();
  await expect(editor.getByRole("textbox", { name: "Summary", exact: true })).toHaveValue(
    "Original guidance.",
  );
  expect(saved).toHaveLength(2);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(saved).toEqual([original, { ...original, summary: "Updated guidance." }, original]);
  // A guide that profiles still use stays, and the confirmation says why; the row menu deletes
  // over the hash it reads first.
  await rowAction("Delete");
  const confirm = page.getByRole("dialog", { name: "Delete Guide", exact: true });
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).toContainText("This guide is still used by custom:fixture.");
  expect(removals).toEqual([{ baseHash: "hash-3" }]);
});

test("Model classification saves and reads back while definition administration stays restricted", async ({
  page,
}) => {
  await fixtures(page);
  let administrator = true;
  const item = {
    key: "checkpoints/base.safetensors",
    title: "Base Model",
    installed: true,
    kind: "checkpoint",
    folder: "checkpoints",
    families: ["flux2"],
    modelType: "",
  };
  const writes: unknown[] = [];
  await signIn(page, { id: "account-a", role: "administrator" });
  await page.route("**/api/library/items", (route) =>
    administrator
      ? route.fulfill({ json: { items: [item] } })
      : route.fulfill({
          status: 403,
          json: { error: "This action is restricted to administrators." },
        }),
  );
  await page.route("**/api/library/catalogue", async (route) => {
    const body = route.request().postDataJSON();
    writes.push(body);
    Object.assign(item, body.patch);
    await route.fulfill({ json: { ok: true, key: item.key, entry: item } });
  });
  await page.goto("/images");
  await openNav(page, "Library");
  await section(page, "Library", "Files");
  const edit = async () => {
    await page.getByRole("button", { name: "Actions for base.safetensors", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  };
  await edit();
  const editor = page.getByRole("dialog", { name: "Edit Base Model", exact: true });
  await editor.getByRole("combobox", { name: "Model Type", exact: true }).click();
  await page.getByRole("option", { name: "Original", exact: true }).click();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(writes).toEqual([{ key: item.key, patch: { modelType: "original" } }]);
  await edit();
  await expect(editor.getByRole("combobox", { name: "Model Type", exact: true })).toHaveValue(
    "Original",
  );
  administrator = false;
  // Without Characters an ordinary account's Library holds only its Presets (characters.spec.ts
  // covers the cards a member gets with it).
  await signIn(page, { id: "account-a", role: "user", features: { characters: false } });
  await serveProfiles(page, profiles);
  await page.goto("/library#presets");
  // A hash-only navigation keeps the previous account in memory; load the new one's grants.
  await page.reload();
  await expect(page.getByText("No Presets", { exact: true })).toBeVisible();
  await page.goto("/library#files");
  await expect(page.getByRole("table", { name: "Library Files", exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(1);
});

test("A combined profile's Backend select is a saved edit that switches what the editor shows", async ({
  page,
}) => {
  await fixtures(page);
  const document = {
    studio: {
      id: "krea",
      name: "Krea 2 Turbo · Fast",
      kind: "image",
      family: "krea2",
      backend: "radiance",
      backends: {
        comfyui: {
          description: "ComfyUI graph.",
          controls: { prompt: { node: "1", input: "text" } },
          graph: { 1: { class_type: "CLIPTextEncode", inputs: { text: "" } } },
        },
        radiance: {
          description: "Radiance runtime.",
          controls: { prompt: { node: "1", input: "prompt" } },
          graph: { 1: { class_type: "RadianceImageGenerate", inputs: { prompt: "" } } },
        },
      },
    },
  };
  const saved: { text: string; baseHash: string }[] = [];
  await page.route("**/api/profiles/editable**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/profiles/editable")
      return route.fulfill({
        json: {
          profiles: [
            {
              id: "krea",
              name: document.studio.name,
              family: "krea2",
              kind: "image",
              version: 1,
              backend: "radiance",
            },
          ],
        },
      });
    if (path !== "/api/profiles/editable/krea") return route.fallback();
    if (route.request().method() === "PUT") saved.push(route.request().postDataJSON());
    return route.fulfill({
      json: { id: "krea", text: JSON.stringify(document), hash: "opened", version: { version: 1 } },
    });
  });
  await page.goto("/images");
  await openNav(page, "Library");
  await section(page, "Library", "Models");
  const table = page.getByRole("table", { name: "Editable Models", exact: true });
  await expect(table).toContainText("Krea 2 Turbo · Fast");
  const editor = await editDefinition(page, "Model");
  const description = editor.getByRole("textbox", { name: "Description", exact: true });
  await expect(description).toHaveValue("Radiance runtime.");
  await editor.getByRole("combobox", { name: "Backend", exact: true }).click();
  await page.getByRole("option", { name: "ComfyUI", exact: true }).click();
  await expect(description).toHaveValue("ComfyUI graph.");
  await description.fill("ComfyUI graph, edited.");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  const studio = JSON.parse(saved[0].text).studio;
  expect(saved[0].baseHash).toBe("opened");
  expect(studio.backend).toBe("comfyui");
  expect(studio.backends.comfyui.description).toBe("ComfyUI graph, edited.");
  expect(studio.backends.radiance).toEqual(document.studio.backends.radiance);
  expect(studio.description).toBeUndefined();
});

test("The Profiles toolbar gives Download All its own link beside Import", async ({ page }) => {
  await fixtures(page);
  // Two families, so the Family filter has something to narrow.
  await page.route("**/api/profiles/editable", (route) =>
    route.fulfill({
      json: {
        profiles: [
          { id: "one", name: "One", kind: "image", family: "sdxl", version: 1 },
          { id: "two", name: "Two", kind: "image", family: "flux2", version: 1 },
        ],
      },
    }),
  );
  await page.goto("/images");
  await openNav(page, "Library");
  await section(page, "Library", "Models");
  const toolbar = page
    .getByRole("button", { name: "Filter Models", exact: true })
    .locator("xpath=..");
  const search = toolbar.getByRole("textbox", { name: "Search Models", exact: true });
  const filter = toolbar.getByRole("button", { name: "Filter Models", exact: true });
  const download = toolbar.getByRole("link", { name: "Download All", exact: true });
  const importing = toolbar.getByRole("button", { name: "Import", exact: true });
  const controls = search.or(filter).or(download).or(importing);
  await expect(controls).toHaveCount(4);
  await expect(controls.nth(0)).toHaveAccessibleName("Search Models");
  await expect(controls.nth(1)).toHaveAccessibleName("Filter Models");
  await expect(controls.nth(2)).toHaveAccessibleName("Download All");
  await expect(controls.nth(3)).toHaveAccessibleName("Import");
  await expect(download).toHaveAttribute("href", "/api/profiles/export");
  await expect(download).toHaveAttribute("download", "");
});

test("Import opens a workflow, and a row's Duplicate copies its profile under a new ID", async ({
  page,
}) => {
  await fixtures(page);
  const original = {
    studio: { id: "owned", name: "Owned Profile", kind: "image", family: "flux2" },
    graph: { 1: { class_type: "CLIPTextEncode", inputs: { text: "" } } },
  };
  const created: { workflow: unknown; metadata: unknown }[] = [];
  await page.route("**/api/profiles/editable**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/profiles/editable")
      return route.fulfill({
        json: { profiles: [{ id: "owned", name: "Owned Profile", kind: "image", version: 1 }] },
      });
    return route.fulfill({ json: { id: "owned", text: JSON.stringify(original), hash: "h" } });
  });
  await page.route("**/api/workflows/import/preview", (route) =>
    route.fulfill({
      json: { preview: { graph: original.graph, detected: { kind: "image" } } },
    }),
  );
  await page.route("**/api/workflows/import", (route) => {
    created.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, workflow: { id: "owned-copy" } } });
  });
  await page.goto("/images");
  await openNav(page, "Library");
  await section(page, "Library", "Models");
  const editor = page.getByRole("dialog", { name: "New Model", exact: true });
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("region", { name: "Library: Models", exact: true })
    .getByRole("button", { name: "Import", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "workflow.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ prompt: original.graph })),
  });
  await expect(editor.getByRole("textbox", { name: "Definition ID", exact: true })).toHaveValue("");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByRole("button", { name: "Actions for Owned Profile", exact: true }).click();
  await page.getByRole("menuitem", { name: "Duplicate…", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Definition ID", exact: true })).toHaveValue(
    "owned-copy",
  );
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Owned Profile Copy",
  );
  await editor.getByRole("button", { name: "Create", exact: true }).click();
  await expect(editor).toBeHidden();
  const studio = { ...original.studio, id: "owned-copy", name: "Owned Profile Copy" };
  expect(created).toEqual([{ workflow: { ...original, studio }, metadata: studio }]);
});

test("Each profile and guide downloads as its own JSON file from its row menu", async ({
  page,
}) => {
  await fixtures(page);
  await page.route("**/api/profiles/editable", (route) =>
    route.fulfill({
      json: { profiles: [{ id: "owned", name: "Owned Profile", kind: "image", version: 1 }] },
    }),
  );
  await page.route("**/api/profiles/guides", (route) =>
    route.fulfill({ json: { packs: [{ packId: "krea2", name: "Krea 2", version: 1 }] } }),
  );
  await page.route("**/download", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2);
    return route.fulfill({
      contentType: "application/json",
      headers: { "Content-Disposition": `attachment; filename="${id}.json"` },
      body: "{}\n",
    });
  });
  await page.goto("/images");
  await openNav(page, "Library");
  await section(page, "Library", "Models");
  for (const [part, row, item, file] of [
    ["Models", "Owned Profile", "Download", "owned.json"],
    ["Guides", "Krea 2", "Download", "krea2.json"],
  ]) {
    await section(page, "Library", part);
    await page.getByRole("button", { name: `Actions for ${row}`, exact: true }).click();
    const menu = page.getByRole("menu", { name: `Actions for ${row}`, exact: true });
    const entries =
      part === "Models"
        ? ["Edit", "Versions…", "Copy ID", "Download", "Duplicate…", "Delete"]
        : ["Edit", "Versions…", "Copy ID", "Download", "Delete"];
    await expect(menu.getByRole("menuitem")).toHaveText(entries);
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: item, exact: true }).click();
    expect((await download).suggestedFilename()).toBe(file);
  }
});

test("Each Templates page lists its menu's templates by enabled and name, and edits them", async ({
  page,
}) => {
  await fixtures(page);
  const style = (id: string, kind: string, label: string, extra = {}) => ({
    id,
    kind,
    label,
    description: `${label} line.`,
    instruction: `${label}: do it.`,
    enabled: true,
    ...extra,
  });
  let styles = [
    style("candid", "improve", "Candid"),
    style("uncensored", "improve", "Bold", { uncensored: true }),
    style("cinematic", "animate", "Cinematic Camera"),
  ];
  let hash = "h1";
  const saves: any[] = [];
  await page.route("**/api/profiles/prompt-styles", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      saves.push(body);
      if (body.baseHash !== hash)
        return route.fulfill({ status: 409, json: { ok: false, error: "Stale." } });
      styles = body.styles;
      hash = `h${saves.length + 1}`;
    }
    return route.fulfill({ json: { ok: true, styles, hash, meta: { version: saves.length } } });
  });
  await page.goto("/images");
  await openNav(page, "Library");
  await section(page, "Library", "Improve Prompt");
  const table = page.getByRole("table", { name: "Improve Prompt Templates", exact: true });
  const names = table.getByRole("button", { name: /^Edit / });
  await expect(names).toHaveText(["Bold", "Candid"]);
  await expect(table.getByText("Cinematic Camera", { exact: true })).toBeHidden();
  // A switch applies at once, over the list's hash. Its track takes the pointer, as it has no
  // visible label, so the click goes to the switch directly.
  await table.getByRole("switch", { name: "Enable Candid", exact: true }).dispatchEvent("click");
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].baseHash).toBe("h1");
  expect(saves[0].styles[0]).toMatchObject({ id: "candid", enabled: false });
  await expect(table.getByRole("switch", { name: "Enable Candid", exact: true })).not.toBeChecked();

  await section(page, "Library", "Animate");
  const animate = page.getByRole("table", { name: "Animate Templates", exact: true });
  await page.getByRole("button", { name: "New Template", exact: true }).click();
  const creating = page.getByRole("dialog", { name: "New Template", exact: true });
  await creating.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "New Template", exact: true })).toBeFocused();
  // Editing keeps the template's ID and kind and saves in a dialog.
  await animate.getByRole("button", { name: "Actions for Cinematic Camera", exact: true }).click();
  await page
    .getByRole("menu", { name: "Actions for Cinematic Camera", exact: true })
    .getByRole("menuitem", { name: "Edit", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit Template", exact: true });
  await dialog.getByRole("textbox", { name: "Brief", exact: true }).fill("A moving camera.");
  await dialog.getByRole("checkbox", { name: "Modifier", exact: true }).check();
  await dialog
    .getByRole("radiogroup", { name: "Offered To", exact: true })
    .getByText("Uncensored Only", { exact: true })
    .click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(saves.at(-1).styles[2]).toMatchObject({
    id: "cinematic",
    kind: "animate",
    description: "A moving camera.",
    modifier: true,
    uncensored: true,
  });
  await expect(animate.getByText("A moving camera.")).toBeVisible();
});

test("Library edits a background prompt and reads the saved version back", async ({ page }) => {
  await fixtures(page);
  const initial = "Summarise the recurring subjects in {{request}}.";
  let instruction = {
    id: "summarise-taste",
    label: "Summarise Taste",
    area: "Dream",
    usedBy: "the Taste summary",
    text: initial,
    initial,
    hash: "current",
    version: null as number | null,
  };
  await page.route("**/api/profiles/prompt-instructions", (route) =>
    route.fulfill({
      json: { instructions: [instruction], examples: { request: "make it night" } },
    }),
  );
  await page.route("**/api/profiles/prompt-instructions/summarise-taste", (route) => {
    const { text, baseHash } = route.request().postDataJSON();
    expect(baseHash).toBe(instruction.hash);
    instruction = { ...instruction, text, version: 2, hash: "version-2" };
    return route.fulfill({ json: instruction });
  });
  await page.route("**/api/profiles/prompt-instructions/summarise-taste/history", (route) =>
    route.fulfill({
      json: {
        versions: [
          { version: 2, text: instruction.text, savedBy: "Administrator" },
          { version: 1, text: initial, savedBy: "Administrator" },
        ],
      },
    }),
  );
  await page.goto("/images");
  await openNav(page, "Library");
  await section(page, "Library", "Dream");
  const table = page.getByRole("table", { name: "Dream Instructions", exact: true });
  // Each instruction says where Studio uses it.
  await expect(table.getByText("Used by the Taste summary", { exact: true })).toBeVisible();
  const open = async () => {
    await table.getByRole("button", { name: "Actions for Summarise Taste", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    return page.getByRole("dialog", { name: "Summarise Taste", exact: true });
  };
  const editor = await open();
  const text = editor.getByRole("textbox", { name: "Instruction", exact: true });
  await expect(text).toHaveValue(initial);
  const changed = "Summarise recurring subjects and lighting in {{request}}.";
  const legend = editor.getByRole("region", { name: "Prompt Variables", exact: true });
  await expect(legend.getByText("{{request}}", { exact: true })).toBeVisible();
  await expect(legend.getByText("Missing", { exact: true })).toBeHidden();
  await text.fill(changed);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  await open();
  await expect(text).toHaveValue(changed);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  // Versions… restores a saved version into the editor as an unsaved change.
  await table.getByRole("button", { name: "Actions for Summarise Taste", exact: true }).click();
  await page.getByRole("menuitem", { name: "Versions…", exact: true }).click();
  const versions = page.getByRole("dialog", { name: "Summarise Taste Versions", exact: true });
  await versions.getByRole("button", { name: "Actions for Version 1", exact: true }).click();
  await page.getByRole("menuitem", { name: "Restore…", exact: true }).click();
  await expect(versions).toBeHidden();
  await expect(text).toHaveValue(initial);
  await editor.getByRole("tab", { name: "Preview", exact: true }).click();
  // Preview fills each variable with what Studio puts there, naming it on hover.
  const preview = editor.getByLabel("Highlighted Instruction");
  await expect(preview).toHaveText("Summarise the recurring subjects in make it night.");
  await expect(preview.getByTitle("{{request}}")).toHaveText("make it night");
  await expect(legend.getByText("{{request}}", { exact: true })).toBeVisible();
  await editor.getByRole("tab", { name: "Edit", exact: true }).click();
  await expect(text).toHaveValue(initial);
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
});
