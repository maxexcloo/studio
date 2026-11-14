import type { Action, ActionGroups } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";

const definitions = {
  animate: { label: "Animate", icon: icons.animate },
  compare: { label: "Compare", icon: icons.compare },
  copy: { label: "Copy", icon: icons.copy },
  delete: { label: "Delete", icon: icons.delete, color: "red" as const },
  download: { label: "Download", icon: icons.download },
  edit: { label: "Edit", icon: icons.edit },
  recreate: { label: "Recreate", icon: icons.recreate },
  retry: { label: "Retry", icon: icons.retry },
  share: { label: "Share", icon: icons.share },
  similar: { label: "Similar", icon: icons.similar },
  star: { label: "Star", icon: icons.star },
  stop: { label: "Stop", icon: icons.stop },
  upscale: { label: "Upscale", icon: icons.upscale },
};
type ItemActionId = keyof typeof definitions;
/**
 * The sections and order everywhere: Animate, Edit, Recreate, Upscale | Copy, Download | Compare,
 * Similar | Star, Delete. Retry and Stop lead for unfinished work and running upscales; Share takes Download's
 * place where phones share.
 */
const sections: ItemActionId[][] = [
  ["retry", "stop", "animate", "edit", "recreate", "upscale"],
  ["copy", "download", "share"],
  ["compare", "similar"],
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
