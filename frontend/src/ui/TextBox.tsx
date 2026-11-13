import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import {
  ActionIcon,
  Button,
  FocusTrap,
  Loader,
  Menu,
  Modal,
  Textarea,
  Tooltip,
  type ModalProps,
  type TextareaProps,
  useProps,
} from "@mantine/core";
import { useMergedRef } from "@mantine/hooks";
import { ArrowUp, type LucideIcon } from "lucide-react";
import { ActionBarGroups, ActionMenuItems, type Action } from "./ActionBar";
import { menuWidth } from "../theme";
import { icons } from "./icons";
import { copyText } from "./clipboard";
import { popupLayer } from "./popupClicks";
import { useKeyboard, useKeyboardDrop } from "./useKeyboard";
import { usePhone } from "./usePhone";
import classes from "./TextBox.module.css";

// Pressing ⋯ or a phone editor tool keeps focus (and the keyboard) in the text, so nothing that
// follows the focus (a sheet's header) moves the control from under the press.
const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * Every multi-line text box. Beside the text stand only `send` and, with `tools`, a ⋯ menu of the
 * box's own tools, then Copy (unless `copy` is off, where the page offers it) and Clear (Reset
 * where `reset` holds the text to return to), which turns into Undo until the text next changes.
 * The menu is one level deep: a tool with options lists them under its name, first, rather than in
 * a submenu. On phones the box is a summary of its text: tapping it opens it full screen with
 * those tools as buttons, since menus are awkward over the keyboard, then Done, and `below` under
 * the text; Done, Escape or dismissing the keyboard returns to the page. There Clear stands beside
 * the sends, as in the composer, and `submit` adds its sends, the last one primary, so typing and
 * sending take one tap. An `inline` box edits in place on phones too, as on desktop.
 */
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
  /** The box's own tools, in its ⋯ menu before Copy and Clear. */
  tools?: Action[];
  /** Offers Copy among the tools; off where the page already has it (the viewer's bar). */
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
    /** A shorter name to show, where the label is long (Ask for a Change shows Ask). */
    text?: string;
    icon?: LucideIcon;
    disabled: boolean;
    keepOpen?: boolean;
    onSubmit: () => void;
  }[];
}) {
  const phone = usePhone() && !inline;
  const [editing, setEditing] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [menuOpened, setMenuOpened] = useState(false);
  const keyboard = useKeyboard(editing, content);
  const modal = useProps("Modal", {}, {} as Pick<ModalProps, "transitionProps">);
  const title = (typeof props.label === "string" && props.label) || props["aria-label"] || "Text";
  useKeyboardDrop(editing, () => setEditing(false));
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
          label: `${reset === undefined ? "Clear" : "Reset"} ${title}`,
          icon: reset === undefined ? icons.clear : icons.reset,
          disabled: value === start || props.readOnly,
          onClick: () => {
            setCleared(value);
            onChange(start);
          },
        };
  const actions: Action[] | undefined = tools && [
    ...tools,
    ...(copy
      ? [
          {
            id: "copy",
            label: `Copy ${title}`,
            icon: icons.copy,
            disabled: !value,
            onClick: () => void copyText(value, title),
          },
        ]
      : []),
    clear,
  ];
  // The phone editor's tools, Clear standing beside the sends instead.
  const editorTools = actions?.filter((action) => action !== clear);
  // What a tool is doing shows over the text with a spinner, where the person is looking, phone
  // editor included; it stands in for the box's description meanwhile.
  const description = busy ? (
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
  const listed = actions?.filter((action) => action.menu);
  const plain = actions?.filter((action) => !action.menu);
  const menu = actions && (
    <Menu
      position="top-end"
      width={menuWidth}
      opened={menuOpened}
      onChange={setMenuOpened}
      // An item that moves focus itself (Ask for a Change… selects the text) keeps it; otherwise it
      // returns.
      returnFocus={false}
      onClose={() =>
        setTimeout(() => {
          if (!document.activeElement || document.activeElement === document.body)
            more.current?.focus({ preventScroll: true });
        })
      }
    >
      <Tooltip label={busy || "More Actions"} disabled={menuOpened}>
        <Menu.Target>
          <ActionIcon
            ref={more}
            onMouseDown={keepFocus}
            variant="subtle"
            color="gray"
            aria-label={`More ${title} Actions`}
            aria-busy={Boolean(busy) || undefined}
            aria-description={busy}
          >
            {busy ? <Loader size={16} /> : <icons.more size={18} />}
          </ActionIcon>
        </Menu.Target>
      </Tooltip>
      <Menu.Dropdown>
        {listed!.map((tool) => (
          <Fragment key={tool.id}>
            <Menu.Label>{tool.label}</Menu.Label>
            <ActionMenuItems
              groups={tool.menu!.map((group) =>
                group.map((option) => ({ ...option, disabled: option.disabled || tool.disabled })),
              )}
            />
            <Menu.Divider />
          </Fragment>
        ))}
        <ActionMenuItems groups={[plain!]} />
      </Menu.Dropdown>
    </Menu>
  );
  const close = () => setEditing(false);
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    // A tool's menu, portalled outside the editor, closes on its own Escape first.
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
      rightSection={editing ? undefined : rightSection}
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
  return (
    <>
      {/* A phone box opens its editor, which shows the tools, so only the send stands beside it. */}
      {(!phone && menu) || send ? (
        <div className={classes.columned}>
          {textarea}
          {!editing && !hideTools && (
            <div className={classes.tools}>
              {!phone && menu}
              {send}
            </div>
          )}
          {popups && <div className={classes.anchor}>{popups}</div>}
        </div>
      ) : (
        textarea
      )}
      {!editing && overlay}
      {below}
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
              <Button size="compact-sm" variant="subtle" onClick={close}>
                Done
              </Button>
            </Modal.Header>
            <Modal.Body>
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
                  if (!(event.relatedTarget as Element | null)?.closest(popupLayer)) close();
                }}
              />
              {overlay && <div className={classes.overlay}>{overlay}</div>}
              {below && <div className={classes.below}>{below}</div>}
              {/* The tools, then the send, sit just above the keyboard. */}
              {(actions || send || submit || rightSection) && (
                <div className={classes.toolbar} onMouseDown={keepFocus}>
                  {actions ? (
                    <ActionBarGroups
                      groups={[editorTools!]}
                      labelled={editorTools!.map((action) => action.id)}
                      menuPosition="top-start"
                    />
                  ) : (
                    !send && rightSection
                  )}
                  <div className={classes.sends}>
                    {actions && (
                      <Tooltip label={clear.label}>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="lg"
                          aria-label={clear.label}
                          disabled={clear.disabled}
                          onClick={clear.onClick}
                        >
                          {clear.icon && <clear.icon size={18} />}
                        </ActionIcon>
                      </Tooltip>
                    )}
                    {/* The form's named sends stand in for its compact ones there. */}
                    {!submit && send}
                    {/* Named, as the keyboard leaves room: the last send is primary, after an arrow. */}
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
                          {each.text ?? each.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </Modal.Body>
          </Modal.Content>
        </Modal.Root>
      )}
    </>
  );
}
