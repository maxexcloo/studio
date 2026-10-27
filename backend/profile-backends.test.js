import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-profile-backends-"));
process.env.STUDIO_DATA_DIR = temporary;
process.env.STUDIO_WORKERS = JSON.stringify([
  { id: "primary", url: "http://127.0.0.1:9", capabilities: ["image", "video", "models"] },
  { id: "second", url: "http://127.0.0.1:10", capabilities: ["image"] },
]);
const { backendCandidates, combineBackends } = await import("./profile-backends.js");
const { canonicalProfileId, guideStore, profileAliasBackend, profileStore } =
  await import("./profile-store.js");
const { getCustomWorkflow, metadataFromJson, userWorkflowsDir } =
  await import("./custom-workflows.js");
const { inferModels } = await import("./models.js");
const { mergeWorkerModels, noteWorkerProfiles, routeJob } = await import("./comfy-backends.js");
const { readEditableProfile, saveEditableProfile, validateProfileText } =
  await import("./profile-editor.js");
const { generationSettings } = await import("./gallery-store.js");
const { timingKey } = await import("./generation-timing.js");
const { generationEstimate, recordGeneration } = await import("./timings.js");
const { profileStats } = await import("./stats.js");
const { matchesGalleryFilters } = await import("./gallery-filters.js");
const { effectiveAccountAccess, mayUseGenerationProfile } = await import("./account-policy.js");
const { findProfile } = await import("./mcp-tiers.js");
const { buildExport } = await import("./profile-export.js");
const { loadWorkflowPreferences, saveWorkflowPreferences } = await import("./workflow-catalog.js");
const { McpMedia } = await import("./mcp-media.js");
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

const radianceBlock = {
  controls: { prompt: { node: "1", input: "prompt" }, steps: { node: "1", input: "steps" } },
  defaults: { steps: 8, width: 1536, height: 1536 },
  mediaInputs: [],
  description: "Radiance runtime.",
};
const radianceGraph = {
  1: { class_type: "RadianceImageGenerate", inputs: { prompt: "", steps: 8 } },
  2: { class_type: "SaveImage", inputs: { images: ["1", 0] } },
};
const comfyBlock = {
  controls: {
    prompt: { node: "2", input: "text" },
    startImage: { node: "3", input: "image" },
  },
  defaults: { steps: 8, width: 2048, height: 2048 },
  description: "ComfyUI graph.",
};
const comfyGraph = {
  1: { class_type: "UNETLoader", inputs: { unet_name: "krea2.safetensors" } },
  2: { class_type: "CLIPTextEncode", inputs: { text: "" } },
  3: { class_type: "LoadImage", inputs: { image: "" } },
  4: { class_type: "SaveImage", inputs: { images: ["2", 0] } },
};
const single = (id, name, block, graph) =>
  `${JSON.stringify({ studio: { id, name, kind: "image", family: "krea2", ...block }, graph }, null, 2)}\n`;
const write = (id, text) => fs.writeFileSync(path.join(userWorkflowsDir, `${id}.json`), text);
const radianceId = "image-krea2-turbo-radiance";
const comfyId = "image-krea2-turbo-comfyui";
const combinedId = "image-krea2-turbo";
const comfyNodes = {
  ...Object.fromEntries(
    ["KSampler", "CLIPTextEncode", "VAEDecode", "LoadImage", "SaveImage"].map((name) => [
      name,
      { input: { required: {} } },
    ]),
  ),
  UNETLoader: { input: { required: { unet_name: [["krea2.safetensors"]] } } },
};
const allNodes = { ...comfyNodes, RadianceImageGenerate: { input: { required: {} } } };

