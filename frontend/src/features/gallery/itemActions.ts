import type { Action, ActionGroups } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";

const definitions = {
  ai: { label: "AI", icon: icons.assistant },
  animate: { label: "Animate", icon: icons.animate },
  delete: { label: "Delete", icon: icons.delete, color: "red" as const },
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
// Retry and Stop lead for unfinished work and running upscales; Like comes before Dislike and
// Delete last.
const assist: ItemActionId[] = ["ai", "share"];
const rating: ItemActionId[] = ["like", "dislike"];
const others: ItemActionId[] = ["report", "delete"];
/** Bars and menus: Animate, Edit, Recreate, Upscale | AI, Share | Like, Dislike | Report, Delete. */
const sections: ItemActionId[][] = [["retry", "stop", ...menus], assist, rating, others];
/** Bars name Retry, Stop and the four menus; the rest are icons. */
export const namedItemActions: string[] = ["retry", "stop", ...menus];

/** A pressed Like reads Unlike; a pressed Dislike reads Restore. */
const pressedLabels: Partial<Record<ItemActionId, string>> = { dislike: "Restore", like: "Unlike" };
/** The label of a rating action, pressed or not. */
export const ratingLabel = (id: "dislike" | "like", pressed: boolean) =>
  (pressed && pressedLabels[id]) || definitions[id].label;

/** An item action with its shared label and icon; a pressed rating takes its pressed label. */
export const itemAction = (id: ItemActionId, action: Partial<Action> = {}): Action => ({
  id,
  ...definitions[id],
  label: (action.pressed && pressedLabels[id]) || definitions[id].label,
  ...action,
});
/** Places actions in the bar's and menus' sections and order; absent ones are left out. */
export const itemActionGroups = (actions: (Action | null | false | undefined)[]): ActionGroups =>
  sections.map((ids) =>
    ids.flatMap((id) => actions.filter((action): action is Action => !!action && action.id === id)),
  );

/** Phone viewers keep correction under Edit. */
export function compactViewerActions(groups: ActionGroups): ActionGroups {
  const actions = groups.flat();
  const destinations = new Map([["report", "edit"]]);
  const nested = actions.filter((action) =>
    actions.some((owner) => owner.id === destinations.get(action.id) && owner.menu),
  );
  return groups.map((group) =>
    group
      .filter((action) => !nested.includes(action))
      .map((action) => {
        const extra = nested.filter((child) => destinations.get(child.id) === action.id);
        if (!extra.length) return action;
        return {
          ...action,
          menu: [...action.menu!.slice(0, -1), extra, ...action.menu!.slice(-1)],
        };
      }),
  );
}
