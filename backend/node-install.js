import path from "node:path";

/**
 * How to add a custom node pack to ComfyUI when Studio cannot do it itself:
 * ComfyUI-Manager's Git URL install, or one terminal command.
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
