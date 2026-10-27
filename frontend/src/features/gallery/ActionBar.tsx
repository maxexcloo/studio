import { Fragment, type ComponentProps, type ReactNode } from "react";
import { ActionIcon, Divider, Menu, Paper, Tooltip, type PaperProps } from "@mantine/core";
import { Ellipsis, type LucideIcon } from "lucide-react";
import { usePhone } from "../../ui/usePhone";
import classes from "./ActionBar.module.css";

/** One media or selection action, shown as a menu item or an action bar icon. */
export interface Action {
  id: string;
  /** The menu label, and the bar icon's accessible name and tooltip. */
  label: string;
  icon: LucideIcon;
  /** A toggled-on action (Star): a filled icon, pressed state and the primary colour in bars. */
  pressed?: boolean;
  color?: "red";
  disabled?: boolean;
  loading?: boolean;
  /** Anchor attributes make the action a link (downloads). */
  link?: { href?: string; download?: string | boolean };
  onClick?: () => void;
  /** The menu stays open for actions that finish in place. */
  keepOpen?: boolean;
  /** The bar's own control, for an action with options of its own (Animate, Upscale). */
  control?: ReactNode;
}
/** Groups are separated by dividers, in menus and bars alike. */
export type ActionGroups = Action[][];

/** Bar icon props, shared with custom controls (Animate, Upscale); phones keep 40px targets. */
export function useActionIconProps() {
  const phone = usePhone();
  return {
    className: classes.action,
    variant: "subtle",
    color: "gray",
    size: phone ? 40 : undefined,
  } as const;
}

const shown = (groups: ActionGroups) => groups.filter((group) => group.length > 0);

/** The groups as Menu items; render inside a `Menu.Dropdown`. */
export function ActionMenuItems({ groups }: { groups: ActionGroups }) {
  return shown(groups).map((group, index) => (
    <Fragment key={group[0].id}>
      {index > 0 && <Menu.Divider />}
      {group.map(({ id, label, icon: Icon, pressed, color, disabled, link, onClick, keepOpen }) => (
        <Menu.Item
          key={id}
          h={36}
          color={color}
          leftSection={<Icon size={16} fill={pressed ? "currentColor" : "none"} />}
          disabled={disabled}
          closeMenuOnClick={!keepOpen}
          {...(link && !disabled ? { component: "a" as const, ...link } : { onClick })}
        >
          {label}
        </Menu.Item>
      ))}
    </Fragment>
  ));
}

function ActionControl({ action }: { action: Action }) {
  const phone = usePhone();
  const iconProps = useActionIconProps();
  if (action.control) return action.control;
  const { label, icon: Icon, pressed, color, disabled, loading, link, onClick } = action;
  const props = {
    ...iconProps,
    "aria-label": label,
    "aria-pressed": pressed,
    color: color || (pressed ? undefined : iconProps.color),
    loading,
    children: <Icon size={18} fill={pressed ? "currentColor" : "none"} />,
  } as const;
  return (
    <Tooltip label={label} disabled={phone}>
      {link ? (
        <ActionIcon
          component="a"
          {...link}
          {...props}
          aria-disabled={disabled}
          data-disabled={disabled || undefined}
          onClick={(event) => disabled && event.preventDefault()}
        />
      ) : (
        <ActionIcon {...props} disabled={disabled} onClick={onClick} />
      )}
    </Tooltip>
  );
}

/**
 * The action bar shared by the viewer and gallery selection: icon groups divided like the menu.
 * On phones, actions outside `phoneActions` move to a More menu in the same groups; `trailing`
 * follows a final divider (Cancel, Viewer Options).
 */
export function ActionBarGroups({
  groups,
  phoneActions,
  moreLabel = "More Actions",
  trailing,
}: {
  groups: ActionGroups;
  phoneActions?: string[];
  moreLabel?: string;
  trailing?: ReactNode;
}) {
  const phone = usePhone();
  const iconProps = useActionIconProps();
  const keep = (action: Action) => !phone || !phoneActions || phoneActions.includes(action.id);
  const bar = shown(groups.map((group) => group.filter(keep)));
  const overflow = shown(groups.map((group) => group.filter((action) => !keep(action))));
  return (
    <>
      {bar.map((group, index) => (
        <Fragment key={group[0].id}>
          {index > 0 && <Divider orientation="vertical" className={classes.divider} />}
          {group.map((action) => (
            <ActionControl key={action.id} action={action} />
          ))}
        </Fragment>
      ))}
      {overflow.length > 0 && (
        <Menu position="top-end" width={220}>
          <Menu.Target>
            <ActionIcon {...iconProps} aria-label={moreLabel}>
              <Ellipsis size={18} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <ActionMenuItems groups={overflow} />
          </Menu.Dropdown>
        </Menu>
      )}
      {trailing && (
        <>
          <Divider orientation="vertical" className={classes.divider} />
          {trailing}
        </>
      )}
    </>
  );
}

/** The bar's surface where it sits inline (the viewer); the gallery's floats in Mantine's ActionBar. */
export function ActionBarSurface(
  props: PaperProps & ComponentProps<"div"> & { "aria-label": string },
) {
  return (
    <Paper role="group" withBorder radius="xl" shadow="lg" className={actionBarClass} {...props} />
  );
}
/** The surface layout both bars share. */
export const actionBarClass = classes.bar;
