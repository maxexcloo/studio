import { expect, test } from "@playwright/test";
import { fixtures, openNav, profiles, section } from "./fixtures";

test("Profile edits preserve workflow metadata and retain unsaved text after a conflict", async ({
  page,
}) => {
  await fixtures(page);
  const original = {
    heissUi: {
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
              name: document.heissUi.name,
              family: "flux2",
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
        document.heissUi.name = "Changed by Another Editor";
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
        blockName: "heissUi",
        version: { version: attempts > 1 ? 2 : 1 },
      },
    });
  });
  await page.goto("/images");
  await openNav(page, "Library");
  await section(page, "Library", "Profiles");
  await page.getByRole("button", { name: "Edit Profile", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Profile", exact: true });
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("My Edited Profile");
  await editor.getByRole("button", { name: "Save Profile", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("changed while you were editing");
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "My Edited Profile",
  );
  expect(JSON.parse(requests[0].text)).toEqual({
    ...original,
    heissUi: { ...original.heissUi, name: "My Edited Profile" },
  });
  expect(requests[0].baseHash).toBe("opened-hash");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByRole("button", { name: "Edit Profile", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Changed by Another Editor",
  );
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("My Edited Profile");
  await editor.getByRole("button", { name: "Save Profile", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(requests[1].baseHash).toBe("latest-hash");
  await page.getByRole("button", { name: "Edit Profile", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "My Edited Profile",
  );
  expect(document.graph).toEqual(original.graph);
  expect(document.extra).toEqual(original.extra);
  expect(document.heissUi.customMetadata).toEqual(original.heissUi.customMetadata);
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
  const saved: (typeof original)[] = [structuredClone(original)];
  await page.route("**/api/profiles/guides**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/profiles/guides")
      return route.fulfill({ json: { packs: [{ packId: "owned", name: pack.name, version }] } });
    if (path.endsWith("/versions"))
      return route.fulfill({
        json: {
          versions: saved
            .map((_, i) => ({ version: i + 1, origin: "studio", by: "Administrator" }))
            .reverse(),
        },
      });
    if (/\/versions\/\d+$/.test(path))
      return route.fulfill({
        json: { version: { pack: saved[Number(path.split("/").at(-1)) - 1] } },
      });
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
  await page.goto("/images");
  await openNav(page, "Library");
  await section(page, "Library", "Guides");
  await page.getByRole("button", { name: "Edit Guide", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Guide", exact: true });
  await editor.getByRole("textbox", { name: "Summary", exact: true }).fill("Updated guidance.");
  await editor.getByRole("button", { name: "Save Guide", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(saved[1]).toEqual({ ...original, summary: "Updated guidance." });
  await page.getByRole("button", { name: "Edit Guide", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Summary", exact: true })).toHaveValue(
    "Updated guidance.",
  );
  await editor.getByRole("tab", { name: "Versions", exact: true }).click();
  await editor
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: "Restore Version 1", exact: true }) })
    .getByRole("button", { name: "View", exact: true })
    .click();
  await expect(editor.getByRole("textbox", { name: "Saved Definition", exact: true })).toHaveValue(
    /Original guidance\./,
  );
  await editor.getByRole("button", { name: "Restore Version 1", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(saved).toEqual([original, { ...original, summary: "Updated guidance." }, original]);
  await page.getByRole("button", { name: "Edit Guide", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Summary", exact: true })).toHaveValue(
    "Original guidance.",
  );
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
  await page.route("**/api/accounts/status", (route) =>
    route.fulfill({
      json: {
        mode: "multi-user",
        signedIn: true,
        account: { id: "account-a", role: administrator ? "administrator" : "user" },
      },
    }),
  );
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
  await section(page, "Library", "Models");
  await page.getByRole("button", { name: "Edit Catalogue", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Catalogue", exact: true });
  await editor.getByRole("combobox", { name: "Catalogue Resource", exact: true }).click();
  await page.getByRole("option", { name: "Base Model", exact: true }).click();
  await editor.getByRole("combobox", { name: "Model Type", exact: true }).click();
  await page.getByRole("option", { name: "Original", exact: true }).click();
  await editor.getByRole("button", { name: "Save Catalogue Entry", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(writes).toEqual([{ key: item.key, patch: { modelType: "original" } }]);
  await page.getByRole("button", { name: "Edit Catalogue", exact: true }).click();
  await editor.getByRole("combobox", { name: "Catalogue Resource", exact: true }).click();
  await page.getByRole("option", { name: "Base Model", exact: true }).click();
  await expect(editor.getByRole("combobox", { name: "Model Type", exact: true })).toHaveValue(
    "Original",
  );
  administrator = false;
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: { profiles, features: { library: false, presets: false } } }),
  );
  await page.goto("/library");
  await expect(page).toHaveURL(/\/images$/);
  const options = page.getByRole("button", { name: "More Options", exact: true });
  if (await options.isVisible()) await options.click();
  await expect(
    page
      .getByRole("link", { name: "Library", exact: true })
      .or(page.getByRole("menuitem", { name: "Library", exact: true })),
  ).toHaveCount(0);
  expect(writes).toHaveLength(1);
});
