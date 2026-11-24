import type { Action, ActionGroups } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";

const definitions = {
  animate: { label: "Animate", icon: icons.animate },
  delete: { label: "Delete", icon: icons.delete, color: "red" as const },
  discover: { label: "Discover", icon: icons.similar },
  dislike: { label: "Dislike", icon: icons.dislike },
  edit: { label: "Edit", icon: icons.edit },
  like: { label: "Like", icon: icons.like },
  recreate: { label: "Recreate", icon: icons.recreate },
  report: { label: "Report", icon: icons.report },
  retry: { label: "Retry", icon: icons.retry },
  share: { label: "Share", icon: icons.share },
  stop: { label: "Stop", icon: icons.stop },
  upscale: { label: "Upscale", icon: icons.upscale },
};
type ItemActionId = keyof typeof definitions;
const menus: ItemActionId[] = ["animate", "edit", "recreate", "upscale"];
// Retry and Stop lead in their own section, for unfinished work and running upscales; Like comes
// before Dislike and Delete last.
const assist: ItemActionId[] = ["discover", "share"];
const rating: ItemActionId[] = ["like", "dislike"];
const others: ItemActionId[] = ["report", "delete"];
/**
 * Bars and menus: Retry, Stop | Animate, Edit, Recreate, Upscale | Discover, Share | Like, Dislike |
 * Report, Delete.
 */
const sections: ItemActionId[][] = [["retry", "stop"], menus, assist, rating, others];
/** Bars name Retry, Stop and the four menus; the rest are icons. */
export const namedItemActions: string[] = ["retry", "stop", ...menus];

export const ratingLabel = (id: "dislike" | "like") => definitions[id].label;

/** An item action with its shared label and icon. */
export const itemAction = (id: ItemActionId, action: Partial<Action> = {}): Action => ({
  id,
  ...definitions[id],
  ...action,
});
/** Places actions in the bar's and menus' sections and order; absent ones are left out. */
export const itemActionGroups = (actions: (Action | null | false | undefined)[]): ActionGroups =>
  sections.map((ids) =>
    ids.flatMap((id) => actions.filter((action): action is Action => !!action && action.id === id)),
  );
