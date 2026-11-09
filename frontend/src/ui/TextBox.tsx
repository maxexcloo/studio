import {
  useEffect,
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
  Group,
  Loader,
  Menu,
  Modal,
  Textarea,
  Tooltip,
  type ModalProps,
  type TextareaProps,
  useProps,
} from "@mantine/core";
import { ArrowUp } from "lucide-react";
import { ActionBarGroups, ActionMenuItems, type Action } from "../features/gallery/ActionBar";
import { menuWidth } from "../theme";
import { icons } from "./icons";
import { copyText } from "./clipboard";
import { useKeyboard } from "./useKeyboard";
import { usePhone } from "./usePhone";
import classes from "./TextBox.module.css";

// Pressing ⋯ or a phone editor tool keeps focus (and the keyboard) in the text, so nothing that
// follows the focus (a sheet's header) moves the control from under the press.
const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * Every multi-line text box. Beside the text stand only `send` and, with `tools`, a ⋯ menu of the
 * box's own tools, then Copy (unless `copy` is off, where the page offers it) and Clear, which
 * turns into Undo until the text next changes. On phones the box is a summary of its text: tapping it opens it full screen with
 * those tools as buttons, since menus are awkward over the keyboard, then Done, and `below` under
 * the text; Done, Escape or dismissing the keyboard returns to the page. `submit` adds its send
 * arrow there too, so typing and sending take one tap. An `inline` box edits in place on phones
 * too, as on desktop.
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
  overlay,
  below,
  inline = false,
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
  /** The form's send action, offered in the phone editor beside Done. */
  submit?: { label: string; disabled: boolean; onSubmit: () => void };
}) {
  const phone = usePhone() && !inline;
  const [editing, setEditing] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [menuOpened, setMenuOpened] = useState(false);
  const keyboard = useKeyboard(editing, content);
  const deepest = useRef(0);
  const modal = useProps("Modal", {}, {} as Pick<ModalProps, "transitionProps">);
  const title = (typeof props.label === "string" && props.label) || props["aria-label"] || "Text";
  // How far the visible viewport is shorter than the editor, wherever iOS has scrolled it.
  const shortened = keyboard.top + keyboard.inset;
  useEffect(() => {
    deepest.current = editing ? Math.max(deepest.current, shortened) : 0;
    // Android hides the keyboard (Back) without blurring the field; the viewport grows back.
    if (deepest.current - shortened > 120) setEditing(false);
  }, [editing, shortened]);
  // Clear turns into Undo, which restores the text, until the text next changes.
  const [cleared, setCleared] = useState<string | null>(null);
  useEffect(() => {
    if (value) setCleared(null);
  }, [value]);
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
    cleared !== null && !value
      ? { id: "clear", label: "Undo", icon: icons.undo, onClick: () => onChange(cleared) }
      : {
          id: "clear",
          label: `Clear ${title}`,
          icon: icons.clear,
          disabled: !value || props.readOnly,
          onClick: () => {
            setCleared(value);
            onChange("");
          },
        },
  ];
  const menu = actions && (
    <Menu
      position="top-end"
      width={menuWidth}
      opened={menuOpened}
      onChange={setMenuOpened}
      // An item that moves focus itself (Custom… selects the text) keeps it; otherwise it returns.
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
        <ActionMenuItems groups={[actions]} />
      </Menu.Dropdown>
    </Menu>
  );
  const close = () => setEditing(false);
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const textarea = (
    <Textarea
      {...props}
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
    />
  );
  return (
    <>
      {menu || send ? (
        <div className={classes.columned}>
          {textarea}
          {!editing && !hideTools && (
            <div className={classes.tools}>
              {menu}
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
              <Group gap={4} wrap="nowrap">
                {actions || send ? (
                  <Group gap={4} wrap="nowrap" onMouseDown={keepFocus}>
                    {actions && <ActionBarGroups groups={[actions]} menuPosition="bottom-end" />}
                    {send}
                  </Group>
                ) : (
                  rightSection
                )}
                <Button size="compact-sm" variant={submit ? "default" : undefined} onClick={close}>
                  Done
                </Button>
                {submit && (
                  <ActionIcon
                    aria-label={submit.label}
                    radius="xl"
                    disabled={submit.disabled}
                    // Sending before the keyboard drops keeps the text's blur from closing first.
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => {
                      close();
                      submit.onSubmit();
                    }}
                  >
                    <ArrowUp size={16} />
                  </ActionIcon>
                )}
              </Group>
            </Modal.Header>
            <Modal.Body>
              <Textarea
                aria-label={title}
                description={props.description}
                placeholder={props.placeholder}
                maxLength={props.maxLength}
                spellCheck={props.spellCheck}
                variant="unstyled"
                classNames={{ root: classes.field, wrapper: classes.field, input: classes.input }}
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                // Dismissing the keyboard (iOS Done or hide) blurs the text and returns to the page.
                onBlur={close}
              />
              {overlay && <div className={classes.overlay}>{overlay}</div>}
              {below && <div className={classes.below}>{below}</div>}
            </Modal.Body>
          </Modal.Content>
        </Modal.Root>
      )}
    </>
  );
}
