import {
  ActionIcon,
  Button,
  FocusTrap,
  Loader,
  Menu,
  Modal,
  type ModalProps,
  Textarea,
  type TextareaProps,
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
import { copyText, useCopy } from "./clipboard";
import { icons } from "./icons";
import { layerAbove, popupLayer } from "./popupClicks";
import { PopupTooltip } from "./PopupTooltip";
import { useKeyboard, useKeyboardDrop } from "./useKeyboard";
import { usePhone } from "./usePhone";

import classes from "./TextBox.module.css";

// Pressing ⋯ or a phone editor tool keeps focus (and the keyboard) in the text, so nothing that
// follows the focus (a sheet's header) moves the control from under the press.
const keepFocus = (event: MouseEvent) => event.preventDefault();

/** Shared text editing, with a flat tools menu and a full-screen phone editor. */
export function TextBox({
  value,
  onChange,
  tools,
  copy = true,
  send,
  busy,
  popups,
  hideTools = false,
  reset,
  overlay,
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
  /** The box's own tools, in its ⋯ menu; with them (even none) come Copy and Clear. */
  tools?: Action[];
  /** Omits duplicate Copy where the page offers it; the full-screen editor always offers it. */
  copy?: boolean;
  /** The send, and a proposal's Undo, which stay beside the text. */
  send?: ReactNode;
  /** Popups its tools open (Recent Prompts), anchored at the box's end where the ⋯ stands. */
  popups?: ReactNode;
  /** What a tool is doing (Improving the prompt…): the ⋯ spins, its menu still open to use. */
  busy?: string;
  /** Leaves the tools out beside the text (a collapsed composer), keeping the text mounted. */
  hideTools?: boolean;
  /** Floats over the text, such as prompt ideas; the phone editor shows it under its text. */
  overlay?: ReactNode;
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
  const content = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [menuOpened, setMenuOpened] = useState(false);
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
  const edits: Action[] = tools
    ? [
        ...(copy || phone
          ? [
              {
                id: "copy",
                label: copier.copied ? "Copied" : "Copy",
                icon: copier.copied ? Check : icons.copy,
                disabled: !value,
                onClick: () => (mobile ? copier.copy(value, title) : void copyText(value, title)),
              },
            ]
          : []),
        ...(reset === undefined || value !== start || cleared !== null ? [clear] : []),
      ]
    : [];
  const editButtons = edits.map((action) => (
    <Button
      key={action.id}
      onMouseDown={keepFocus}
      variant="subtle"
      color="gray"
      size="compact-sm"
      leftSection={action.icon && <action.icon size={16} />}
      disabled={action.disabled}
      onClick={action.onClick}
    >
      {action.label}
    </Button>
  ));
  const spins = tools !== undefined && (!phone || editing) && !hideTools;
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
  const menu = tools !== undefined && (
    <Menu
      position="top-end"
      width={menuWidth}
      // A long list scrolls within the room the page leaves it.
      middlewares={{ size: true }}
      // Above any dialog holding the box: a card's sits over the popovers it opens from.
      zIndex={getDefaultZIndex("max")}
      opened={menuOpened}
      onChange={setMenuOpened}
      onOpen={() => tools.forEach((tool) => tool.onOpen?.())}
      // An item that moves focus itself keeps it; otherwise it returns.
      returnFocus={false}
      onClose={() =>
        setTimeout(() => {
          if (!document.activeElement || document.activeElement === document.body)
            more.current?.focus({ preventScroll: true });
        })
      }
    >
      <PopupTooltip label={busy || "More Actions"}>
        <Menu.Target>
          {mobile ? (
            <Button
              ref={more}
              onMouseDown={keepFocus}
              variant="subtle"
              color="gray"
              size="compact-sm"
              aria-label={`More ${title} Actions`}
              disabled={tools.length === 0 && (mobile || edits.length === 0)}
              aria-busy={Boolean(busy) || undefined}
              aria-description={busy}
              leftSection={busy ? <Loader size={16} /> : <icons.more size={18} />}
            >
              More
            </Button>
          ) : (
            <ActionIcon
              ref={more}
              onMouseDown={keepFocus}
              variant="subtle"
              color="gray"
              aria-label={`More ${title} Actions`}
              disabled={tools.length === 0 && (mobile || edits.length === 0)}
              aria-busy={Boolean(busy) || undefined}
              aria-description={busy}
            >
              {busy ? <Loader size={16} /> : <icons.more size={18} />}
            </ActionIcon>
          )}
        </Menu.Target>
      </PopupTooltip>
      <Menu.Dropdown style={{ overflowY: "auto" }}>
        {!mobile && <ActionMenuItems groups={[edits]} />}
        {!mobile && edits.length > 0 && (listed.length > 0 || others.length > 0) && (
          <Menu.Divider />
        )}
        {listed.map((tool, index) => (
          <Fragment key={tool.id}>
            {index > 0 && <Menu.Divider />}
            <Menu.Label>{tool.label}</Menu.Label>
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
      </Menu.Dropdown>
    </Menu>
  );
  // A labelled box keeps its tools inside the text's corner, sharing its edge with the form's fields.
  const inside = Boolean(!mobile && !send && !hideTools && props.label && tools);
  const boxTools = (
    <div className={classes.tools}>
      {mobile && editButtons}
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
      {overlay && <div className={classes.overlay}>{overlay}</div>}
      {below && <div className={classes.below}>{below}</div>}
      {/* The tools, then the send, sit just above the keyboard. */}
      {(tools || send || submit || rightSection) && (
        <div className={classes.toolbar} onMouseDown={keepFocus}>
          <div className={classes.editActions} role="group" aria-label={`${title} Tools`}>
            {editButtons}
            {menu}
            {!tools && !send && rightSection}
          </div>
          {!submit && send && <div className={classes.sends}>{send}</div>}
        </div>
      )}
      {submit && (
        <div className={classes.sends}>
          {/* The form's named sends stand separately from its text tools. */}
          {submit?.map((each, index) => {
            const primary = index === submit.length - 1;
            const Glyph = each.icon ?? ArrowUp;
            return (
              <Button
                key={each.label}
                aria-label={each.label}
                variant={primary ? "filled" : "light"}
                radius="xl"
                size="sm"
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
      {popups && <div className={classes.anchor}>{popups}</div>}
    </div>
  );
  return (
    <>
      {busy && spins && <VisuallyHidden role="status">{busy}</VisuallyHidden>}
      {/* A phone box opens its editor, which shows the tools, so only the send stands beside it. */}
      {mobile && inline ? (
        editor(textarea)
      ) : (!phone && tools && !inside) || send ? (
        <div className={classes.columned}>
          {textarea}
          {!editing && !hideTools && (
            <div className={classes.tools}>
              {!phone && boxTools}
              {send}
            </div>
          )}
          {popups && <div className={classes.anchor}>{popups}</div>}
        </div>
      ) : (
        textarea
      )}
      {!editing && !(mobile && inline) && overlay}
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
