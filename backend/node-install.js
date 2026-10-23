import fs from "node:fs";
import path from "node:path";
import { comfyModelsDir, missingNodes } from "./comfy.js";
import { nodePack } from "./node-packs.js";
import { packInstallRoutes } from "./pack-installer.js";

/**
 * How to add a custom node pack to ComfyUI when Studio cannot do it itself:
 * ComfyUI-Manager's Git URL install, or one terminal command. Shared by smart
 * upscale (SeedVR2) and the model families that run on a pack (Sana).
 */

/** The ComfyUI folder itself, when it sits on this machine next to the models folder we found. */
export function comfyRootDir() {
  const models = comfyModelsDir();
  return models ? path.dirname(models) : "";
}

/** The local ComfyUI virtual environment, when Studio can see it. */
export function comfyPython(root) {
  if (!root) return "";
  return (
    [
      path.join(root, ".venv", "bin", "python"),
      path.join(root, "venv", "bin", "python"),
      path.join(root, "..", ".venv", "bin", "python"),
    ].find((file) => fs.existsSync(file)) || ""
  );
}

/** A reviewed node pack installed with the Python from its existing local environment. */
export function packInstallPlan(pack, root = comfyRootDir()) {
  const customNodes = root ? path.join(root, "custom_nodes") : "";
  const python = comfyPython(root);
  const cloned = Boolean(customNodes) && fs.existsSync(path.join(customNodes, pack.folder));
  const source = pack.subdir ? `${pack.folder}.src` : pack.folder;
  const fetchSteps = cloned
    ? []
    : [
        `git clone ${pack.repository}${pack.subdir ? ` ${source}` : ""}`,
        ...(pack.commit ? [`git -C ${source} checkout --detach ${pack.commit}`] : []),
        ...(pack.subdir
          ? [
              `cp -R "${path.join(source, ...pack.subdir.split("/"))}" "${pack.folder}"`,
              `rm -rf "${source}"`,
            ]
          : []),
      ];
  const command = [
    `cd "${customNodes || path.join("ComfyUI", "custom_nodes")}"`,
    ...fetchSteps,
    ...(pack.requirements !== false
      ? [
          `${python ? `"${python}"` : "python3"} -m pip install -r ${path.join(pack.folder, "requirements.txt")}`,
        ]
      : []),
  ].join(" && ");
  return {
    exact: Boolean(customNodes && python),
    customNodesDir: customNodes,
    python,
    cloned,
    needsGit: !cloned,
    commands: [{ shell: "sh", label: "Terminal", command }],
  };
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
    autoInstall: packInstallRoutes(pack.id),
  };
}