fs.mkdirSync(userWorkflowsDir, { recursive: true });
write(
  radianceId,
  single(radianceId, "Krea 2 Turbo · Radiance · Fast · 8 Steps", radianceBlock, radianceGraph),
);
write(
  comfyId,
  single(comfyId, "Krea 2 Turbo · ComfyUI · Fast · 8 Steps · 1 Reference", comfyBlock, comfyGraph),
);
// A Radiance-only model: no pair.
write(
  "image-noctq-v4-radiance",
  single("image-noctq-v4-radiance", "Noct Q V4 · Radiance", radianceBlock, radianceGraph),
);
fs.mkdirSync(path.join(temporary, "guides"), { recursive: true });
fs.writeFileSync(
  path.join(temporary, "guides", "prompting.json"),
  JSON.stringify({
    packs: { krea2: { summary: "Krea." } },
    meta: {},
    families: {},
    profiles: { [`custom:${comfyId}`]: { pack: "krea2" } },
    negatives: { [`custom:${comfyId}`]: { effect: "none" } },
    variants: {},
  }),
);
saveWorkflowPreferences(
  { favorites: [`custom:${radianceId}`], lastUsed: {}, thumbnails: {} },
  { immediate: true },
);
for (const backend of ["radiance", "comfyui"])
  for (let run = 0; run < 3; run++)
    recordGeneration({
      body: {
        kind: "image",
        model: `custom:image-krea2-turbo-${backend}`,
        width: 1024,
        height: 1024,
        steps: 8,
      },
      result: { runMs: backend === "radiance" ? 2000 : 6000 },
    });

const combinedRaw = (backend = "radiance") => ({
  studio: {
    id: "combined",
    name: "Krea 2 Turbo · Fast",
    kind: "image",
    family: "krea2",
    prompting: { name: "Krea 2" },
    backend,
    backends: {
      comfyui: { ...comfyBlock, graph: comfyGraph },
      radiance: { ...radianceBlock, graph: radianceGraph },
    },
  },
});

test("a combined profile loads as its shared fields with the selected backend's block over them", () => {
  const radiance = metadataFromJson(combinedRaw());
  assert.equal(radiance.backend, "radiance");
  assert.deepEqual(radiance.backendIds, ["comfyui", "radiance"]);
  assert.equal(radiance.name, "Krea 2 Turbo · Fast");
  assert.equal(radiance.prompting.name, "Krea 2");
  assert.equal(radiance.description, "Radiance runtime.");
  assert.equal(radiance.defaults.width, 1536);
  assert.equal(radiance.capabilities.startImage, false);
  assert.deepEqual(radiance.requiredNodes, ["RadianceImageGenerate", "SaveImage"]);

  const comfy = metadataFromJson(combinedRaw(), "", { backend: "comfyui" });
  assert.equal(comfy.backend, "comfyui");
  assert.equal(comfy.defaults.width, 2048);
  assert.equal(comfy.capabilities.startImage, true);
  assert.equal(comfy.graph[1].class_type, "UNETLoader");
  // A backend the profile doesn't define runs the selected one; there is no silent other choice.
  assert.equal(metadataFromJson(combinedRaw(), "", { backend: "cloud" }).backend, "radiance");
  // A profile with one graph is unchanged.
  assert.equal(metadataFromJson(JSON.parse(readEditableProfile(comfyId).text)).backend, undefined);
});

test("a combined profile is checked on every backend, and must name backends Studio runs", () => {
  const text = (raw) => JSON.stringify(raw);
  assert.ok(validateProfileText("combined", text(combinedRaw())).ok);
  const broken = combinedRaw();
  broken.studio.backends.comfyui.controls.prompt = { node: "9", input: "text" };
  const checked = validateProfileText("combined", text(broken));
  assert.equal(checked.ok, false);
  assert.match(checked.errors[0], /^studio\.backends\.comfyui: controls\.prompt points at node 9/);
  const unknown = combinedRaw("cloud");
  assert.match(
    validateProfileText("combined", text(unknown)).errors.join(" "),
    /studio\.backend must name one of studio\.backends/,
  );
  const extra = combinedRaw();
  extra.studio.backends.vllm = { ...radianceBlock, graph: radianceGraph };
  assert.match(
    validateProfileText("combined", text(extra)).errors.join(" "),
    /studio\.backends\.vllm isn’t a backend Studio runs/,
  );
});

