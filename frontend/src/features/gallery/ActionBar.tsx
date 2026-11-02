import { Fragment, useState, type ComponentProps, type ReactNode } from "react";
import {
  ActionIcon,
  Button,
  Divider,
  Loader,
  Menu,
  Paper,
  Tooltip,
  UnstyledButton,
  type FloatingPosition,
  type PaperProps,
} from "@mantine/core";
import { Check, ChevronDown, Ellipsis, type LucideIcon } from "lucide-react";
import { usePhone } from "../../ui/usePhone";
import classes from "./ActionBar.module.css";

/** One media or selection action, shown as a menu item or an action bar control. */
export interface Action {
  id: string;
  /** The menu label, and the bar control's accessible name and tooltip. */
  label: string;
  icon: LucideIcon;
  /** A toggled-on action (Star): a filled icon, pressed state and the primary colour in bars. */
  pressed?: boolean;
  /** An on/off option (Show Upscale): a checked menu item. */
  checked?: boolean;
  color?: "red";
  disabled?: boolean;
  loading?: boolean;
  /** Anchor attributes make the action a link (downloads). */
  link?: { href?: string; download?: string | boolean };
  onClick?: () => void;
  /** The menu stays open for actions that finish in place. */
  keepOpen?: boolean;
  /**
   * Its options: a submenu in menus. In bars, with `onClick` a split button whose chevron opens
   * them (Prompt ▾, Copy ▾); without, the icon opens them (Animate).
   */
  menu?: ActionGroups;
  /** A line above the options, such as the model Animate runs on. */
  note?: string;
}
/** Groups are separated by dividers, in menus and bars alike. */
export type ActionGroups = Action[][];

/** Bar icon props; phones keep 40px targets. */
function useActionIconProps() {
  const phone = usePhone();
  return {
    className: classes.action,
    variant: "subtle",
    color: "gray",
    size: phone ? 40 : undefined,
  } as const;
}

const shown = (groups: ActionGroups) => groups.filter((group) => group.length > 0);

/** The action with this id in the groups or any of their options, for keyboard shortcuts. */
export function findAction(groups: ActionGroups, id: string): Action | undefined {
  for (const action of groups.flat()) {
    if (action.id === id) return action;
    const nested = action.menu && findAction(action.menu, id);
    if (nested) return nested;
  }
}

/** The groups as Menu items, options as submenus; render inside a `Menu.Dropdown`. */
export function ActionMenuItems({ groups }: { groups: ActionGroups }) {
  // Phones have no room beside the menu, so options open below their item.
  const phone = usePhone();
  return shown(groups).map((group, index) => (
    <Fragment key={group[0].id}>
      {index > 0 && <Menu.Divider />}
      {group.map((action) => {
        const { id, label, icon: Icon, pressed, checked, color, disabled, link, onClick } = action;
        if (action.menu)
          return (
            <Menu.Sub key={id} position={phone ? "bottom-start" : "right-start"}>
              <Menu.Sub.Target>
                <Menu.Sub.Item
                  h={36}
                  color={color}
                  leftSection={<Icon size={16} />}
                  disabled={disabled}
                >
                  {label}
                </Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown miw={200}>
                {action.note && <Menu.Label fw={400}>{action.note}</Menu.Label>}
                <ActionMenuItems groups={action.menu} />
              </Menu.Sub.Dropdown>
            </Menu.Sub>
          );
        return (
          <Menu.Item
            key={id}
            h={36}
            color={color}
            leftSection={<Icon size={16} fill={pressed ? "currentColor" : "none"} />}
            rightSection={checked ? <Check size={14} /> : undefined}
            role={checked === undefined ? undefined : "menuitemcheckbox"}
            aria-checked={checked}
            disabled={disabled}
            closeMenuOnClick={!action.keepOpen}
            {...(link && !disabled ? { component: "a" as const, ...link } : { onClick })}
          >
            {label}
          </Menu.Item>
        );
      })}
    </Fragment>
  ));
}

/**
 * A bar action: an icon, a split button or an options menu, opening on the `menuPosition` side.
 * A `labelled` one names itself beside its icon, with ▾ when it only opens options.
 */
