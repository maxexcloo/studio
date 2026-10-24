import { expect, test, type Page } from "@playwright/test";
import { editDefinition, fixtures } from "./fixtures";

function profile() {
  return {
    heissUi: {
      id: "connections",
      name: "Connected Profile",
      kind: "image",
      family: "custom",
      controls: {
        prompt: { node: "text.one", input: "text.source", extra: { retained: true } },
        cfg: { node: "missing.sampler", input: "cfg.source", custom: "keep" },
        startImage: { node: "image.legacy", input: "image", legacyMetadata: true },
      },
      mediaInputs: [
        {
          id: "start.slot",
          label: "Start Image",
          kind: "image",
          role: "start",
          required: true,
          min: 1,
          max: 1,
          control: { node: "image.one", input: "image.source", encoding: "preserved" },
          custom: { keep: 1 },
        },
        {
          id: "end.slot",
          label: "End Image",
          kind: "image",
          role: "end",
          follows: "start.slot",
          required: false,
          min: 0,
          max: 1,
          control: { node: "image.two", input: "image.target" },
          unknownSlotField: [1, 2],
        },
      ],
      defaults: { steps: 8 },
      customMetadata: { arbitrary: ["keep", { value: 42 }] },
    },
    graph: {
      "text.one": {
        class_type: "CLIPTextEncode",
        _meta: { title: "Source Encoder" },
        inputs: { "text.source": "original" },
      },
      "text.two": {
        class_type: "CLIPTextEncode",
        _meta: { title: "Target Encoder" },
        inputs: { "text.target": "saved" },
      },
      "sampler.real": { class_type: "KSampler", inputs: { "cfg.source": 3, steps: 8 } },
      "image.one": { class_type: "LoadImage", inputs: { "image.source": "first.png" } },
      "image.two": { class_type: "LoadImage", inputs: { "image.target": "second.png" } },
      "image.legacy": { class_type: "LoadImage", inputs: { image: "legacy.png" } },
    },
    extra: { preserved: ["outside", "metadata"] },
  };
}
async function setup(page: Page, { failPreview = false, conflict = false } = {}) {
  await fixtures(page);
  const state = {
    document: profile(),
    previews: 0,
    writes: [] as { text: string; baseHash: string }[],
  };
  await page.route("**/api/profiles/editable**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/profiles/editable")
      return route.fulfill({
        json: { profiles: [{ id: "connections", name: state.document.heissUi.name, version: 1 }] },
      });
    if (path !== "/api/profiles/editable/connections") return route.fallback();
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      state.writes.push(body);
      if (conflict)
        return route.fulfill({
          status: 409,
          json: { error: "This profile changed while you were editing." },
        });
      state.document = JSON.parse(body.text);
    }
    return route.fulfill({
      json: {
        id: "connections",
        text: JSON.stringify(state.document),
        hash: "opened-hash",
        blockName: "heissUi",
        version: { version: 1 },
      },
    });
  });
  await page.route("**/api/workflows/import/preview", (route) => {
    state.previews++;
    if (failPreview && state.previews === 1)
      return route.fulfill({
        status: 503,
        json: { error: "Workflow inspection is temporarily unavailable." },
      });
    const body = route.request().postDataJSON();
    const nodes = Object.entries(body.workflow.graph).map(([id, value]) => {
      const node = value as {
        class_type: string;
        _meta?: { title: string };
        inputs: Record<string, unknown>;
      };
      return {
        id,
        classType: node.class_type,
        title: node._meta?.title,
        inputs: Object.keys(node.inputs),
      };
    });
    return route.fulfill({
      json: {
        preview: {
          graph: { never: "adopt inferred graph" },
          detected: { controls: { never: "adopt guesses" }, nodes },
        },
      },
    });
  });
  const editor = await editDefinition(page, "Profile");
  await editor.getByRole("tab", { name: "Connections", exact: true }).click();
  return { state, editor };
}

