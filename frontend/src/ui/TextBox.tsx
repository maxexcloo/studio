import {
  ActionIcon,
  Button,
  FocusTrap,
  Loader,
  Menu,
  Modal,
  Textarea,
  type TextareaProps,
  Tooltip,
  VisuallyHidden,
  getDefaultZIndex,
} from "@mantine/core";
import { useMergedRef } from "@mantine/hooks";
import { ArrowUp, Check } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { menuWidth } from "../theme";
import { type Action, type ActionGroups, ActionMenuItems, useActionMenuBounds } from "./ActionBar";
import { useCopy } from "./clipboard";
import { icons } from "./icons";
import { layerAbove, popupLayer } from "./popupClicks";
import { PopupTooltip } from "./PopupTooltip";
import { useKeyboardDrop, useVisibleRect } from "./useKeyboard";
import { usePhone } from "./usePhone";

import classes from "./TextBox.module.css";

// Pressing the tools control or a phone editor tool keeps focus (and the keyboard) in the text, so nothing that
// follows the focus (a sheet's header) moves the control from under the press.
const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * Where an in-place box shows its tools while it has focus: its form's action bar, above the
 * phone keyboard.
 */
export const TextToolsBar = createContext<HTMLElement | null>(null);

/** Shared text editing with a tools menu and a full-screen phone editor. */
export function TextBox({
  value,
  onChange,
  tools,
  menuLabel,
  send,
  busy,
  popups,
  hideTools = false,
  reset,
  below,
  inline = false,
  oneLine = false,
  submit,
  rightSection,
  onClick,
  ...props
}: Omit<TextareaProps, "value" | "onChange"> & {
  ref?: Ref<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  /** The box's tools menu; AI uses the magic icon, other tools More. */
  tools?: Action[];
  menuLabel?: string;
  /** The send, which stays beside the text. */
  send?: ReactNode;
  /** Popups its tools open (Recent Prompts), anchored at the box's end where the ⋯ stands. */
  popups?: ReactNode;
  /** What a tool is doing (Improving Prompt…): the ⋯ spins, its menu still open to use. */
  busy?: string;
  /** Leaves the tools out beside the text (a collapsed composer), keeping the text mounted. */
  hideTools?: boolean;
  /** Content under the box, such as assistant suggestions, that the phone editor shows too. */
  below?: ReactNode;
  /** Edits in place on phones, for a surface that is itself full screen (the Generate sheet). */
  inline?: boolean;
  /** Rests on one line, ending in an ellipsis, and shows its whole text while focused. */
  oneLine?: boolean;
  /** The text Clear returns to, as Reset, where the box starts from a text of its own. */
  reset?: string;
  /**
   * The form's sends, offered in the phone editor above the keyboard; the last is primary. Each
   * returns to the page.
   */
  submit?: {
    label: string;
    disabled: boolean;
    onSubmit: () => void;
  }[];
}) {
  const mobile = usePhone();
  const phone = mobile && !inline;
  const [editing, setEditing] = useState(false);
  const ai = tools?.some((tool) => tool.id === "assistant" || tool.icon === icons.assistant);
  const focusTool = (event: MouseEvent) => {
    if (!ai || editing || document.activeElement?.tagName === "TEXTAREA") keepFocus(event);
  };
  const content = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [menuOpened, setMenuOpened] = useState(false);
  const openedFrom = useRef<Element | null>(null);
  // The editor fits the room above the keyboard; closing, it fills the screen as the keyboard drops.
  const viewport = useVisibleRect(editing);
  const closing = useRef(false);
  const editorViewport = editing ? viewport : undefined;
  const title = (typeof props.label === "string" && props.label) || props["aria-label"] || "Text";
  useKeyboardDrop(editing, () => close());
  // The text an in-place box had when it took focus: changed since, Reset returns to it.
  const [original, setOriginal] = useState<string>();
  const resetTo = reset ?? (original && value !== original ? original : undefined);
  const start = resetTo ?? "";
  // Clear and Reset turn into Undo, which restores the text, until the text next changes.
  const [cleared, setCleared] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => {
    if (cleared && value !== cleared.to) setCleared(null);
  }, [value, cleared]);
  const clear: Action = cleared
    ? { id: "clear", label: "Undo", icon: icons.undo, onClick: () => onChange(cleared.from) }
    : {
        id: "clear",
        label: resetTo === undefined ? "Clear" : "Reset",
        icon: resetTo === undefined ? icons.clear : icons.reset,
        disabled: value === start || props.readOnly,
        onClick: () => {
          setCleared({ from: value, to: start });
          onChange(start);
        },
      };
  const copier = useCopy();
  const copy: Action = {
    id: "copy",
    label: copier.copied ? "Copied" : "Copy",
    icon: copier.copied ? Check : icons.copy,
    disabled: !value,
    onClick: () => copier.copy(value, title),
  };
  // Phones show Copy and Clear above the keyboard; desktop boxes leave them to the browser, keeping
  // only Reset and its Undo, beside the text while they can act.
  const edits: Action[] = tools
    ? [copy, ...(reset === undefined || value !== reset || cleared ? [clear] : [])]
    : [];
  const edit = !mobile && reset !== undefined && !clear.disabled ? clear : undefined;
  const editButton = (action: Action) => (
    <Button
      key={action.id}
      onMouseDown={keepFocus}
      variant="subtle"
      color="gray"
      size="compact-xs"
      disabled={action.disabled}
      onClick={action.onClick}
      className={classes.editAction}
      aria-label={action.label}
    >
      {action.icon && <action.icon size={16} className={classes.editIcon} />}
      <span className={classes.editText}>{action.label}</span>
    </Button>
  );
  const editButtons = edits.map(editButton);
  const bar = useContext(TextToolsBar);
  const [active, setActive] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  // Only a box in the bar's own surface, not one in a dialog opened from it, joins the bar. Such a
  // box shows its tools there while typing. Its surface is known once it has mounted, before paint.
  const [barred, setBarred] = useState(false);
  useLayoutEffect(() => {
    setBarred(
      mobile &&
        inline &&
        bar !== null &&
        bar.closest('[role="dialog"]') === field.current?.closest('[role="dialog"]'),
    );
  }, [mobile, inline, bar]);
  const inBar = barred && active ? bar : null;
  const restingTools = barred && !active && !hideTools && Boolean(tools?.length || send);
  const spins =
    tools !== undefined &&
    (!phone || editing || ai) &&
    !hideTools &&
    (!barred || active || restingTools);
  const description =
    busy && !spins ? (
      <span className={classes.busy} role="status">
        <Loader size={12} />
        {busy}
      </span>
    ) : (
      props.description
    );
  const [focused, setFocused] = useState(false);
  const resting = oneLine && (phone || !focused);
  const centreTools = props.maxRows === 1 || (oneLine && Boolean(send));
  // The resting line is drawn over the text, since WebKit ends no textarea in an ellipsis; it
  // takes the textarea's font, padding and border so the two line up.
  const ref = useMergedRef(field, props.ref);
  const line = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!resting || !field.current || !line.current) return;
    const style = getComputedStyle(field.current);
    for (const key of [
      "borderLeftWidth",
      "borderRightWidth",
      "borderTopWidth",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "letterSpacing",
      "lineHeight",
      "paddingTop",
      "paddingLeft",
      "paddingRight",
    ] as const)
      line.current.style[key] = style[key];
  });
  const groups: ActionGroups = [
    ...(tools ?? []).flatMap((tool) => {
      if (!tool.menu) return [];
      const groups = tool.menu
        .filter((group) => group.length)
        .map((group) =>
          group.map((option) => ({ ...option, disabled: option.disabled || tool.disabled })),
        );
      if (tool.heading === false || groups.some((group) => group.some((option) => option.heading)))
        return groups;
      const [first = [], ...rest] = groups;
      return [[{ id: tool.id, label: tool.label, heading: true }, ...first], ...rest];
    }),
    (tools ?? []).filter((action) => !action.menu),
  ];
  // Without tools a desktop box has no menu, and a busy tool spins its Reset instead.
  const menuless = !mobile && tools?.length === 0;
  const inlineEdit = (edit || (menuless && busy)) && (
    <Tooltip label={(menuless && busy) || edit!.label}>
      <ActionIcon
        onMouseDown={keepFocus}
        variant="subtle"
        color="gray"
        aria-label={edit?.label ?? busy}
        loading={Boolean(menuless && busy)}
        onClick={edit?.onClick}
      >
        {edit?.icon && <edit.icon size={16} />}
      </ActionIcon>
    </Tooltip>
  );
  const bounds = useActionMenuBounds(
    menuOpened,
    groups.some((group) => group.some(({ menu }) => menu)),
  );
  const toolsMenu = tools && tools.length > 0 && (
    <Menu
      // In place at rest, the button stands at the text's top, so the menu drops from it.
      position={mobile && inline && !inBar ? "bottom-end" : "top-end"}
      width={menuWidth}
      {...bounds}
      // Compact rows, as on desktop, keep the list short on a phone.
      styles={{ ...bounds.styles, item: { minHeight: 36 } }}
      // Above any dialog holding the box: a card's sits over the popovers it opens from.
      zIndex={getDefaultZIndex("max")}
      opened={menuOpened}
      onChange={setMenuOpened}
      onOpen={() => {
        openedFrom.current = document.activeElement;
        tools.forEach((tool) => tool.onOpen?.());
      }}
      // An item that moves focus itself keeps it; otherwise it returns, to the text where the menu
      // opened from it.
      returnFocus={false}
      onClose={() =>
        setTimeout(() => {
          const active = document.activeElement;
          const from = openedFrom.current;
          if (
            !active ||
            active === document.body ||
            // The chosen item keeps focus while the menu fades out.
            active.closest("[data-menu-dropdown]") ||
            (ai && !editing && from?.tagName !== "TEXTAREA" && active === from)
          )
            (
              (from?.tagName === "TEXTAREA" && from.isConnected
                ? from
                : more.current) as HTMLElement | null
            )?.focus({ preventScroll: true });
        })
      }
    >
      <PopupTooltip disabled={ai} label={busy || "More Actions"}>
        <Menu.Target>
          {phone && !ai ? (
            <Button
              ref={more}
              onMouseDown={focusTool}
              variant="subtle"
              color="gray"
              size="compact-xs"
              aria-label={`More ${title} Actions`}
              aria-busy={Boolean(busy) || undefined}
              aria-description={busy}
              leftSection={busy ? <Loader size={16} /> : undefined}
            >
              More
            </Button>
          ) : (
            <ActionIcon
              ref={more}
              onMouseDown={focusTool}
              variant="subtle"
              color="gray"
              aria-label={menuLabel || `${ai ? "AI" : "More"} ${title} Actions`}
              aria-busy={Boolean(busy) || undefined}
              aria-description={busy}
            >
              {busy ? (
                <Loader size={16} />
              ) : ai ? (
                <icons.assistant size={18} />
              ) : (
                <icons.more size={18} />
              )}
            </ActionIcon>
          )}
        </Menu.Target>
      </PopupTooltip>
      <Menu.Dropdown>{menuOpened && <ActionMenuItems groups={groups} />}</Menu.Dropdown>
    </Menu>
  );
  // An AI tool with a single option runs it at once; it becomes a menu while there is more, such
  // as a proposal's Undo. Options loaded as the menu opens (Suggestions) keep the menu.
  const options = groups.flat().filter((option) => !option.heading);
  const [only] = options;
  const direct =
    ai &&
    options.length === 1 &&
    only.onClick &&
    !only.menu &&
    !only.choice &&
    !tools?.some((tool) => tool.onOpen);
  const menu = direct ? (
    <Tooltip label={busy || only.label}>
      <ActionIcon
        ref={more}
        onMouseDown={focusTool}
        variant="subtle"
        color="gray"
        aria-label={only.label}
        aria-busy={Boolean(busy) || undefined}
        aria-description={busy}
        disabled={only.disabled}
        onClick={only.onClick}
      >
        {busy ? <Loader size={16} /> : <icons.assistant size={18} />}
      </ActionIcon>
    </Tooltip>
  ) : (
    toolsMenu
  );
  const barEdit = (action: Action) => (
    <Tooltip key={action.id} label={action.label}>
      <ActionIcon
        variant="subtle"
        color="gray"
        aria-label={action.label}
        data-edit={action.id}
        disabled={action.disabled}
        onClick={action.onClick}
      >
        {action.icon && <action.icon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
  // At rest the tools stand over the text's end; while it has focus, the bar leads with the menu
  // and Copy, and Clear/Reset/Undo sits at its far end beside the form's primary, all as icons of one size.
  const toolGroup = (
    <div
      className={inBar ? classes.barTools : classes.corner}
      role="group"
      aria-label={`${title} Tools`}
      data-text-tools
      onMouseDown={keepFocus}
    >
      {inBar ? (
        <>
          {menu}
          {edits.map(barEdit)}
        </>
      ) : (
        <>
          {editButtons}
          {menu}
        </>
      )}
      {send}
    </div>
  );
  const inlineAI = inline && ai && (!mobile || Boolean(submit));
  const inside = Boolean(!send && !hideTools && (inlineAI || (!mobile && props.label && tools)));
  const boxTools = (
    <div className={classes.tools}>
      {mobile && (!phone || editing) && editButtons}
      {inlineEdit}
      {menu}
    </div>
  );
  const close = () => {
    if (!editing || closing.current) return;
    closing.current = true;
    setMenuOpened(false);
    setEditing(false);
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && content.current?.contains(focused)) focused.blur();
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    // A tool's menu, portalled outside the editor, closes on its own Escape first.
    if (layerAbove(content.current, event)) return;
    if (!content.current?.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const textarea = (
    <Textarea
      {...props}
      ref={ref}
      description={description}
      variant={mobile && inline ? "unstyled" : props.variant}
      // While the phone editor is open, it alone is the box.
      aria-hidden={editing || undefined}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      // A phone box only summarises its text, which the editor scrolls instead; tapping it opens
      // the editor without raising the keyboard.
      styles={phone ? { input: { overflowY: "hidden" } } : undefined}
      inputMode={phone ? "none" : props.inputMode}
      onClick={(event) => {
        onClick?.(event);
        if (phone && !event.defaultPrevented && !props.readOnly && !props.disabled)
          setEditing(true);
      }}
      // While the phone editor is open, it alone carries the actions.
      rightSection={
        editing ? undefined : inside ? (
          mobile ? (
            menu
          ) : (
            boxTools
          )
        ) : restingTools ? (
          <div className={classes.restingTools} data-text-tools onMouseDown={keepFocus}>
            {menu}
            {send}
          </div>
        ) : (
          rightSection
        )
      }
      {...((inside || restingTools) && {
        rightSectionWidth: inlineAI ? 44 : inside ? "auto" : undefined,
        rightSectionPointerEvents: "all" as const,
        rightSectionProps: { style: { alignItems: "flex-start", paddingTop: inside ? 4 : 0 } },
      })}
      {...(oneLine && {
        maxRows: resting ? 1 : props.maxRows,
        onFocus: (event) => {
          setFocused(true);
          props.onFocus?.(event);
        },
        onBlur: (event) => {
          setFocused(false);
          props.onBlur?.(event);
        },
        inputContainer: (children) => (
          <div className={classes.line} data-resting={(resting && Boolean(value)) || undefined}>
            {children}
            {resting && value && (
              <span ref={line} aria-hidden className={classes.summary}>
                {value}
              </span>
            )}
          </div>
        ),
      })}
    />
  );
  const editor = (field: ReactNode) => (
    <div className={classes.editor} data-text-editor>
      {field}
      {below && <div className={classes.below}>{below}</div>}
      {/* Tools and form sends share the pinned row above the keyboard. */}
      {(tools || send || submit || rightSection) && (
        <div className={`${classes.toolbar} ${classes.footerSurface}`} onMouseDown={keepFocus}>
          <div className={classes.editActions} role="group" aria-label={`${title} Tools`}>
            {!inside && menu}
            {edits.filter((action) => action.id !== "clear").map(barEdit)}
            {!tools && !send && rightSection}
          </div>
          <div className={classes.sends}>
            {edits.filter((action) => action.id === "clear").map(barEdit)}
            {!submit && send}
            {submit?.map((each, index) => {
              const primary = index === submit.length - 1;
              const send = () => {
                if (!inline) close();
                each.onSubmit();
              };
              if (!primary)
                return (
                  <Tooltip key={each.label} label={each.label}>
                    <ActionIcon
                      aria-label={each.label}
                      variant="subtle"
                      color="gray"
                      disabled={each.disabled}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={send}
                    >
                      <ArrowUp size={16} />
                    </ActionIcon>
                  </Tooltip>
                );
              return (
                <Button
                  key={each.label}
                  aria-label={each.label}
                  radius="xl"
                  rightSection={<ArrowUp size={16} />}
                  disabled={each.disabled}
                  // Sending before the keyboard drops keeps the text's blur from closing first.
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={send}
                >
                  {each.label}
                </Button>
              );
            })}
          </div>
        </div>
      )}
      {popups && <div className={classes.anchor}>{popups}</div>}
    </div>
  );
  return (
    <>
      {busy && spins && <VisuallyHidden role="status">{busy}</VisuallyHidden>}
      {/* AI tools remain available beside the summary before its phone editor opens. */}
      {mobile && inline && submit ? (
        editor(textarea)
      ) : mobile && inline ? (
        // In place, the text fills the surface with its tools as icons in its corner, or only while
        // it has focus in its form's action bar.
        <div
          className={classes.editor}
          data-text-editor
          onFocus={(event) => {
            if (event.target !== (field.current as EventTarget | null)) return;
            // Returning from its own tools keeps the text it started from.
            if (!active) setOriginal(value);
            setActive(true);
          }}
          // Its tools and their menu, wherever they stand, keep the text active.
          onBlur={(event) => {
            const next = event.relatedTarget as Element | null;
            if (
              !next ||
              !(next === field.current || next.closest(`${popupLayer}, [data-text-tools]`))
            ) {
              setActive(false);
              setOriginal(undefined);
            }
          }}
        >
          <div className={classes.columned}>
            {textarea}
            {inBar ? createPortal(toolGroup, inBar) : !barred && (tools || send) && toolGroup}
          </div>
          {below && <div className={classes.below}>{below}</div>}
          {popups && <div className={classes.anchor}>{popups}</div>}
        </div>
      ) : ((!phone || ai) && tools && !inside) || send ? (
        <div className={classes.columned} data-centre-tools={centreTools || undefined}>
          {textarea}
          {!editing && !hideTools && (
            <div className={classes.tools}>
              {(!phone || ai) && boxTools}
              {send}
            </div>
          )}
          {popups && <div className={classes.anchor}>{popups}</div>}
        </div>
      ) : (
        textarea
      )}
      {!editing && !(mobile && inline) && below}
      {phone && (
        <Modal.Root
          opened={editing}
          onClose={close}
          fullScreen
          closeOnEscape={false}
          returnFocus={false}
          onExitTransitionEnd={() => {
            closing.current = false;
            if (field.current && !layerAbove(field.current))
              field.current.focus({ preventScroll: true });
          }}
          // A column of header and body. Inline, since Paper's `display: block` has a module
          // class's specificity.
          styles={{ content: { display: "flex", flexDirection: "column", overflow: "clip" } }}
          classNames={{ body: classes.body }}
        >
          <Modal.Overlay />
          {/* Modal.Content drops onKeyDown, so Escape is caught in the capture phase. */}
          <Modal.Content
            ref={content}
            data-composer-layer
            aria-label={title}
            aria-hidden={!editing || undefined}
            inert={!editing}
            style={
              {
                translate: editorViewport?.y ? `0 ${editorViewport.y}px` : undefined,
                height: editorViewport?.height,
                maxHeight: editorViewport?.height,
                "--text-editor-safe-bottom":
                  editorViewport &&
                  window.innerHeight - editorViewport.y - editorViewport.height > 100
                    ? "0px"
                    : undefined,
              } as CSSProperties
            }
            onKeyDownCapture={escape}
          >
            {/* The keyboard waits until the text itself is tapped. */}
            <FocusTrap.InitialFocus />
            <Modal.Header>
              <Modal.Title>{title}</Modal.Title>
              <Modal.CloseButton aria-label={`Close ${title}`} />
            </Modal.Header>
            <Modal.Body>
              {editor(
                <Textarea
                  aria-label={title}
                  description={description}
                  placeholder={props.placeholder}
                  maxLength={props.maxLength}
                  spellCheck={props.spellCheck}
                  variant="unstyled"
                  classNames={{ root: classes.field, wrapper: classes.field, input: classes.input }}
                  value={value}
                  onChange={(event) => onChange(event.currentTarget.value)}
                  // Dismissing the keyboard (iOS Done or hide) blurs the text and returns to the page;
                  // a tool's menu taking focus keeps the editor.
                  onBlur={(event) => {
                    const target = event.relatedTarget as Node | null;
                    if (
                      !content.current?.contains(target) &&
                      !(target as Element | null)?.closest(popupLayer)
                    )
                      close();
                  }}
                />,
              )}
            </Modal.Body>
          </Modal.Content>
        </Modal.Root>
      )}
    </>
  );
}