function ActionControl({
  action,
  labelled,
  menuPosition,
}: {
  action: Action;
  labelled: boolean;
  menuPosition: FloatingPosition;
}) {
  const phone = usePhone();
  const iconProps = useActionIconProps();
  // A tooltip must not linger behind the menu its control opened.
  const [opened, setOpened] = useState(false);
  const { label, icon: Icon, pressed, color, disabled, loading, link, onClick, menu } = action;
  const optionsOnly = Boolean(menu && !onClick && !link);
  const props = {
    "aria-pressed": pressed,
    color: color || (pressed ? undefined : iconProps.color),
    loading,
    disabled,
    ...(link
      ? { component: "a" as const, ...(disabled ? { download: link.download } : link) }
      : { onClick: optionsOnly ? undefined : onClick }),
  };
  const control = labelled ? (
    <Button
      variant="subtle"
      size="sm"
      className={classes.action}
      leftSection={<Icon size={16} fill={pressed ? "currentColor" : "none"} />}
      rightSection={optionsOnly ? <ChevronDown size={14} /> : undefined}
      {...props}
    >
      {label}
    </Button>
  ) : (
    <ActionIcon {...iconProps} aria-label={label} {...props}>
      <Icon size={18} fill={pressed ? "currentColor" : "none"} />
    </ActionIcon>
  );
  const tip = (name: string, target: ReactNode) => (
    <Tooltip label={name} disabled={phone || opened || (labelled && name === label)}>
      {target}
    </Tooltip>
  );
  if (!menu) return tip(label, control);
  const dropdown = (
    <Menu.Dropdown>
      {action.note && <Menu.Label fw={400}>{action.note}</Menu.Label>}
      <ActionMenuItems groups={menu} />
    </Menu.Dropdown>
  );
  // A link with options (Download ▾) is a split button like one with a click.
  if (optionsOnly)
    return (
      <Menu position={menuPosition} width={240} onChange={setOpened}>
        {tip(label, <Menu.Target>{control}</Menu.Target>)}
        {dropdown}
      </Menu>
    );
  return (
    <ActionIcon.Group>
      {tip(label, control)}
      <Menu position={menuPosition} width={220} onChange={setOpened}>
        {tip(
          `${label} Options`,
          <Menu.Target>
            <ActionIcon
              {...iconProps}
              className={`${iconProps.className} ${classes.splitMenu}`}
              aria-label={`${label} Options`}
              disabled={disabled}
            >
              <ChevronDown size={14} />
            </ActionIcon>
          </Menu.Target>,
        )}
        {dropdown}
      </Menu>
    </ActionIcon.Group>
  );
}

/**
 * The action bar shared by the viewer and gallery selection: icon controls in divided groups,
 * scrolling sideways when they overflow; the `labelled` ones (the viewer's primaries) show their
 * names. Menus open above it unless `menuPosition` says otherwise.
 */
export function ActionBarGroups({
  groups,
  labelled = [],
  menuPosition = "top",
}: {
  groups: ActionGroups;
  labelled?: string[];
  menuPosition?: FloatingPosition;
}) {
  return (
    <div className={classes.actions}>
      {shown(groups).map((group, index) => (
        <Fragment key={group[0].id}>
          {index > 0 && <Divider orientation="vertical" className={classes.divider} />}
          {group.map((action) => (
            <ActionControl
              key={action.id}
              action={action}
              labelled={labelled.includes(action.id)}
              menuPosition={menuPosition}
            />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * A phone bar control: its icon over its label. With options a tap opens them (their first item does
 * what a desktop click does), so no separate ▾ crowds the bar; a link with options keeps a ▾ beside it.
 */
function StackedControl({ action }: { action: Action }) {
  const { label, icon: Icon, pressed, color, disabled, loading, link, onClick, menu } = action;
  const content = (
    <>
      {loading ? (
        <Loader size={20} color="gray" />
      ) : (
        <Icon size={20} fill={pressed ? "currentColor" : "none"} />
      )}
      <span>{label}</span>
    </>
  );
  const props = {
    className: classes.stacked,
    "aria-pressed": pressed,
    "data-color": color,
    disabled: disabled || loading,
  };
  const options = menu && shown(menu).length > 0 ? menu : undefined;
  const dropdown = options && (
    <Menu.Dropdown>
      {action.note && <Menu.Label fw={400}>{action.note}</Menu.Label>}
      <ActionMenuItems groups={options} />
    </Menu.Dropdown>
  );
  if (options && !link)
    return (
      <Menu position="top" width={240}>
        <Menu.Target>
          <UnstyledButton {...props}>{content}</UnstyledButton>
        </Menu.Target>
        {dropdown}
      </Menu>
    );
  const button =
    link && !disabled ? (
      <UnstyledButton component="a" {...props} {...link}>
        {content}
      </UnstyledButton>
    ) : (
      <UnstyledButton {...props} onClick={onClick}>
        {content}
      </UnstyledButton>
    );
  if (!options) return button;
  return (
    <div className={classes.stackedSplit}>
      {button}
      <Menu position="top" width={240}>
        <Menu.Target>
          <UnstyledButton
            className={classes.stackedMenu}
            aria-label={`${label} Options`}
            disabled={disabled}
          >
            <ChevronDown size={14} />
          </UnstyledButton>
        </Menu.Target>
        {dropdown}
      </Menu>
    </div>
  );
}

/** The phone bar: the primary actions labelled under their icons, every other one under More. */
export function StackedActionBar({ primary, more }: { primary: Action[]; more: ActionGroups }) {
  return (
    <div className={classes.stackedBar}>
      {primary.map((action) => (
        <StackedControl key={action.id} action={action} />
      ))}
      {shown(more).length > 0 && (
        <StackedControl action={{ id: "more", label: "More", icon: Ellipsis, menu: more }} />
      )}
    </div>
  );
}

/** The viewer's floating bar surface. */
export function ActionBarSurface({
  className,
  ...props
}: PaperProps & ComponentProps<"div"> & { "aria-label": string }) {
  return (
    <Paper
      role="group"
      withBorder
      radius="xl"
      shadow="lg"
      className={`${classes.bar} ${className ?? ""}`}
      {...props}
    />
  );
}
