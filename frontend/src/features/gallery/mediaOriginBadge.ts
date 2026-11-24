import { galleryOrigin } from "../../../../shared/gallery-origin.ts";
import { icons } from "../../ui/icons.ts";
import type { DreamItem } from "../dream/queries";

const badges = {
  chat: { icon: icons.chat, label: "From Chat" },
  comparison: { icon: icons.compare, label: "In Comparison" },
  dream: { icon: icons.dream, label: "From Dream" },
  edit: { icon: icons.recreate, label: "From Edit or Recreate" },
  extend: { icon: icons.extend, label: "From Video Extension" },
  import: { icon: icons.import, label: "From Import" },
  mcp: { icon: icons.mcp, label: "From MCP" },
  project: { icon: icons.project, label: "From Project" },
  recreate: { icon: icons.recreate, label: "From Recreate" },
  remaster: { icon: icons.recreate, label: "From Video Remaster" },
  upload: { icon: icons.uploads, label: "From Upload" },
};

export function mediaOriginBadge(item: DreamItem, inComparison: boolean) {
  if (inComparison || item.dream?.pair) return badges.comparison;
  if (item.uploaded) return item.source ? badges.import : badges.upload;
  if (item.dream?.arm === "extend") return badges.extend;
  if (item.dream?.arm === "recreate") return badges.recreate;
  if (item.dream?.arm === "remaster") return badges.remaster;
  if (item.dream?.projectId) return badges.project;
  const origin = galleryOrigin(item);
  if (origin) return badges[origin];
  if (item.resultSet?.source) return badges.mcp;
  if (item.parentItemId || item.parentJobId) return badges.edit;
}
