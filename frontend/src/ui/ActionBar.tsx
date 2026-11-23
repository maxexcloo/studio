import {
  ActionIcon,
  Button,
  Divider,
  type FloatingPosition,
  Loader,
  Menu,
  Paper,
  type PaperProps,
  SegmentedControl,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import { Check, ChevronDown, ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import {
  type ComponentProps,
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { menuWidth, popupMiddlewares } from "../theme";
import { icons } from "./icons";
import { PopupTooltip } from "./PopupTooltip";
import { useVisibleRect } from "./useKeyboard";
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
  /** A toggled-on action (Like): a filled icon, pressed state and the primary colour in bars. */
  pressed?: boolean;
  /** An on/off option: a checked menu item (Show Upscale), or with `keepOpen` a switch row. */
  checked?: boolean;
  /** The choice in a single-selection submenu. */
  selected?: boolean;
  color?: "red";
  disabled?: boolean;
  loading?: boolean;
  /** Anchor attributes make the action a link (downloads). */
  link?: { href?: string; download?: string | boolean };
  onClick?: () => void;
  /** The menu stays open for actions that finish in place. */
  keepOpen?: boolean;
  /**
   * Its options: a click opens them. The first is its usual action,
   * so a control with options has no click of its own.
   */
  menu?: ActionGroups;
  /** A setting between a few values (Cloud or Local), a segmented control in menus. */
  choice?: {
    showLabel?: boolean;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  };
  /** Why nothing in its options can run, above them. */
  note?: string;
  /** Names its group in menus (Templates, Suggestions) rather than acting. */
  heading?: boolean;
  /** Runs as its options show, so they load only when wanted (an item's suggestions). */
  onOpen?: () => void;
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
 * menu open (Review Prompt, Face Detail).
 */
const isSetting = (action: Action) =>
  Boolean(
    action.choice ||
    (action.keepOpen && action.checked !== undefined) ||
    action.menu?.some((group) => group.some((option) => option.selected !== undefined)),
  );

/** What clicking the action does: its own click, or with options the first that isn't a setting. */
export const usualAction = (action: Action): Action | undefined =>
  action.menu ? action.menu.flat().find((option) => !isSetting(option) && !option.heading) : action;

const note = (action: Action) => (
  <>
    {action.onOpen && <Opened onOpen={action.onOpen} />}
    {action.note && (
      <Menu.Label fw={400} maw={menuWidth}>
        {action.note}
      </Menu.Label>
    )}
  </>
);

/** Tells an action its options are showing; they mount only while open. */
function Opened({ onOpen }: { onOpen: () => void }) {
  useEffect(onOpen, []);
  return null;
}

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

function useSideMenus() {
  const phone = usePhone();
  const touch = useTouch();
  return !phone && !touch;
}

/** The groups as Menu items. Render inside a Menu.Dropdown. */
export function ActionMenuItems({
  groups,
  leading,
}: {
  groups: ActionGroups;
  leading?: ReactNode;
}) {
  const sideMenus = useSideMenus();
  const [path, setPath] = useState<string[]>([]);
  const focus = useRef<string | null>(null);
  const uid = useId();
  const levels: Action[] = [];
  let items = groups;
  if (!sideMenus)
    for (const id of path) {
      const branch = items.flat().find((item) => item.id === id);
      if (!branch?.menu) break;
      levels.push(branch);
      items = branch.menu;
    }
  const level = levels.at(-1);
  const backId = `${uid}-back`;
  const goBack = () => {
    if (!level) return;
    if (document.activeElement?.closest("[data-menu-dropdown]"))
      focus.current = `${uid}-${level.id}`;
    setPath(path.slice(0, levels.length - 1));
  };
  useLayoutEffect(() => {
    if (!focus.current) return;
    document.getElementById(focus.current)?.focus();
    focus.current = null;
  }, [path]);
  const rows = (
    <MenuRows
      groups={items}
      uid={uid}
      onSelected={level ? goBack : undefined}
      drill={
        sideMenus
          ? undefined
          : (id, keyboard) => {
              const active = document.activeElement;
              if (keyboard || active?.closest("[data-menu-dropdown]")) focus.current = backId;
              setPath([...path.slice(0, levels.length), id]);
            }
      }
    />
  );
  if (!level)
    return (
      <>
        {leading}
        {rows}
      </>
    );
  return (
    <div className={classes.menuPage}>
      <Menu.Item
        id={backId}
        aria-label="Back"
        leftSection={<ChevronLeft size={16} />}
        rightSection={
          <Text size="xs" c="dimmed" truncate className={classes.menuTitle}>
            {level.label}
          </Text>
        }
        closeMenuOnClick={false}
        onClick={goBack}
      >
        Back
      </Menu.Item>
      <Menu.Divider />
      <div role="group" aria-label={level.label} className={classes.menuOptions} key={level.id}>
        {note(level)}
        {rows}
      </div>
    </div>
  );
}

function MenuRows({
  groups,
  uid,
  drill,
  onSelected,
}: {
  groups: ActionGroups;
  uid: string;
  drill?: (id: string, keyboard: boolean) => void;
  onSelected?: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const selectionTrigger = useRef<HTMLButtonElement>(null);
  const closeSelection = () => {
    setExpanded(null);
    selectionTrigger.current?.focus();
  };
  const childUid = useId();
  return shown(groups).map((group, index) => (
    <Fragment key={group[0].id}>
      {index > 0 && <Menu.Divider />}
      {group.map((action) => {
        const {
          id,
          label,
          icon: Icon,
          pressed,
          checked,
          selected,
          color,
          disabled,
          link,
          onClick,
        } = action;
        const describedBy = `${uid}-${id}-description`;
        const radioMenu = action.menu?.some((group) =>
          group.some((option) => option.selected !== undefined),
        );
        if (action.heading) return <Menu.Label key={id}>{label}</Menu.Label>;
        if (action.choice)
          return (
            <Fragment key={id}>
              {action.choice.showLabel && <Menu.Label>{label}</Menu.Label>}
              <div className={classes.choice}>
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
            </Fragment>
          );
        if (action.menu && !action.loading) {
          const open = expanded === id;
          const trigger = {
            color,
            leftSection: Icon && <Icon size={16} />,
            disabled,
            ref: radioMenu ? selectionTrigger : undefined,
            ...described(action, describedBy),
          };
          if (!drill) {
            const leaf = !action.menu.some((group) => group.some((option) => option.menu));
            return (
              <Menu.Sub
                key={id}
                opened={open}
                openDelay={100}
                onChange={(next) =>
                  setExpanded((previous) => (next ? id : previous === id ? null : previous))
                }
                middlewares={
                  leaf ? { ...popupMiddlewares, size: { padding: 12 } } : popupMiddlewares
                }
              >
                <Menu.Sub.Target>
                  <Menu.Sub.Item
                    {...trigger}
                    onClick={(event) => {
                      setExpanded(id);
                      if (event.detail !== 0) return;
                      const target = event.currentTarget;
                      requestAnimationFrame(() => {
                        const controls = target.getAttribute("aria-controls");
                        if (controls)
                          document
                            .getElementById(controls)
                            ?.querySelector<HTMLElement>("[data-menu-item]:not([data-disabled])")
                            ?.focus();
                      });
                    }}
                  >
                    {itemLabel(action, describedBy)}
                  </Menu.Sub.Item>
                </Menu.Sub.Target>
                <Menu.Sub.Dropdown
                  data-action-submenu
                  w={menuWidth}
                  style={leaf ? { overflowY: "auto", overscrollBehavior: "contain" } : undefined}
                >
                  <div role="group" aria-label={label}>
                    {note(action)}
                    <MenuRows
                      groups={action.menu}
                      uid={`${childUid}-${id}`}
                      onSelected={radioMenu ? closeSelection : undefined}
                    />
                  </div>
                </Menu.Sub.Dropdown>
              </Menu.Sub>
            );
          }
          return (
            <Menu.Item
              key={id}
              {...trigger}
              id={`${uid}-${id}`}
              rightSection={<ChevronRight size={14} />}
              aria-haspopup="menu"
              aria-expanded={false}
              closeMenuOnClick={false}
              onClick={(event) => drill(id, event.detail === 0)}
            >
              {itemLabel(action, describedBy)}
            </Menu.Item>
          );
        }
        return (
          <Menu.Item
            key={id}
            color={color}
            leftSection={
              action.loading ? (
                <Loader size={14} />
              ) : (
                Icon && <Icon size={16} fill={pressed ? "currentColor" : "none"} />
              )
            }
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
              ) : checked || selected ? (
                <Check size={14} />
              ) : undefined
            }
            role={checked === undefined ? undefined : "menuitemcheckbox"}
            renderRoot={
              selected === undefined
                ? undefined
                : (props) => <button {...props} role="menuitemradio" />
            }
            aria-checked={selected ?? checked}
            aria-busy={action.loading || undefined}
            {...described(action, describedBy)}
            disabled={disabled}
            closeMenuOnClick={!action.keepOpen}
            {...(link && !disabled
              ? { component: "a" as const, ...link }
              : {
                  onClick:
                    selected === undefined || !onSelected
                      ? onClick
                      : () => {
                          onClick?.();
                          onSelected();
                        },
                })}
          >
            {itemLabel(action, describedBy)}
          </Menu.Item>
        );
      })}
    </Fragment>
  ));
}

/** Phone action menus follow the visible room as the keyboard or browser chrome moves. */
export function useActionMenuBounds(opened: boolean, nested = true) {
  const sideMenus = useSideMenus();
  const visible = useVisibleRect(!sideMenus && opened);
  if (sideMenus)
    return nested
      ? { middlewares: popupMiddlewares, styles: { dropdown: { overflowY: "visible" as const } } }
      : {};
  const bounds = { padding: 12, rootBoundary: visible ?? ("viewport" as const) };
  return {
    middlewares: { flip: bounds, shift: { ...bounds, crossAxis: true }, size: bounds },
    preventPositionChangeWhenVisible: false,
  };
}

/** A control's options as a menu opening on the `position` side; the tooltip never lingers over it. */
function OptionsMenu({
  action,
  position,
  target,
}: {
  action: Action;
  position: FloatingPosition;
  target: ReactNode;
}) {
  // Each opening starts at the top level.
  const [opening, setOpening] = useState(0);
  const [opened, setOpened] = useState(false);
  const bounds = useActionMenuBounds(opened);
  const dropdown = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Menu
      {...bounds}
      position={position}
      width={menuWidth}
      // An option that moves focus itself (a Custom… dialog) keeps it; otherwise it
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
        action.onOpen?.();
        setOpening((count) => count + 1);
      }}
    >
      {target}
      <Menu.Dropdown ref={dropdown}>
        <ActionMenuItems
          key={opening}
          groups={action.menu!}
          leading={
            action.note && (
              <Menu.Label fw={400} maw={menuWidth}>
                {action.note}
              </Menu.Label>
            )
          }
        />
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
  stacked,
  menuPosition,
}: {
  action: Action;
  labelled: boolean;
  stacked: boolean;
  menuPosition: FloatingPosition;
}) {
  const { label, icon: Icon, pressed, color, disabled, loading, link, onClick } = action;
  const options = hasOptions(action);
  // ⋯ already says it holds more, so it carries no ▾.
  const chevron = options && Icon !== icons.more;
  // A disabled control that says why stays hoverable and focusable (Mantine's `data-disabled`) so
  // its tooltip can show.
  const reason = disabled && action.description;
  const props = {
    className: classes.action,
    variant: "subtle",
    color: color || (pressed ? undefined : "gray"),
    "aria-pressed": pressed,
    loading,
    ...(reason
      ? { "data-disabled": true, "aria-disabled": true, "aria-description": reason }
      : { disabled }),
    ...(options || reason
      ? {}
      : link
        ? { component: "a" as const, ...(disabled ? { download: link.download } : link) }
        : { onClick }),
  } as const;
  const icon = Icon && <Icon size={labelled ? 16 : 18} fill={pressed ? "currentColor" : "none"} />;
  const emphasis = action.emphasis && { variant: action.emphasis, color: undefined, radius: "xl" };
  const control =
    labelled && stacked && !emphasis ? (
      // The name under the icon, its ▾ beside the name.
      <Button
        size="compact-xs"
        classNames={{ root: classes.stacked, label: classes.stackedLabel }}
        {...props}
      >
        {icon}
        <span>
          {label}
          {chevron && <ChevronDown size={10} />}
        </span>
      </Button>
    ) : labelled ? (
      <Button
        size={emphasis ? undefined : "compact-sm"}
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
  const tip = {
    label: reason ? (
      <>
        {label}
        <br />
        {reason}
      </>
    ) : (
      label
    ),
    disabled: labelled && !reason,
  };
  if (!options) return <Tooltip {...tip}>{control}</Tooltip>;
  return (
    <OptionsMenu
      action={action}
      position={menuPosition}
      target={
        <PopupTooltip {...tip}>
          <Menu.Target>{control}</Menu.Target>
        </PopupTooltip>
      }
    />
  );
}

/**
 * The action bar shared by the viewer and gallery selection: icon controls in divided groups; the
 * `labelled` ones show their names. Controls that overflow scroll sideways, or with `fit` stay on
 * one row by showing the last labelled ones as icons alone, then drawing their ▾ closer, and only
 * past that wrap onto another
 * row a whole group at a time, spaced apart rather than divided so no divider ends a row. Menus
 * open above it unless `menuPosition` says otherwise.
 */
export function ActionBarGroups({
  groups,
  labelled = [],
  menuPosition = "top",
  fit = false,
  stacked = false,
  equal = false,
}: {
  groups: ActionGroups;
  labelled?: string[];
  menuPosition?: FloatingPosition;
  fit?: boolean;
  /** Groups phone controls compactly, stacking any retained names. */
  stacked?: boolean;
  /** Give every named choice the same share of the row. */
  equal?: boolean;
}) {
  const phone = usePhone();
  const row = useRef<HTMLDivElement>(null);
  const actions = shown(groups).flat();
  const named = actions.filter((action) => (!phone || equal) && labelled.includes(action.id));
  // Removing a label can shrink the bar. Try the full labels again when the room grows.
  const key = `${phone}:${actions.map((action) => `${action.id}:${action.label}`).join()}`;
  const [fitted, setFitted] = useState({ key, room: 0, dropped: 0 });
  const dropped = fitted.key === key ? fitted.dropped : 0;
  const tight = fit && dropped >= named.length;
  const wrap = fit && dropped > named.length;
  const names = new Set(
    named.slice(0, Math.max(0, named.length - dropped)).map((action) => action.id),
  );
  useLayoutEffect(() => {
    if (!fit) return;
    const bar = row.current!;
    const room = bar.parentElement!.clientWidth;
    if (fitted.key !== key || fitted.room < room) setFitted({ key, room, dropped: 0 });
    else if (!wrap && bar.scrollWidth > bar.clientWidth)
      setFitted({ key, room, dropped: dropped + 1 });
    else if (fitted.room !== room) setFitted({ key, room, dropped });
  });
  useEffect(() => {
    if (!fit) return;
    const observer = new ResizeObserver(() => setFitted((last) => ({ ...last })));
    observer.observe(row.current!.parentElement!);
    // Names measured before the font loaded fit again with it.
    void document.fonts.ready.then(() => setFitted((last) => ({ ...last, room: 0 })));
    return () => observer.disconnect();
  }, [fit]);
  return (
    <div
      ref={row}
      className={classes.actions}
      data-fit={fit || undefined}
      data-tight={tight || undefined}
      data-wrap={wrap || undefined}
      data-stacked={stacked || undefined}
      data-equal={equal || undefined}
    >
      {shown(groups).map((group, index) => {
        const controls = group.map((action) => (
          <ActionControl
            key={action.id}
            action={action}
            labelled={names.has(action.id)}
            stacked={stacked}
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
