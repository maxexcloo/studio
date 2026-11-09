import { Fragment, useId, useState, type ComponentProps, type ReactNode } from "react";
import {
  ActionIcon,
  Button,
  Collapse,
  Divider,
  Menu,
  Paper,
  SegmentedControl,
  Text,
  Tooltip,
  type FloatingPosition,
  type PaperProps,
} from "@mantine/core";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { menuWidth } from "../../theme";
import { usePhone, useTouch } from "../../ui/usePhone";
import classes from "./ActionBar.module.css";

/** One media or selection action, shown as a menu item or an action bar control. */
export interface Action {
  id: string;
  /** The menu label, and the bar control's accessible name and tooltip. */
  label: string;
  /** A short line under its menu label saying what it does. */
  description?: string;
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
   * Its options: a click opens them (a submenu in menus, expanded in place on touch screens), and the
   * first is its usual action, so a control with options has no click of its own.
   */
  menu?: ActionGroups;
  /** A setting between a few values (Fast or Quality), a segmented control in menus. */
  choice?: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  };
  /** Why nothing in its options can run, above them. */
  note?: string;
}
/** Groups are separated by dividers, in menus and bars alike. */
export type ActionGroups = Action[][];

const shown = (groups: ActionGroups) => groups.filter((group) => group.length > 0);
const hasOptions = (action: Action) => Boolean(action.menu && shown(action.menu).length);

/** The action with this id in the groups or any of their options, for keyboard shortcuts. */
export function findAction(groups: ActionGroups, id: string): Action | undefined {
  for (const action of groups.flat()) {
    if (action.id === id) return action;
    const nested = action.menu && findAction(action.menu, id);
    if (nested) return nested;
  }
}

/**
 * A menu's setting rather than an action: a segmented choice, or an on/off option that keeps the
 * menu open (Review Prompt First, Face Detail).
 */
const isSetting = (action: Action) =>
  Boolean(action.choice || (action.keepOpen && action.checked !== undefined));

/** What clicking the action does: its own click, or with options the first that isn't a setting. */
export const usualAction = (action: Action): Action | undefined =>
  action.menu ? action.menu.flat().find((option) => !isSetting(option)) : action;

const note = (action: Action) =>
  action.note && (
    <Menu.Label fw={400} maw={menuWidth}>
      {action.note}
    </Menu.Label>
  );

/**
 * A menu item's label with its description, if any, under it; the label stays its accessible name
 * and the description describes it.
 */
const itemLabel = ({ label, description }: Action, describedBy: string) =>
  description ? (
    <>
      {label}
      <Text id={describedBy} size="xs" c="dimmed">
        {description}
      </Text>
    </>
  ) : (
    label
  );
const described = ({ label, description }: Action, describedBy: string) =>
  description ? { "aria-label": label, "aria-describedby": describedBy } : {};

/**
 * The groups as Menu items; render inside a `Menu.Dropdown`. Options open as a submenu, or on
 * phones and touch screens expand in place under their item, never as a second floating layer.
 */
export function ActionMenuItems({ groups }: { groups: ActionGroups }) {
  const phone = usePhone();
  const touch = useTouch();
  const inline = phone || touch;
  const [expanded, setExpanded] = useState<string | null>(null);
  const uid = useId();
  return shown(groups).map((group, index) => (
    <Fragment key={group[0].id}>
      {index > 0 && <Menu.Divider />}
      {group.map((action) => {
        const { id, label, icon: Icon, pressed, checked, color, disabled, link, onClick } = action;
        const describedBy = `${uid}-${id}`;
        if (action.choice)
          return (
            <div key={id} className={classes.choice}>
              <SegmentedControl
                size="xs"
                fullWidth
                aria-label={label}
                disabled={disabled}
                value={action.choice.value}
                onChange={action.choice.onChange}
                data={action.choice.options}
              />
              {action.description && (
                <Text size="xs" c="dimmed" mt={4} px={4}>
                  {action.description}
                </Text>
              )}
            </div>
          );
        if (action.menu && inline) {
          const open = expanded === id;
          return (
            <Fragment key={id}>
              <Menu.Item
                color={color}
                leftSection={<Icon size={16} />}
                rightSection={<ChevronDown size={14} className={classes.expand} />}
                aria-expanded={open}
                {...described(action, describedBy)}
                data-expanded={open || undefined}
                disabled={disabled}
                closeMenuOnClick={false}
                onClick={() => setExpanded(open ? null : id)}
              >
                {itemLabel(action, describedBy)}
              </Menu.Item>
              {/* Unmounted when closed, so arrow keys skip the hidden options. */}
              <Collapse expanded={open} keepMounted={false}>
                <div role="group" aria-label={label} className={classes.inline}>
                  {note(action)}
                  <ActionMenuItems groups={action.menu} />
                </div>
              </Collapse>
            </Fragment>
          );
        }
        if (action.menu)
          return (
            <Menu.Sub key={id} position="right-start">
              <Menu.Sub.Target>
                <Menu.Sub.Item
                  color={color}
                  leftSection={<Icon size={16} />}
                  disabled={disabled}
                  {...described(action, describedBy)}
                >
                  {itemLabel(action, describedBy)}
                </Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown w={menuWidth}>
                {note(action)}
                <ActionMenuItems groups={action.menu} />
              </Menu.Sub.Dropdown>
            </Menu.Sub>
          );
        return (
          <Menu.Item
            key={id}
            color={color}
            leftSection={<Icon size={16} fill={pressed ? "currentColor" : "none"} />}
            rightSection={checked ? <Check size={14} /> : undefined}
            role={checked === undefined ? undefined : "menuitemcheckbox"}
            aria-checked={checked}
            {...described(action, describedBy)}
            disabled={disabled}
            closeMenuOnClick={!action.keepOpen}
            {...(link && !disabled ? { component: "a" as const, ...link } : { onClick })}
          >
            {itemLabel(action, describedBy)}
          </Menu.Item>
        );
      })}
    </Fragment>
  ));
}

