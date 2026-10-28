import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { civitaiLicence, libraryPlacement, lookupLibrary } from "./library-lookup.js";

const { model, versions } = JSON.parse(
  fs.readFileSync(new URL("./fixtures/civitai/model-versions.json", import.meta.url), "utf8"),
);
const json = async (pathname) => {
  if (pathname === "models/9")
    return { ...model, allowCommercialUse: ["Image"], allowNoCredit: false };
  if (pathname.startsWith("models?"))
    return {
      items: [
        {
          ...model,
          modelVersions: [
            { ...versions.public, id: 20 },
            { ...versions.paid, id: 30 },
          ],
        },
      ],
    };
  const id = Number(pathname.split("/")[1]);
  const version = Object.values(versions).find((item) => item.id === id);
  if (!version) throw new Error("That Civitai resource is unavailable.");
  return version;
};
const deps = {
  json,
  inspect: async (want) => ({
    status: want.file === "watercolour-v2.safetensors" ? "installed" : "missing",
  }),
  families: (base) => (/krea/i.test(base) ? ["krea2"] : []),
  profiles: async () => [
    { id: "krea-fast", family: "krea2" },
    { id: "flux-fast", family: "flux" },
  ],
};

test("a lookup lists a Civitai model’s versions and files with availability, licence and fit, without importing", async () => {
  const found = await lookupLibrary(
    { url: "https://civitai.com/models/9?modelVersionId=20" },
    deps,
  );
  assert.deepEqual(
    [found.provider, found.modelId, found.title],
    ["civitai", 9, "Watercolour Style"],
  );
  assert.deepEqual(
    found.versions.map((version) => [
      version.versionId,
      version.current,
      version.available,
      version.reason,
    ]),
    [
      [30, false, false, "early-access"],
      [20, true, true, undefined],
      [17, false, true, undefined],
    ],
  );
  assert.deepEqual(
    found.files.map((file) => [file.name, file.folder, file.status, file.downloadable]),
    [["watercolour-v2.safetensors", "loras", "installed", true]],
  );
  assert.deepEqual([found.families, found.profiles], [["krea2"], ["krea-fast"]]);
  assert.deepEqual(found.licence, {
    commercial: true,
    commercialUses: ["Image"],
    creditRequired: true,
    derivatives: null,
  });
  await assert.rejects(lookupLibrary({ url: "https://civitai.com/images/5" }, deps), /Import it/);
  await assert.rejects(lookupLibrary({}, deps), /link, or a query/);
});

test("a search lists Civitai models with each version’s availability", async () => {
  const found = await lookupLibrary({ query: "watercolour" }, deps);
  assert.equal(found.results.length, 1);
  assert.deepEqual(
    found.results[0].versions.map((version) => [version.versionId, version.available]),
    [
      [20, true],
      [30, false],
    ],
  );
  assert.deepEqual(civitaiLicence({}), {
    commercial: null,
    creditRequired: null,
    derivatives: null,
  });
});

test("placement says where files live on the worker and where one file sits", () => {
  const inventory = () => ({
    files: [
      { path: "loras/glow.safetensors", size: 10 },
      { path: "unet/flux.safetensors", size: 20 },
    ],
    paused: [{}],
    space: { free: 5 },
    writable: true,
  });
  const worker = libraryPlacement({ key: "diffusion_models/flux.safetensors" }, { inventory });
  assert.deepEqual(worker, {
    storage: "worker",
    writable: true,
    space: { free: 5 },
    files: { loras: 1, unet: 1 },
    paused: 1,
    file: {
      key: "diffusion_models/flux.safetensors",
      found: true,
      path: "unet/flux.safetensors",
      bytes: 20,
    },
  });
  assert.equal(
    libraryPlacement({ key: "loras/none.safetensors" }, { inventory }).file.found,
    false,
  );
  assert.throws(
    () => libraryPlacement({ key: "loras/../secret" }, { inventory }),
    /A key is folder\/file/,
  );
  assert.throws(
    () => libraryPlacement({ key: "outputs/a.png" }, { inventory }),
    /A key is folder\/file/,
  );
});
