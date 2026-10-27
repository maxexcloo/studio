// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Profiles › Combine Backends: an administrator's explicit, repeatable action, never run
 * at startup. It makes one profile of a model's Radiance and ComfyUI profiles.
 *
 * Candidates are pairs of profiles of the same kind, family and model name (the name's first
 * segment, "Krea 2 Turbo" in "Krea 2 Turbo · Radiance · Fast · 8 Steps"): one whose graph runs on
 * Radiance nodes and one that runs on ComfyUI's. Each pair lists what differs (steps, size,
 * references, modes, LoRAs, guide). The administrator picks pairs, each one's name and the backend
 * it runs on by default.
 *
 * Applying copies both files, the aliases, workflow preferences, guides and timings to
 * `<data>/backups/profile-backends/<time>/`, writes the combined profile (`studio.backend` and
 * `studio.backends.<id>`, custom-workflows.js) as a new profile with its own version history, gives
 * it the default backend's guide binding and negatives, records each old id as an alias
 * `{to, backend}` (profile-store.js), so records that name it run again on the backend they ran on,
 * then removes the old files; their version history stays, so a seed never brings them back. Run
 * timings move to the combined profile's per-backend keys. Owner records are left as they are.
 */
import fs from "node:fs";
import path from "node:path";
import {
  backendIdsOf,
  graphFromJson,
  metadataFromJson,
  profileBackendLabels,
  sharedProfileFields,
  userWorkflowsDir,
} from "./custom-workflows.js";
import { dataDir } from "./gallery-store.js";
import { writeJsonFile } from "./json-store.js";
import {
  createEditableProfile,
  listEditableProfiles,
  readEditableProfile,
} from "./profile-editor.js";
import { guideStore, hashOf, profileStore } from "./profile-store.js";
import { renameTimingKeys } from "./timings.js";
import { loadWorkflowPreferences, repointWorkflowPreferences } from "./workflow-catalog.js";

const conflict = (message) => Object.assign(new Error(message), { status: 409 });
const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const pairKey = (radiance, comfyui) => `${radiance}+${comfyui}`;

/** The backend a single-graph profile runs on, from its graph's nodes; "" for a provider (Grok) or an empty graph. */
function graphBackend(raw) {
  const classes = Object.values(graphFromJson(raw) || {}).map((node) => String(node?.class_type));
  if (!classes.length || classes.includes("GrokMedia")) return "";
  return classes.some((name) => name.startsWith("Radiance")) ? "radiance" : "comfyui";
}

/**
 * The combined profile's suggested name: the segments both names share, in the ComfyUI name's order,
 * so "Krea 2 Turbo · Radiance · Fast · 8 Steps" and "Krea 2 Turbo · ComfyUI · Fast · 8 Steps · 1
 * Reference" suggest "Krea 2 Turbo · Fast · 8 Steps"; the backend and what differs are left out.
 */
function sharedName(radiance, comfyui) {
  const parts = (name) =>
    String(name)
      .split("·")
      .map((part) => part.trim())
      .filter((part) => part && !/^(radiance|comfyui)$/i.test(part));
  const other = new Set(parts(radiance).map((part) => part.toLowerCase()));
  const [model, ...rest] = parts(comfyui);
  return [model, ...rest.filter((part) => other.has(part.toLowerCase()))].join(" · ");
}

/** The combined profile's id: either id without its backend ending, else the ComfyUI id with `-combined`. */
const combinedId = (radianceId, comfyuiId) =>
  /-comfyui$/.test(comfyuiId)
    ? comfyuiId.replace(/-comfyui$/, "")
    : /-radiance$/.test(radianceId)
      ? radianceId.replace(/-radiance$/, "")
      : `${comfyuiId}-combined`;

/** What a guide reader shows for a profile: its own guidance, else its binding's pack, else its family's. */
function guideName(raw, guides, id) {
  const prompting = raw?.studio?.prompting;
  if (prompting && typeof prompting === "object")
    return `Own Guide (${prompting.name || "Unnamed"})`;
  return guides?.profiles?.[`custom:${id}`]?.pack || "Family Guide";
}

