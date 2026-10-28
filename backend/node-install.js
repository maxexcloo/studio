import path from "node:path";
import { missingNodes } from "./comfy.js";
import { nodePack } from "./node-packs.js";

/**
 * How to add a custom node pack to ComfyUI when Studio cannot do it itself:
 * ComfyUI-Manager's Git URL install, or one terminal command. Shared by smart
 * upscale (SeedVR2) and the model families that run on a pack (Sana).
 */

/** A reviewed node pack cloned into ComfyUI's custom_nodes, with its requirements installed. */
export function packInstallPlan(pack) {
  const source = pack.subdir ? `${pack.folder}.src` : pack.folder;
  const command = [
    `cd "${path.join("ComfyUI", "custom_nodes")}"`,
    `git clone ${pack.repository}${pack.subdir ? ` ${source}` : ""}`,
    ...(pack.commit ? [`git -C ${source} checkout --detach ${pack.commit}`] : []),
    ...(pack.subdir
      ? [
          `cp -R "${path.join(source, ...pack.subdir.split("/"))}" "${pack.folder}"`,
          `rm -rf "${source}"`,
        ]
      : []),
    // python3, since many Linux systems have no `python`.
    ...(pack.requirements !== false
      ? [`python3 -m pip install -r ${path.join(pack.folder, "requirements.txt")}`]
      : []),
  ].join(" && ");
  return { commands: [{ shell: "sh", label: "Terminal", command }] };
}

/**
 * The "missing" entry for a node pack that is not loaded, or null when it is:
 * what setup panels render as the Manager/terminal install. `extra` names
 * nodes beyond the pack's usual set that this use needs.
 */
export function missingPackPart(info, packId, { detail = "", extra = [] } = {}) {
  const pack = nodePack(packId);
  const absent = missingNodes(info, [...pack.nodes, ...extra]);
  if (!absent.length) return null;
  return {
    part: "comfy",
    label: `${pack.name} nodes`,
    detail: detail || `ComfyUI needs the ${pack.name} custom nodes for this.`,
    downloads: [],
    missingNodes: absent,
    nodePack: {
      id: pack.id,
      name: pack.name,
      repository: pack.repository,
      folder: pack.folder,
      search: pack.search || "",
      note: pack.note || "",
      ...(pack.subdir ? { subdir: pack.subdir } : {}),
    },
    install: packInstallPlan(pack),
  };
}
