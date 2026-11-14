import {
  characterImage,
  characterImageIds,
  maxCardName,
  sheetRoles,
  takesSubjects,
} from "../shared/characters.ts";
import { listCards, refusal, shownCard, updateCharacter } from "./cards.js";
import { directRoute } from "./domain/direct-route.ts";
import { isGalleryHidden } from "./gallery/store.js";
import { publicGalleryBuffer, saveUpload } from "./references.js";
import { loadSharp } from "./sharp-loader.js";

/**
 * Make Sheet: a character's first image redrawn as a character design sheet by Qwen-Image 2.1, which
 * edits with it, from a prompt the prompt assistant writes (prompt-sheet.js). Once the sheet is
 * made, it is cut into its panels (splitSheet), each kept as an upload and on the card by its role
 * (shared/characters.ts sheetRoles), with the whole sheet as `sheet`.
 */

/**
 * A sheet's 3:2 shape, as its layout asks, at the 1K tier: on live (13 Nov) Qwen-Image 2.1 drew a
 * clean sheet at 1024×672, each view about 650 pixels tall.
 */
export const sheetSize = { width: 1536, height: 1024, resolutionTier: "1K" };

/** The profile a sheet draws on: a ready Qwen-Image 2.1 that takes an image, Quality first. */
export function sheetProfile(profiles) {
  const ready = profiles.filter(
    (profile) =>
      profile.kind === "image" &&
      profile.family === "qwen_image_21" &&
      profile.ready !== false &&
      profile.mediaInputs?.length,
  );
  return ready.find((profile) => !/turbo|fast/i.test(profile.label || profile.id)) || ready[0];
}

// A pixel counts as drawn when a channel differs this much from the background.
const inkLevel = 28;
// The sheet is read at this width: enough to find the gaps between panels.
const readWidth = 640;

/** The runs of `counts` above `noise`, as [start, end), joined across gaps narrower than `gap`. */
function runs(counts, noise, gap) {
  const found = [];
  let start = -1;
  for (let index = 0; index <= counts.length; index++) {
    const drawn = index < counts.length && counts[index] > noise;
    if (drawn && start < 0) start = index;
    if (!drawn && start >= 0) {
      const last = found.at(-1);
      if (last && start - last[1] < gap) last[1] = index;
      else found.push([start, index]);
      start = -1;
    }
  }
  return found;
}

/**
 * The panels of a sheet drawn to the layout prompt-sheet.js asks for, as `{ role, left, top,
 * width, height }` in the image's pixels: the face column's top close-up (`face`), the turnaround's
 * three figures (`front`, `side`, `back`) and the gear row (`gear`) when there is one. Panels are
 * found by the background between them; where the gaps aren't clear, by the layout's proportions.
 */