/** What differs between a pair, as `[{label, radiance, comfyui}]`; equal values are left out. */
function differences(radiance, comfyui, guides) {
  const show = (member) => {
    const workflow = metadataFromJson(member.raw);
    const { width, height, steps } = workflow.defaults || {};
    const negative = guides?.negatives?.[`custom:${member.id}`];
    return {
      Steps: steps ? String(steps) : "—",
      Size: width && height ? `${width}×${height}` : "—",
      References: String(workflow.mediaInputs?.length || 0),
      Modes: Object.keys(workflow.imageModes || {}).join(", ") || "—",
      LoRAs: workflow.loraStack ? `Up to ${workflow.loraStack.max}` : "None",
      Guide: guideName(member.raw, guides, member.id),
      "Negative Prompt": negative?.effect ? String(negative.effect) : "—",
    };
  };
  const left = show(radiance);
  const right = show(comfyui);
  return Object.keys(left)
    .filter((label) => left[label] !== right[label])
    .map((label) => ({ label, radiance: left[label], comfyui: right[label] }));
}

/**
 * What Combine Backends offers now: `pairs` ({radiance, comfyui, id, name, kind, family,
 * differences}), each member as {id, name, hash}. A profile in several pairs (one Radiance
 * profile and two ComfyUI ones of a model) can be combined in only one. `hash` identifies the pairs
 * and every file in them, so applying refuses a stale preview.
 */
export function backendCandidates() {
  const guides = guideStore().read();
  const groups = new Map();
  for (const item of listEditableProfiles()) {
    if (!item.readable) continue;
    const { text, hash } = readEditableProfile(item.id);
    const raw = JSON.parse(text);
    if ((raw?.studio?.id || item.id) !== item.id || backendIdsOf(raw).length) continue;
    const backend = graphBackend(raw);
    if (!backend) continue;
    const model = String(item.name).split("·")[0].trim().toLowerCase();
    const key = `${item.kind}\u0000${item.family}\u0000${model}`;
    if (!groups.has(key)) groups.set(key, { radiance: [], comfyui: [] });
    groups.get(key)[backend].push({ id: item.id, name: item.name, hash, raw, ...item });
  }
  const pairs = [];
  for (const { radiance, comfyui } of groups.values())
    for (const left of radiance)
      for (const right of comfyui)
        pairs.push({
          key: pairKey(left.id, right.id),
          id: combinedId(left.id, right.id),
          name: sharedName(left.name, right.name) || right.name,
          kind: right.kind,
          family: right.family,
          radiance: { id: left.id, name: left.name, hash: left.hash },
          comfyui: { id: right.id, name: right.name, hash: right.hash },
          differences: differences(left, right, guides),
        });
  pairs.sort((a, b) => a.key.localeCompare(b.key));
  return {
    hash: hashOf(pairs.map(({ key, radiance, comfyui }) => [key, radiance.hash, comfyui.hash])),
    pairs,
  };
}

/** The combined profile's text: the shared fields, `backend` and each backend's own block with its graph. */
function combinedText(id, name, backend, members) {
  const blocks = Object.fromEntries(
    Object.entries(members).map(([key, raw]) => [
      key,
      { ...raw.studio, graph: graphFromJson(raw) },
    ]),
  );
  const first = blocks[backend];
  const shared = {
    id,
    name,
    kind: first.kind,
    family: first.family,
    ...(Object.values(blocks).some((block) => block.nsfw === true) ? { nsfw: true } : {}),
    ...(first.prompting ? { prompting: first.prompting } : {}),
  };
  const backends = {};
  for (const key of Object.keys(profileBackendLabels).filter((key) => blocks[key])) {
    const own = Object.fromEntries(
      Object.entries(blocks[key]).filter(([field]) => !sharedProfileFields.includes(field)),
    );
    // Guidance that differs from the shared one stays with its backend, so nothing is lost.
    if (
      blocks[key].prompting &&
      JSON.stringify(blocks[key].prompting) !== JSON.stringify(shared.prompting)
    )
      own.prompting = blocks[key].prompting;
    backends[key] = own;
  }
  return `${JSON.stringify({ studio: { ...shared, backend, backends } }, null, 2)}\n`;
}

/**
 * Combines the pairs `selections` picks from the preview `hash` (`[{radiance, comfyui, name,
 * backend}]`, member ids). Nothing picked is a no-op, so a repeat is safe; a changed preview is
 * refused (409), as is a pair the preview doesn't offer, a profile in two picks or a combined id
 * that already exists. Returns the combined profiles and the backup folder.
 */