test("readiness follows the selected backend, with the reason, and never falls back", () => {
  write("combined", `${JSON.stringify(combinedRaw(), null, 2)}\n`);
  try {
    // Only ComfyUI's nodes: the Radiance-selected profile shows as not ready, with why.
    const comfyOnly = inferModels(comfyNodes).profiles.find(
      (profile) => profile.id === "custom:combined",
    );
    assert.equal(comfyOnly.ready, false);
    assert.equal(comfyOnly.backend, "radiance");
    assert.match(comfyOnly.readyReason, /^Radiance isn’t ready: .*RadianceImageGenerate/);
    assert.deepEqual(
      comfyOnly.backendOptions.map(({ id, ready }) => [id, ready]),
      [
        ["comfyui", true],
        ["radiance", false],
      ],
    );
    assert.equal(comfyOnly.label, "Krea 2 Turbo · Fast");
    // Everything there: ready on its backend.
    const everything = inferModels(allNodes).profiles.find(
      (profile) => profile.id === "custom:combined",
    );
    assert.equal(everything.ready, undefined);
    assert.equal(everything.defaults.width, 1536);
    // A run that asks for ComfyUI validates against ComfyUI's profile.
    const asked = inferModels(
      comfyNodes,
      {},
      {
        profileBackends: { "custom:combined": "comfyui" },
      },
    ).profiles.find((profile) => profile.id === "custom:combined");
    assert.equal(asked.backend, "comfyui");
    assert.equal(asked.ready, undefined);
    assert.equal(asked.defaults.width, 2048);
    // No backend can run here: not listed, as any other profile whose nodes are missing.
    const { LoadImage: _loadImage, ...neither } = comfyNodes;
    const listed = inferModels(neither).profiles;
    assert.ok(!listed.some((profile) => profile.id === "custom:combined"));
    // The worker's inventory names each backend it can run, so routing follows the run's backend.
    noteWorkerProfiles("second", [comfyOnly]);
    noteWorkerProfiles("primary", [everything]);
    assert.equal(
      routeJob("image", { profileId: "custom:combined@comfyui" })?.id,
      "primary",
      "both workers can run ComfyUI; the first wins",
    );
    noteWorkerProfiles("primary", []);
    assert.equal(routeJob("image", { profileId: "custom:combined@comfyui" })?.id, "second");
    // Two workers' catalogues: the one where the selected backend is ready wins.
    const merged = mergeWorkerModels([
      { worker: { id: "second", capabilities: ["image"] }, models: { profiles: [comfyOnly] } },
      { worker: { id: "primary", capabilities: ["image"] }, models: { profiles: [everything] } },
    ]).profiles.find((profile) => profile.id === "custom:combined");
    assert.equal(merged.ready, undefined);
    assert.ok(merged.backendOptions.every((option) => option.ready));
  } finally {
    fs.rmSync(path.join(userWorkflowsDir, "combined.json"));
  }
});

test("the preview pairs one model's Radiance and ComfyUI profiles and says what differs", () => {
  const preview = backendCandidates();
  assert.equal(preview.pairs.length, 1);
  const [pair] = preview.pairs;
  assert.equal(pair.id, combinedId);
  assert.equal(pair.name, "Krea 2 Turbo · Fast · 8 Steps");
  assert.equal(pair.radiance.id, radianceId);
  assert.equal(pair.comfyui.id, comfyId);
  assert.deepEqual(
    pair.differences.map(({ label }) => label),
    ["Size", "References", "Guide", "Negative Prompt"],
  );
  assert.deepEqual(pair.differences[0], {
    label: "Size",
    radiance: "1536×1536",
    comfyui: "2048×2048",
  });
});

