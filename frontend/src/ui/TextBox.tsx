import {
  ActionIcon,
  Button,
  CloseButton,
  FocusTrap,
  Loader,
  Menu,
  Modal,
  type ModalProps,
  Text,
  Textarea,
  type TextareaProps,
  Tooltip,
  VisuallyHidden,
  getDefaultZIndex,
  useProps,
} from "@mantine/core";
import { useMergedRef } from "@mantine/hooks";
import { ArrowUp, Check, type LucideIcon } from "lucide-react";
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { menuWidth } from "../theme";
import { type Action, ActionMenuItems } from "./ActionBar";
import { useCopy } from "./clipboard";
import { icons } from "./icons";
import { layerAbove, popupLayer } from "./popupClicks";
import { PopupTooltip } from "./PopupTooltip";
import { useKeyboard, useKeyboardDrop } from "./useKeyboard";
import { usePhone } from "./usePhone";

import classes from "./TextBox.module.css";

// Pressing the tools control or a phone editor tool keeps focus (and the keyboard) in the text, so nothing that
// follows the focus (a sheet's header) moves the control from under the press.
const keepFocus = (event: MouseEvent) => event.preventDefault();

/** Shared text editing, with a flat tools menu and a full-screen phone editor. */
export function TextBox({
  value,
  onChange,
  tools,
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
  /** The send, and a proposal's Undo, which stay beside the text. */
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
   * returns to the page unless `keepOpen`, as for a proposal to review in place.
   */
  submit?: {
    label: string;
    icon?: LucideIcon;
    disabled: boolean;
    keepOpen?: boolean;
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
  const keyboard = useKeyboard(editing, content);
  const modal = useProps("Modal", {}, {} as Pick<ModalProps, "transitionProps">);
  const title = (typeof props.label === "string" && props.label) || props["aria-label"] || "Text";
  useKeyboardDrop(editing, () => close());
  // Clear turns into Undo, which restores the text, until the text next changes.
  const start = reset ?? "";
  const [cleared, setCleared] = useState<string | null>(null);
  useEffect(() => {
    if (value !== start) setCleared(null);
  }, [value, start]);
  const clear: Action =
    cleared !== null && value === start
      ? { id: "clear", label: "Undo", icon: icons.undo, onClick: () => onChange(cleared) }
      : {
          id: "clear",
          label: reset === undefined ? "Clear" : "Reset",
          icon: reset === undefined ? icons.clear : icons.reset,
          disabled: value === start || props.readOnly,
          onClick: () => {
            setCleared(value);
            onChange(start);
          },
        };
  const copier = useCopy();
  // Phones show Copy and Clear above the keyboard; desktop boxes leave them to the browser, keeping
  // only Reset and its Undo, beside the text while they can act.
  const edits: Action[] = tools
    ? [
        {
          id: "copy",
          label: copier.copied ? "Copied" : "Copy",
          icon: copier.copied ? Check : icons.copy,
          disabled: !value,
          onClick: () => copier.copy(value, title),
        },
        ...(reset === undefined || value !== start || cleared !== null ? [clear] : []),
      ]
    : [];
  const edit = !mobile && reset !== undefined && !clear.disabled ? clear : undefined;
  const editButtons = edits.map((action) => (
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
  ));
  const spins = tools !== undefined && (!phone || editing || ai) && !hideTools;
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
  const resting = oneLine && !focused;
  // The resting line is drawn over the text, since WebKit ends no textarea in an ellipsis; it
  // takes the textarea's font, padding and border so the two line up.
  const field = useRef<HTMLTextAreaElement>(null);
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
  // Keep every option under its tool's name, including its later action groups.
  const listed = tools?.filter((action) => action.menu) || [];
  const others = tools?.filter((action) => !action.menu) || [];
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
  const menu = !menuless && tools !== undefined && (
    <Menu
      position="top-end"
      width={menuWidth}
      // A long list scrolls within the room the page leaves it.
      middlewares={{ size: true }}
      // Above any dialog holding the box: a card's sits over the popovers it opens from.
      zIndex={getDefaultZIndex("max")}
      opened={menuOpened}
      onChange={setMenuOpened}
      onOpen={() => {
        openedFrom.current = document.activeElement;
        tools.forEach((tool) => tool.onOpen?.());
      }}
      // An item that moves focus itself keeps it; otherwise it returns.
      returnFocus={false}
      onClose={() =>
        setTimeout(() => {
          const active = document.activeElement;
          if (
            !active ||
            active === document.body ||
            (ai &&
              !editing &&
              openedFrom.current?.tagName !== "TEXTAREA" &&
              active === openedFrom.current)
          )
            more.current?.focus({ preventScroll: true });
        })
      }
    >
      <PopupTooltip label={busy || (ai ? "AI Actions" : "More Actions")}>
        <Menu.Target>
          {phone && !ai ? (
            <Button
              ref={more}
              onMouseDown={focusTool}
              variant="subtle"
              color="gray"
              size="compact-xs"
              aria-label={`More ${title} Actions`}
              disabled={tools.length === 0}
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
              aria-label={`${ai ? "AI" : "More"} ${title} Actions`}
              disabled={tools.length === 0}
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
      {/* Phones show the menu as a full-screen sheet: its title and Close, then the tools. */}
      <Menu.Dropdown
        className={mobile ? classes.sheet : undefined}
        // Opaque, unlike the glass theme surface, so the editor never shows through.
        style={
          mobile
            ? {
                background: "var(--mantine-color-body)",
                backdropFilter: "none",
                WebkitBackdropFilter: "none",
                boxShadow: "none",
              }
            : { overflowY: "auto" }
        }
      >
        {mobile && (
          <div className={classes.sheetHeader}>
            <Text fw={600}>{ai ? "AI" : "More"}</Text>
            <CloseButton
              aria-label={`Close ${ai ? "AI" : "More"}`}
              onClick={() => setMenuOpened(false)}
            />
          </div>
        )}
        <div className={mobile ? classes.sheetBody : undefined}>
          {listed.map((tool, index) => (
            <Fragment key={tool.id}>
              {index > 0 && <Menu.Divider />}
              {!tool.menu!.flat().some((option) => option.heading) && (
                <Menu.Label>{tool.label}</Menu.Label>
              )}
              <ActionMenuItems
                groups={tool.menu!.map((group) =>
                  group.map((option) => ({
                    ...option,
                    disabled: option.disabled || tool.disabled,
                  })),
                )}
              />
            </Fragment>
          ))}
          {listed.length > 0 && others.length > 0 && <Menu.Divider />}
          <ActionMenuItems groups={[others]} />
        </div>
      </Menu.Dropdown>
    </Menu>
  );
  // A labelled box keeps its tools inside the text's corner, sharing its edge with the form's fields.
  const inside = Boolean(!mobile && !send && !hideTools && props.label && tools);
  const boxTools = (
    <div className={classes.tools}>
      {mobile && (!phone || editing) && editButtons}
      {inlineEdit}
      {menu}
    </div>
  );
  const close = () => {
    setMenuOpened(false);
    setEditing(false);
    setTimeout(() => field.current?.focus({ preventScroll: true }));
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
        if (phone && !props.readOnly && !props.disabled) setEditing(true);
      }}
      // While the phone editor is open, it alone carries the actions.
      rightSection={editing ? undefined : inside ? boxTools : rightSection}
      {...(inside && {
        rightSectionWidth: "auto",
        rightSectionPointerEvents: "all" as const,
        rightSectionProps: { style: { alignItems: "flex-start", paddingTop: 4 } },
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
        <div className={classes.toolbar} onMouseDown={keepFocus}>
          <div className={classes.editActions} role="group" aria-label={`${title} Tools`}>
            {editButtons}
            {menu}
            {!tools && !send && rightSection}
          </div>
          {!submit && send && <div className={classes.sends}>{send}</div>}
          {submit && (
            <div className={classes.sends}>
              {submit?.map((each, index) => {
                const primary = index === submit.length - 1;
                const Glyph = each.icon ?? ArrowUp;
                return (
                  <Button
                    key={each.label}
                    aria-label={each.label}
                    className={primary ? undefined : classes.secondarySend}
                    variant={primary ? "filled" : "light"}
                    radius="xl"
                    size="compact-xs"
                    leftSection={primary ? undefined : <Glyph size={16} />}
                    rightSection={primary ? <Glyph size={16} /> : undefined}
                    disabled={each.disabled}
                    // Sending before the keyboard drops keeps the text's blur from closing first.
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (!each.keepOpen) close();
                      each.onSubmit();
                    }}
                  >
                    {each.label}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {popups && <div className={classes.anchor}>{popups}</div>}
    </div>
  );
  return (
    <>
      {busy && spins && <VisuallyHidden role="status">{busy}</VisuallyHidden>}
      {/* AI tools remain available beside the summary before its phone editor opens. */}
      {mobile && inline ? (
        // In place, the text fills the surface with its tools as icons in its corner.
        <div className={classes.editor} data-text-editor>
          <div className={classes.columned}>
            {textarea}
            {(tools || send) && (
              <div
                className={classes.corner}
                role="group"
                aria-label={`${title} Tools`}
                onMouseDown={keepFocus}
              >
                {editButtons}
                {menu}
                {send}
              </div>
            )}
          </div>
          {below && <div className={classes.below}>{below}</div>}
          {popups && <div className={classes.anchor}>{popups}</div>}
        </div>
      ) : ((!phone || ai) && tools && !inside) || send ? (
        <div className={classes.columned}>
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
          // The page returns at once, rather than showing through a fade while the keyboard drops.
          transitionProps={{ ...modal.transitionProps, exitDuration: 0 }}
          // A column of header and body. Inline, since Paper's `display: block` has a module
          // class's specificity.
          styles={{ content: { display: "flex", flexDirection: "column" } }}
          classNames={{ body: classes.body }}
        >
          <Modal.Overlay />
          {/* Modal.Content drops onKeyDown, so Escape is caught in the capture phase. */}
          <Modal.Content
            ref={content}
            data-composer-layer
            aria-label={title}
            style={
              {
                // Opaque, unlike the glass theme surface, so the page never shows through.
                background: "var(--mantine-color-body)",
                backdropFilter: "none",
                WebkitBackdropFilter: "none",
                translate: keyboard.top ? `0 ${keyboard.top}px` : undefined,
                "--keyboard-inset": `${keyboard.inset}px`,
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
