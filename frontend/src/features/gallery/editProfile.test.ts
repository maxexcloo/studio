import assert from "node:assert/strict";
import test from "node:test";

import type { MediaItem, Profile } from "../../types";
import { automaticEditProfile } from "./editProfile.ts";

const editor = (id: string, label: string, family: string, backend = "radiance"): Profile => ({
  id,
  label,
  family,
  backend,
  kind: "image",
  model: id,
  workflow: id,
  defaults: {},
  capabilities: { imageInput: true },
});
const item = (profileId: string, loras: string[] = []) =>
  ({
    id: "result",
    type: "image",
    settings: { profileId, loras: loras.map((name) => ({ name, strength: 1, enabled: true })) },
  }) as unknown as MediaItem;
const kleinFast = editor("klein", "FLUX.3 klein · 16 Steps", "flux3");
const kleinBase = editor("klein-base", "FLUX.3 klein Base", "flux3");
const kreaTurbo = editor("krea-turbo", "Krea 2 Turbo", "krea2", "comfyui");
const krea = { ...editor("krea", "Krea 2", "krea2"), capabilities: {} };

test("edits prefer a full editor, keeping LoRAs within the source's family", () => {
  const profiles = [kleinFast, kleinBase, kreaTurbo, krea];
  // A distilled source edits on its family's full model rather than itself.
  assert.equal(automaticEditProfile(profiles, item("klein"))?.id, "klein-base");
  // Without LoRAs a full editor wins over a distilled one of the source's family.
  assert.equal(automaticEditProfile(profiles, item("krea"))?.id, "klein-base");
  // With LoRAs the source's family wins, so they carry over.
  assert.equal(automaticEditProfile(profiles, item("krea", ["curvy"]))?.id, "krea-turbo");
  // A ready local editor, even a distilled one, wins over Cloud.
  const grok = editor("grok", "Grok Imagine", "grok", "cloud");
  assert.equal(automaticEditProfile([grok, kreaTurbo], item("krea"))?.id, "krea-turbo");
  assert.equal(automaticEditProfile([grok], item("krea"))?.id, "grok");
  // An unready editor is passed over.
  const parked = { ...kleinBase, availability: "parked" as const };
  assert.equal(automaticEditProfile([kleinFast, parked], item("klein"))?.id, "klein");
});