test("combining needs the preview's hash, backs up, aliases each id to its backend and is safe to repeat", () => {
  const preview = backendCandidates();
  const selections = [
    { radiance: radianceId, comfyui: comfyId, name: "Krea 2 Turbo · Fast", backend: "radiance" },
  ];
  assert.throws(() => combineBackends({ hash: "stale", selections }), { status: 409 });
  assert.throws(
    () =>
      combineBackends({ hash: preview.hash, selections: [{ radiance: radianceId, comfyui: "x" }] }),
    { status: 400 },
  );
  assert.ok(fs.existsSync(path.join(userWorkflowsDir, `${radianceId}.json`)));

  const result = combineBackends({ hash: preview.hash, selections, by: "admin-1" });
  assert.deepEqual(result.combined, [
    {
      id: combinedId,
      name: "Krea 2 Turbo · Fast",
      backend: "radiance",
      from: [radianceId, comfyId],
    },
  ]);
  for (const id of [radianceId, comfyId]) {
    assert.ok(!fs.existsSync(path.join(userWorkflowsDir, `${id}.json`)));
    assert.ok(fs.existsSync(path.join(temporary, result.backup, `${id}.json`)));
    assert.ok(profileStore().versions(id).length >= 1);
  }
  const backup = path.join(temporary, result.backup);
  assert.ok(fs.existsSync(path.join(backup, "prompting.json")));
  assert.ok(fs.existsSync(path.join(backup, "timings.json")));
  const manifest = JSON.parse(fs.readFileSync(path.join(backup, "combine.json"), "utf8"));
  assert.equal(manifest.combined[0].id, combinedId);

  const raw = JSON.parse(readEditableProfile(combinedId).text);
  assert.equal(raw.studio.backend, "radiance");
  assert.deepEqual(Object.keys(raw.studio.backends), ["comfyui", "radiance"]);
  assert.equal(raw.studio.backends.comfyui.graph[1].class_type, "UNETLoader");
  assert.equal(raw.studio.backends.radiance.description, "Radiance runtime.");
  assert.equal(profileStore().meta(combinedId).version, 1);
  assert.equal(profileStore().aliases()[radianceId].backend, "radiance");
  assert.deepEqual(
    [profileStore().aliases()[comfyId].to, profileStore().aliases()[comfyId].backend],
    [combinedId, "comfyui"],
  );
  // The guide binding and negatives of the default backend go to the combined id... here Radiance has none.
  assert.equal(guideStore().read().profiles[`custom:${combinedId}`], undefined);
  assert.deepEqual(loadWorkflowPreferences().favorites, [`custom:${combinedId}`]);
  // Earlier timings now speak for the combined profile on each backend.
  const sized = { kind: "image", width: 1024, height: 1024, steps: 8 };
  assert.equal(
    generationEstimate({ ...sized, model: `custom:${combinedId}`, profileBackend: "radiance" })
      ?.totalMs,
    2000,
  );
  assert.equal(
    generationEstimate({ ...sized, model: `custom:${combinedId}`, profileBackend: "comfyui" })
      ?.totalMs,
    6000,
  );

  assert.deepEqual(backendCandidates().pairs, []);
  assert.deepEqual(combineBackends({ hash: preview.hash, selections: [] }), {
    combined: [],
    backup: "",
  });
  assert.throws(() => combineBackends({ hash: preview.hash, selections }), { status: 409 });
});

test("an old per-backend id resolves to the combined profile on its own backend in every reader", () => {
  const combined = `custom:${combinedId}`;
  const old = `custom:${comfyId}`;
  assert.equal(canonicalProfileId(old), combined);
  assert.equal(profileAliasBackend(old), "comfyui");
  assert.equal(profileAliasBackend(`custom:${radianceId}`), "radiance");
  assert.equal(profileAliasBackend(combined), "");
  // The workflow an old id names is its own backend's; the combined id runs its selected one.
  assert.equal(getCustomWorkflow(old)?.backend, "comfyui");
  assert.equal(getCustomWorkflow(old)?.id, combinedId);
  assert.equal(getCustomWorkflow(combined)?.backend, "radiance");
  assert.equal(getCustomWorkflow(combined, "comfyui")?.backend, "comfyui");

  const profiles = [
    {
      id: combined,
      label: "Krea 2 Turbo · Fast",
      family: "krea2",
      backend: "radiance",
      backendOptions: [{ id: "comfyui" }, { id: "radiance" }],
    },
  ];
  assert.equal(findProfile(profiles, old)?.namedBackend, "comfyui");
  assert.equal(findProfile(profiles, combined)?.namedBackend, undefined);
  assert.equal(findProfile(profiles, "krea 2 turbo")?.id, combined);

  const now = Date.parse("2026-10-27T00:00:00Z");
  const item = (profileId) => ({
    status: "done",
    createdAt: "2026-10-26T00:00:00Z",
    settings: { profileId },
  });
  assert.equal(
    profileStats([item(old), item(`custom:${radianceId}`), item(combined)], now)[combined]?.runs,
    3,
  );
  assert.ok(matchesGalleryFilters({ ...item(old), model: old }, { workflow: combined }));
  const access = effectiveAccountAccess(
    { id: "user-1", role: "user", accessProfileId: "group" },
    { group: { generationProfiles: [old], features: {} } },
    [combined],
  );
  assert.ok(mayUseGenerationProfile(access, { id: combined }));
});