test("Workflow connections preserve dotted IDs, unknown metadata and reference slot relationships", async ({
  page,
}) => {
  const original = profile();
  const { state, editor } = await setup(page);
  await expect(editor.getByRole("combobox", { name: "Control cfg Node", exact: true })).toHaveValue(
    "missing.sampler · Missing Node",
  );
  const legacy = editor.getByRole("combobox", { name: "Control startImage Node", exact: true });
  await expect(legacy).toBeDisabled();
  await expect(legacy).toHaveValue("LoadImage #image.legacy");
  await editor.getByRole("combobox", { name: "Control prompt Node", exact: true }).click();
  await page.getByRole("option", { name: "Target Encoder #text.two", exact: true }).click();
  await expect(
    editor.getByRole("combobox", { name: "Control prompt Input", exact: true }),
  ).toHaveValue("text.source · Missing Input");
  await editor.getByRole("combobox", { name: "Control prompt Input", exact: true }).click();
  await page.getByRole("option", { name: "text.target", exact: true }).click();
  await editor.getByRole("combobox", { name: "Control cfg Node", exact: true }).click();
  await page.getByRole("option", { name: "KSampler #sampler.real", exact: true }).click();
  await editor.getByRole("combobox", { name: "Reference start.slot Node", exact: true }).click();
  await page.getByRole("option", { name: "LoadImage #image.two", exact: true }).click();
  await editor.getByRole("combobox", { name: "Reference start.slot Input", exact: true }).click();
  await page.getByRole("option", { name: "image.target", exact: true }).click();
  await editor.getByRole("button", { name: "Save Profile", exact: true }).click();
  await expect(editor).toBeHidden();
  const expected = structuredClone(original);
  expected.heissUi.controls.prompt.node = "text.two";
  expected.heissUi.controls.prompt.input = "text.target";
  expected.heissUi.controls.cfg.node = "sampler.real";
  expected.heissUi.mediaInputs[0].control.node = "image.two";
  expected.heissUi.mediaInputs[0].control.input = "image.target";
  expect(state.document).toEqual(expected);
  expect(state.writes[0].baseHash).toBe("opened-hash");
  expect(state.previews).toBe(1);
  await editDefinition(page, "Profile");
  await editor.getByRole("tab", { name: "Connections", exact: true }).click();
  await expect(
    editor.getByRole("combobox", { name: "Control prompt Node", exact: true }),
  ).toHaveValue("Target Encoder #text.two");
  await editor.getByRole("tab", { name: "Advanced JSON", exact: true }).click();
  const changed = {
    ...expected,
    graph: {
      ...expected.graph,
      "text.two": {
        ...expected.graph["text.two"],
        inputs: {
          ...expected.graph["text.two"].inputs,
          "new.input.with.dots": "manual graph edit",
        },
      },
    },
  };
  await editor
    .getByRole("textbox", { name: "Profile JSON", exact: true })
    .fill(JSON.stringify(changed));
  await editor.getByRole("tab", { name: "Connections", exact: true }).click();
  await editor.getByRole("combobox", { name: "Control prompt Input", exact: true }).click();
  await page.getByRole("option", { name: "new.input.with.dots", exact: true }).click();
  await editor.getByRole("button", { name: "Save Profile", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(state.document).toEqual({
    ...changed,
    heissUi: {
      ...changed.heissUi,
      controls: {
        ...changed.heissUi.controls,
        prompt: { ...changed.heissUi.controls.prompt, input: "new.input.with.dots" },
      },
    },
  });
});

test("Workflow inspection retry and save conflicts retain the edited connection draft", async ({
  page,
}) => {
  const { state, editor } = await setup(page, { failPreview: true, conflict: true });
  await expect(editor.getByRole("alert")).toContainText(
    "Workflow inspection is temporarily unavailable",
  );
  const prompt = editor.getByRole("combobox", { name: "Control prompt Node", exact: true });
  await expect(prompt).toBeDisabled();
  await expect(prompt).toHaveValue("text.one");
  await editor.getByRole("button", { name: "Retry Connections", exact: true }).click();
  await expect(prompt).toBeEnabled();
  await prompt.click();
  await page.getByRole("option", { name: "Target Encoder #text.two", exact: true }).click();
  await editor.getByRole("combobox", { name: "Control prompt Input", exact: true }).click();
  await page.getByRole("option", { name: "text.target", exact: true }).click();
  await editor.getByRole("button", { name: "Save Profile", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("changed while you were editing");
  await expect(prompt).toHaveValue("Target Encoder #text.two");
  await expect(
    editor.getByRole("combobox", { name: "Control prompt Input", exact: true }),
  ).toHaveValue("text.target");
  const attempted = JSON.parse(state.writes[0].text);
  expect(attempted.graph).toEqual(profile().graph);
  expect(attempted.heissUi.mediaInputs).toEqual(profile().heissUi.mediaInputs);
  expect(attempted.heissUi.controls.prompt).toEqual({
    ...profile().heissUi.controls.prompt,
    node: "text.two",
    input: "text.target",
  });
  expect(state.document).toEqual(profile());
});
