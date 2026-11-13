import { Fragment, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import {
  ActionIcon,
  Button,
  Collapse,
  Divider,
  Menu,
  Paper,
  SegmentedControl,
  Switch,
  Text,
  Tooltip,
  type FloatingPosition,
  type PaperProps,
} from "@mantine/core";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { menuWidth } from "../theme";
import { icons } from "./icons";
import { usePhone, useTouch } from "./usePhone";
import classes from "./ActionBar.module.css";

/** One media or selection action, shown as a menu item or an action bar control. */
export interface Action {
  id: string;
  /** The menu label, and the bar control's accessible name and tooltip. */
  label: string;
  /** One short line under its menu label, for what the label can't say (why it can't run). */
  description?: string;
  /** Every bar action has one; a menu option may go without (a suggested change). */
  icon?: LucideIcon;
  /**
   * A bar's main choice, such as Dream's Pass and Like: when labelled, a full-size round button in
   * this variant, at the bar's ends around the smaller icons.
   */
  emphasis?: "default" | "filled";
  /** A toggled-on action (Star): a filled icon, pressed state and the primary colour in bars. */
  pressed?: boolean;
  /** An on/off option: a checked menu item (Show Upscale), or with `keepOpen` a switch row. */
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
  /** A setting between a few values (Cloud, Fast or Quality), a segmented control in menus. */
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

// A control with options is wider than a plain icon: it carries a ▾.
const width = (action: Action) => (hasOptions(action) && action.icon !== icons.more ? 1.5 : 1);

/**
 * A phone bar on one row: the `kept` actions in their groups, the last ending with ⋯ More, which
 * holds the rest in their groups while it has any. With `room` (in plain icons) every action shows
 * while they all fit; past it the `kept` ones, then the others in order while they fit beside More.
 */
export function withMore(groups: ActionGroups, kept: string[], room = 0): ActionGroups {
  const all = shown(groups).flat();
  const used = (actions: Action[]) => actions.reduce((sum, action) => sum + width(action), 0);
  const keep = new Set(kept);
  if (room && used(all) <= room) all.forEach((action) => keep.add(action.id));
  else if (room) {
    let taken = 1 + used(all.filter((action) => keep.has(action.id)));
    for (const action of all)
      if (!keep.has(action.id) && taken + width(action) <= room) {
        keep.add(action.id);
        taken += width(action);
      }
  }
  const bar = shown(groups.map((group) => group.filter((action) => keep.has(action.id))));
  const more = groups.map((group) => group.filter((action) => !keep.has(action.id)));
  if (!more.some((group) => group.length)) return bar;
  const button: Action = { id: "more", label: "More", icon: icons.more, menu: more };
  return bar.length ? [...bar.slice(0, -1), [...bar[bar.length - 1], button]] : [[button]];
}

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
 * menu open (Review Prompt, Face Detail).
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
 * A menu item's label with its one-line description, if any, under it; the label stays its
 * accessible name and the description describes it.
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
            </div>
          );
        if (action.menu && inline) {
          const open = expanded === id;
          return (
            <Fragment key={id}>
              <Menu.Item
                color={color}
                leftSection={Icon && <Icon size={16} />}
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
                  leftSection={Icon && <Icon size={16} />}
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
            leftSection={Icon && <Icon size={16} fill={pressed ? "currentColor" : "none"} />}
            rightSection={
              isSetting(action) ? (
                // The row is the control; the switch only shows its state.
                <Switch
                  size="xs"
                  checked={checked}
                  disabled={disabled}
                  readOnly
                  tabIndex={-1}
                  aria-hidden
                  className={classes.switch}
                />
              ) : checked ? (
                <Check size={14} />
              ) : undefined
            }
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
  const dropdown = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Menu
      position={position}
      width={menuWidth}
      // An option that moves focus itself (AI's Custom… to the prompt) keeps it; otherwise it
      // returns to the control that opened the menu.
      returnFocus={false}
      onClose={() =>
        setTimeout(() => {
          if (!document.activeElement || document.activeElement === document.body)
            opener.current?.focus({ preventScroll: true });
        })
      }
      onChange={(open) => {
        setOpened(open);
        // The closing menu lets go of focus at once rather than at the end of its transition: an
        // option that turns its control busy disables it, so focus can't return there, and keys
        // meanwhile would land in the fading menu instead of the page around it.
        const focused = document.activeElement;
        if (!open && focused instanceof HTMLElement && dropdown.current?.contains(focused))
          focused.blur();
      }}
      onOpen={() => {
        opener.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setOpening((count) => count + 1);
      }}
    >
      {target(opened)}
      <Menu.Dropdown ref={dropdown}>
        {note(action)}
        <ActionMenuItems key={opening} groups={action.menu!} />
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * A bar action: an icon with a tooltip, or `labelled` its name beside its icon. A control with
 * options shows ▾, except ⋯ More, and opens them on click.
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
  // ⋯ already says it holds more, so it carries no ▾.
  const chevron = options && Icon !== icons.more;
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
  const icon = Icon && <Icon size={labelled ? 16 : 18} fill={pressed ? "currentColor" : "none"} />;
  const emphasis = action.emphasis && { variant: action.emphasis, color: undefined, radius: "xl" };
  const control = labelled ? (
    <Button
      size={emphasis ? undefined : "sm"}
      leftSection={icon}
      rightSection={chevron ? <ChevronDown size={14} /> : undefined}
      {...props}
      {...emphasis}
    >
      {label}
    </Button>
  ) : chevron ? (
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
  compact = false,
}: {
  groups: ActionGroups;
  labelled?: string[];
  menuPosition?: FloatingPosition;
  wrap?: boolean;
  /** Fits every action across the row at a smaller size (the phone viewer's bar). */
  compact?: boolean;
}) {
  return (
    <div
      className={classes.actions}
      data-wrap={wrap || undefined}
      data-compact={compact || undefined}
    >
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
