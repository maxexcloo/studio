import { icons } from "../../ui/icons";
import type { Action, ActionGroups } from "./ActionBar";

const definitions = {
  chat: { label: "Continue in Chat", icon: icons.chat },
  animate: { label: "Animate", icon: icons.animate },
  edit: { label: "Edit", icon: icons.edit },
  retry: { label: "Retry", icon: icons.retry },
  stop: { label: "Stop", icon: icons.stop },
  compare: { label: "Compare", icon: icons.compare },
  upscale: { label: "Upscale", icon: icons.upscale },
  copy: { label: "Copy", icon: icons.copy },
  download: { label: "Download", icon: icons.download },
  share: { label: "Share", icon: icons.share },
  delete: { label: "Delete", icon: icons.delete, color: "red" as const },
  star: { label: "Star", icon: icons.star },
};
type ItemActionId = keyof typeof definitions;
/**
 * The sections and order everywhere: Animate, Edit, Upscale | Compare, Continue in Chat |
 * Copy, Download | Star, Delete. Retry and Stop lead for unfinished work; Compare shows only in
 * menus and the selection bar; Share takes Download's place where phones share.
 */
const sections: ItemActionId[][] = [
  ["retry", "stop", "animate", "edit", "upscale"],
  ["compare", "chat"],
  ["copy", "download", "share"],
  ["star", "delete"],
];

/** An item action with its shared label and icon. */
export const itemAction = (id: ItemActionId, action: Partial<Action> = {}): Action => ({
  id,
  ...definitions[id],
  ...action,
});
/** Places actions in the shared sections and order; absent ones are left out. */
export const itemActionGroups = (actions: (Action | null | false | undefined)[]): ActionGroups =>
  sections.map((ids) =>
    ids.flatMap((id) => actions.filter((action): action is Action => !!action && action.id === id)),
  );