export async function sheetPanels(buffer) {
  const sharp = await loadSharp();
  if (!sharp) throw new Error("Image resizing is off, so the sheet can't be split.");
  const { width, height } = await sharp(buffer).metadata();
  const scale = Math.min(1, readWidth / width);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .resize(w, h, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  // The background is the border's median colour.
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, x + (h - 1) * w);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const background = Array.from({ length: channels }, (_, channel) => {
    const values = border.map((at) => data[at * channels + channel]).sort((a, b) => a - b);
    return values[values.length >> 1];
  });
  const ink = new Uint8Array(w * h);
  for (let at = 0; at < w * h; at++)
    for (let channel = 0; channel < channels; channel++)
      if (Math.abs(data[at * channels + channel] - background[channel]) > inkLevel) {
        ink[at] = 1;
        break;
      }
  const columns = (left, top, right, bottom) =>
    Array.from({ length: right - left }, (_, dx) => {
      let count = 0;
      for (let y = top; y < bottom; y++) count += ink[y * w + left + dx];
      return count;
    });
  const rows = (left, top, right, bottom) =>
    Array.from({ length: bottom - top }, (_, dy) => {
      let count = 0;
      for (let x = left; x < right; x++) count += ink[(top + dy) * w + x];
      return count;
    });
  const noise = (length) => Math.max(1, Math.round(length * 0.003));
  /** The widest empty run of `counts` (offset by `from`) centred within [low, high), or null. */
  const widestGap = (counts, from, low, high) => {
    let best = null;
    for (const [start, end] of runs(
      counts.map((count) => (count > noise(counts.length) ? 0 : 1)),
      0,
      1,
    )) {
      const centre = from + (start + end) / 2;
      if (centre >= low && centre < high && (!best || end - start > best[1] - best[0]))
        best = [start, end];
    }
    return best && Math.round(from + (best[0] + best[1]) / 2);
  };
  /** What is drawn within a box, as a box, or null. */
  const drawn = (left, top, right, bottom) => {
    const across = runs(columns(left, top, right, bottom), 0, w);
    const down = runs(rows(left, top, right, bottom), 0, h);
    if (!across.length || !down.length) return null;
    return [left + across[0][0], top + down[0][0], left + across.at(-1)[1], top + down.at(-1)[1]];
  };
  // The face column ends at the gap nearest the left fifth, else at the fifth.
  const split = widestGap(columns(0, 0, w, h), 0, w * 0.08, w * 0.4) ?? Math.round(w * 0.2);
  const panels = [];
  // The face column holds four close-ups of one size (one for a face without expressions): the
  // top quarter of what it draws, or all of it when it is short.
  const faces = runs(rows(0, 0, split, h), noise(split), h * 0.01).filter(
    ([start, end]) => end - start > h * 0.04,
  );
  const [first, last] = [faces[0]?.[0], faces.at(-1)?.[1]];
  const end = last - first > h * 0.5 ? Math.round(first + (last - first) / 4) : last;
  const face = faces.length && drawn(0, first, split, end);
  // Its margin stops short of the close-up under it.
  if (face) panels.push(["face", face, end]);
  // The gear row sits under the turnaround, past a gap across the lower half.
  const below = widestGap(rows(split, 0, w, h), 0, h * 0.45, h * 0.92);
  const gear = below === null ? null : drawn(split, below, w, h);
  const bottom = gear && gear[3] - gear[1] > h * 0.06 ? below : h;
  if (bottom < h) panels.push(["gear", gear]);
  let figures = runs(columns(split, 0, w, bottom), noise(bottom), w * 0.01)
    .filter(([start, end]) => end - start > w * 0.03)
    .map(([start, end]) => [split + start, split + end]);
  // Three figures; more means something else drawn between them, so the three widest.
  if (figures.length > 3)
    figures = figures
      .map((figure, index) => ({ figure, index, size: figure[1] - figure[0] }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 3)
      .sort((a, b) => a.index - b.index)
      .map(({ figure }) => figure);
  if (figures.length < 3) {
    const third = (w - split) / 3;
    figures = [0, 1, 2].map((index) => [
      Math.round(split + third * index),
      Math.round(split + third * (index + 1)),
    ]);
  }
  for (const [index, role] of ["front", "side", "back"].entries()) {
    const box = drawn(figures[index][0], 0, figures[index][1], bottom);
    if (box) panels.push([role, box]);
  }
  // Each panel with a margin of background, in the image's own pixels.
  return panels.map(([role, [left, top, right, bottom], limit = h]) => {
    const margin = Math.min(
      Math.round(Math.max(right - left, bottom - top) * 0.06),
      Math.max(0, limit - bottom),
    );
    const x0 = Math.max(0, Math.floor((left - margin) / scale));
    const y0 = Math.max(0, Math.floor((top - margin) / scale));
    const x1 = Math.min(width, Math.ceil((right + margin) / scale));
    const y1 = Math.min(height, Math.ceil((bottom + margin) / scale));
    return { role, left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
  });
}

/**
 * A run's references (`{ assetId, slot }`) with the account's characters' sheets in play: the
 * card's first image becomes the sheet's panel for the view the `prompt` names (characterImage),
 * and on a video `profile` that animates subjects (MiniMax H3's Reference profiles) any image of
 * the character becomes its whole sheet, or the sheet joins a frame made with the character in
 * the next free slot. `madeWith(assetId)` lists the asset IDs a gallery image was made with.
 */
export function sheetReferences({ references, prompt, cards, profile, madeWith = () => [] }) {
  const swap = (at, assetId) =>
    references.with(at, {
      slot: references[at].slot,
      assetId,
      ...(references[at].strength !== undefined ? { strength: references[at].strength } : {}),
    });
  const subjects = Boolean(profile && takesSubjects(profile));
  for (const card of cards) {
    const own = new Set(characterImageIds(card));
    const at = references.findIndex((asset) => own.has(asset.assetId));
    if (subjects) {
      const sheet = card.sheet?.panels?.find((panel) => panel.role === "sheet")?.referenceId;
      if (!sheet || references.some((asset) => asset.assetId === sheet)) continue;
      if (at >= 0) return swap(at, sheet);
      if (!references.some((asset) => madeWith(asset.assetId).some((id) => own.has(id)))) continue;
      const taken = new Set(references.map((asset) => asset.slot));
      const slot = profile.mediaInputs.find((input) => !taken.has(input.id))?.id;
      return slot ? [...references, { assetId: sheet, slot }] : references;
    }
    if (at < 0 || references[at].assetId !== card.referenceIds[0]) continue;
    const view = characterImage(card, prompt);
    return view === card.referenceIds[0] ? references : swap(at, view);
  }
  return references;
}

/**
 * Make Sheet's route and its finishing step. `profiles(account)` are the generation profiles the
 * account may use; `admit` is domain/admission.ts's. `completed(items)` hears each finished job's
 * results, keeping a sheet's panels on its character.
 */
export function createCharacterSheets({ admit, profiles }) {
  const splitting = new Set();

  /** Cuts a finished sheet into its panels and keeps them on its character. */
  async function keep(ownerId, card, item) {
    const { buffer } = await publicGalleryBuffer(item);
    const sharp = await loadSharp();
    const found = await sheetPanels(buffer);
    const panels = [{ role: "sheet", referenceId: item.id }];
    for (const { role, ...box } of found) {
      const { asset } = await saveUpload(
        {
          buffer: await sharp(buffer).extract(box).png().toBuffer(),
          name: `${card.name.slice(0, maxCardName)} ${role}.png`,
          mime: "image/png",
        },
        ownerId,
      );
      panels.push({ role, referenceId: asset.id });
    }
    panels.sort((a, b) => sheetRoles.indexOf(a.role) - sheetRoles.indexOf(b.role));
    updateCharacter(ownerId, card.id, (current) =>
      current.sheet?.jobId === card.sheet.jobId
        ? { ...current, sheet: { ...current.sheet, panels } }
        : current,
    );
  }

  return {
    register(app) {
      // Queues the card's sheet from its first image; the card follows it until its panels are kept.
      directRoute(app, "POST", "/api/characters/:id/sheet", async (account, { params }) => {
        const refused = refusal(account);
        if (refused) return refused;
        const ownerId = account?.userId || "";
        const card = listCards("characters", ownerId).find((each) => each.id === params.id);
        if (!card)
          return {
            status: 404,
            payload: { ok: false, error: "No such character." },
          };
        const profile = sheetProfile(await profiles(account));
        if (!profile)
          return {
            status: 409,
            payload: {
              ok: false,
              error: "Make Sheet needs Qwen-Image 2.1, which isn’t ready.",
            },
          };
        const admitted = await admit(
          {
            ...profile.defaults,
            autoUpscale: null,
            kind: "image",
            profileId: profile.id,
            ...(profile.backend ? { profileBackend: profile.backend } : {}),
            model: profile.model,
            workflow: profile.workflow,
            loras: [],
            referenceAssets: [
              {
                assetId: card.referenceIds[0],
                slot: profile.mediaInputs[0].id,
              },
            ],
            ...sheetSize,
            prompt: "",
            seed: "",
            count: 1,
            writing: {
              kind: "sheet",
              name: card.name,
              description: card.description,
            },
          },
          account,
        );
        if (admitted.status >= 400) return admitted;
        const jobId = String(admitted.payload.jobId);
        const character = updateCharacter(ownerId, card.id, (current) => ({
          ...current,
          sheet: { jobId, at: new Date().toISOString() },
        }));
        return {
          status: 200,
          payload: {
            ok: true,
            jobId,
            profile: profile.label || profile.id,
            character: shownCard(account, character),
          },
        };
      });
    },
    /** Keeps the panels of each finished sheet among `items`, once. */
    async completed(items) {
      for (const item of items) {
        if (item.type !== "image" || item.status !== "done" || isGalleryHidden(item)) continue;
        const ownerId = item.ownerId || "";
        const card = listCards("characters", ownerId).find(
          (each) => each.sheet?.jobId === item.jobId && !each.sheet.panels,
        );
        const key = `${ownerId}\n${item.jobId}`;
        if (!card || splitting.has(key)) continue;
        splitting.add(key);
        try {
          await keep(ownerId, card, item);
        } catch (error) {
          console.warn(`[Studio] Make Sheet: ${card.id}'s sheet was not split: ${error.message}`);
          updateCharacter(ownerId, card.id, (current) =>
            current.sheet?.jobId === item.jobId
              ? {
                  ...current,
                  sheet: {
                    ...current.sheet,
                    error: "The sheet couldn’t be split.",
                  },
                }
              : current,
          );
        } finally {
          splitting.delete(key);
        }
      }
    },
  };
}