/** A control's options as a menu opening on the `position` side; the tooltip never lingers over it. */
function OptionsMenu({
  action,
  position,
  target,
}: {
  action: Action;
  position: FloatingPosition;
  target: (opened: boolean) => ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  // Each opening starts with every option collapsed.
  const [opening, setOpening] = useState(0);
  return (
    <Menu
      position={position}
      width={menuWidth}
      onChange={setOpened}
      onOpen={() => setOpening((count) => count + 1)}
    >
      {target(opened)}
      <Menu.Dropdown>
        {note(action)}
        <ActionMenuItems key={opening} groups={action.menu!} />
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * A bar action: an icon with a tooltip, or `labelled` its name beside its icon. A control with
 * options shows ▾ and opens them on click.
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
  const { label, icon: Icon, pressed, color, disabled, loading, link, onClick } = action;
  const options = hasOptions(action);
  const props = {
    className: classes.action,
    variant: "subtle",
    color: color || (pressed ? undefined : "gray"),
    "aria-pressed": pressed,
    loading,
    disabled,
    ...(options
      ? {}
      : link
        ? { component: "a" as const, ...(disabled ? { download: link.download } : link) }
        : { onClick }),
  } as const;
  const icon = <Icon size={labelled ? 16 : 18} fill={pressed ? "currentColor" : "none"} />;
  const control = labelled ? (
    <Button
      size="sm"
      leftSection={icon}
      rightSection={options ? <ChevronDown size={14} /> : undefined}
      {...props}
    >
      {label}
    </Button>
  ) : options ? (
    // The icon with a small ▾, as round as the plain icons beside it.
    <Button
      size="sm"
      radius="xl"
      aria-label={label}
      rightSection={<ChevronDown size={12} />}
      classNames={{ root: classes.options, section: classes.chevron }}
      {...props}
    >
      {icon}
    </Button>
  ) : (
    <ActionIcon aria-label={label} {...props}>
      {icon}
    </ActionIcon>
  );
  const tip = (opened: boolean, target: ReactNode) => (
    <Tooltip label={label} disabled={labelled || opened}>
      {target}
    </Tooltip>
  );
  if (!options) return tip(false, control);
  return (
    <OptionsMenu
      action={action}
      position={menuPosition}
      target={(opened) => tip(opened, <Menu.Target>{control}</Menu.Target>)}
    />
  );
}

/**
 * The action bar shared by the viewer and gallery selection: icon controls in divided groups; the
 * `labelled` ones show their names. Controls that overflow scroll sideways, or `wrap` onto another
 * row a whole group at a time, spaced apart rather than divided so no divider ends a row. Menus
 * open above it unless `menuPosition` says otherwise.
 */
export function ActionBarGroups({
  groups,
  labelled = [],
  menuPosition = "top",
  wrap = false,
}: {
  groups: ActionGroups;
  labelled?: string[];
  menuPosition?: FloatingPosition;
  wrap?: boolean;
}) {
  return (
    <div className={classes.actions} data-wrap={wrap || undefined}>
      {shown(groups).map((group, index) => {
        const controls = group.map((action) => (
          <ActionControl
            key={action.id}
            action={action}
            labelled={labelled.includes(action.id)}
            menuPosition={menuPosition}
          />
        ));
        return wrap ? (
          <div key={group[0].id} className={classes.group}>
            {controls}
          </div>
        ) : (
          <Fragment key={group[0].id}>
            {index > 0 && <Divider orientation="vertical" className={classes.divider} />}
            {controls}
          </Fragment>
        );
      })}
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