export function combineBackends({ hash, selections = [], by = "" } = {}) {
  if (!Array.isArray(selections) || !selections.length) return { combined: [], backup: "" };
  const plan = backendCandidates();
  if (hash !== plan.hash)
    throw conflict("The profiles changed since the preview. Preview them again.");
  const picks = selections.map((selection) => {
    const pair = plan.pairs.find(
      (candidate) => candidate.key === pairKey(selection?.radiance, selection?.comfyui),
    );
    if (!pair) throw invalid("Choose pairs from the preview.");
    const name = String(selection.name ?? pair.name).trim();
    if (!name) throw invalid(`Name the combined ${pair.name} profile.`);
    const backend = selection.backend || "comfyui";
    if (!Object.hasOwn(profileBackendLabels, backend))
      throw invalid("Choose Radiance or ComfyUI as the default backend.");
    return { pair, name: name.slice(0, 200), backend };
  });
  const members = picks.flatMap(({ pair }) => [pair.radiance.id, pair.comfyui.id]);
  if (new Set(members).size !== members.length)
    throw invalid("A profile can join only one combined profile.");
  if (new Set(picks.map(({ pair }) => pair.id)).size !== picks.length)
    throw invalid("Two picked pairs would make the same profile. Pick one of them.");
  const store = profileStore({ workflowsDir: userWorkflowsDir });
  for (const pick of picks) {
    const { pair, name, backend } = pick;
    pick.raws = {
      radiance: JSON.parse(readEditableProfile(pair.radiance.id).text),
      comfyui: JSON.parse(readEditableProfile(pair.comfyui.id).text),
    };
    pick.text = combinedText(pair.id, name, backend, pick.raws);
    // The same combined file is an apply that stopped part way: this one finishes it.
    const file = path.join(userWorkflowsDir, `${pair.id}.json`);
    pick.written = fs.existsSync(file) && fs.readFileSync(file, "utf8") === pick.text;
    if ((fs.existsSync(file) && !pick.written) || Object.hasOwn(store.aliases(), pair.id))
      throw conflict(`A profile named ${pair.id} already exists or was merged away.`);
  }

  const at = new Date().toISOString();
  const backup = path.join(dataDir, "backups", "profile-backends", at.replace(/[:.]/g, "-"));
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  writeJsonFile(
    path.join(backup, "combine.json"),
    {
      at,
      by: String(by || ""),
      combined: picks.map(({ pair, name, backend }) => ({
        id: pair.id,
        name,
        backend,
        radiance: pair.radiance.id,
        comfyui: pair.comfyui.id,
      })),
      aliasesBefore: store.aliases(),
      preferencesBefore: loadWorkflowPreferences(),
    },
    { mode: 0o600 },
  );
  for (const id of members)
    fs.writeFileSync(path.join(backup, `${id}.json`), readEditableProfile(id).text, {
      mode: 0o600,
    });
  for (const file of [guideStore().file, path.join(dataDir, "timings.json")])
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(backup, path.basename(file)));

  const guides = guideStore();
  const timingKeys = {};
  const combined = [];
  for (const { pair, name, backend, raws, text, written } of picks) {
    // Unreviewed drafts stay unreviewed: either side AI-Drafted marks the combined profile so.
    const drafted = [pair.radiance.id, pair.comfyui.id].some(
      (id) => store.meta(id)?.aiDrafted === true,
    );
    if (!written)
      createEditableProfile(pair.id, text, {
        by,
        origin: "studio",
        aiDrafted: drafted,
        note: `Combined from ${pair.radiance.id} and ${pair.comfyui.id}`,
      });
    guides.copyProfileGuide(`custom:${pair[backend].id}`, `custom:${pair.id}`);
    for (const key of ["radiance", "comfyui"]) {
      const from = pair[key].id;
      const { text } = readEditableProfile(from);
      // History keeps the removed definition, and marks the id as one Studio held.
      store.record(from, text, { by, origin: "studio", note: `Before combining into ${pair.id}` });
      const kind = raws[key].studio?.kind === "video" ? "video" : "image";
      timingKeys[`${kind}:custom:${from}`] = `${kind}:custom:${pair.id}@${key}`;
    }
    // Aliases before removal: an interrupted apply leaves the old files, and applying again finishes it.
    store.addAliases(
      ["radiance", "comfyui"].map((key) => ({
        from: pair[key].id,
        to: pair.id,
        backend: key,
        reason: "combined",
      })),
      { by, at },
    );
    for (const key of ["radiance", "comfyui"])
      fs.rmSync(path.join(userWorkflowsDir, `${pair[key].id}.json`));
    combined.push({
      id: pair.id,
      name,
      backend,
      from: [pair.radiance.id, pair.comfyui.id],
    });
  }
  repointWorkflowPreferences((id) => store.canonical(id));
  renameTimingKeys(timingKeys);
  return { combined, backup: path.relative(dataDir, backup) };
}