test("switching the backend is an ordinary versioned edit, and records and timings follow it", () => {
  const current = readEditableProfile(combinedId);
  const raw = JSON.parse(current.text);
  raw.studio.backend = "comfyui";
  saveEditableProfile(combinedId, JSON.stringify(raw, null, 2), {
    baseHash: current.hash,
    by: "admin-1",
  });
  assert.equal(profileStore().meta(combinedId).version, 2);
  assert.equal(getCustomWorkflow(`custom:${combinedId}`)?.backend, "comfyui");
  // Exact Repeat of a Radiance run still asks for Radiance, which the profile still defines.
  assert.equal(getCustomWorkflow(`custom:${combinedId}`, "radiance")?.backend, "radiance");

  const settings = generationSettings({
    profileId: `custom:${combinedId}`,
    profileBackend: "radiance",
  });
  assert.equal(settings.profileBackend, "radiance");
  assert.equal(generationSettings({ profileId: "custom:other" }).profileBackend, undefined);
  assert.equal(
    timingKey({ kind: "image", model: `custom:${combinedId}`, profileBackend: "comfyui" }),
    `image:custom:${combinedId}@comfyui`,
  );
});

test("an export keeps a combined id's aliases with their backends", () => {
  const { files } = buildExport({
    workflowsDir: userWorkflowsDir,
    profiles: profileStore(),
    guides: guideStore(),
  });
  const aliases = JSON.parse(files.find((file) => file.name === "profile-aliases.json").body);
  assert.deepEqual([aliases[radianceId].to, aliases[radianceId].backend], [combinedId, "radiance"]);
});

test("MCP reruns an old result on the backend it ran on and sends the backend with each job", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-backends-mcp-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sent = [];
  const media = new McpMedia({
    dataDir: dir,
    baseUrl: "http://127.0.0.1:8790",
    publicUrl: "https://studio.example.test",
    async domainRequest(method, route, body) {
      if (route.startsWith("/api/models"))
        return {
          status: 200,
          payload: {
            profiles: [
              {
                id: `custom:${combinedId}`,
                kind: "image",
                label: "Krea 2 Turbo · Fast",
                model: `custom:${combinedId}`,
                workflow: `custom:${combinedId}`,
                backend: "comfyui",
                backendOptions: [
                  { id: "comfyui", label: "ComfyUI", ready: true },
                  { id: "radiance", label: "Radiance", ready: true },
                ],
                defaults: { width: 1024, height: 1024 },
                capabilities: {},
                mediaInputs: [],
              },
            ],
          },
        };
      if (route.startsWith("/api/estimate")) return { status: 200, payload: {} };
      sent.push(body);
      return { status: 200, payload: { jobId: body.clientJobId } };
    },
  });
  const old = { type: "image", prompt: "a fox", settings: { profileId: `custom:${radianceId}` } };
  const plan = await media.rerun("owner", old);
  assert.equal(plan.args.profile_id, `custom:${combinedId}`);
  assert.equal(plan.args.profile_backend, "radiance");
  await media.queue("owner", plan.args);
  assert.equal(sent.at(-1).profileBackend, "radiance");
  // Without one named, the profile's current backend; one it no longer has, the current one too.
  await media.queue("owner", { ...plan.args, profile_backend: undefined });
  assert.equal(sent.at(-1).profileBackend, "comfyui");
  await media.queue("owner", { ...plan.args, profile_backend: "cloud" });
  assert.equal(sent.at(-1).profileBackend, "comfyui");
});
