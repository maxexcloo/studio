import {
  Children,
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
  Modal,
  Text,
  Textarea,
  Tooltip,
  type ModalProps,
  type TextareaProps,
  useProps,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ArrowUp, Check } from "lucide-react";
import { icons } from "./icons";
import { useCopy } from "./clipboard";
import { useKeyboard } from "./useKeyboard";
import { usePhone } from "./usePhone";
import classes from "./TextBox.module.css";

// Pressing Copy or Clear keeps focus (and the phone keyboard) in the text.
const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * Every multi-line text box. `tools` adds compact Copy, Clear (undoable) and the box's own actions
 * beside the text, in a column where the box is tall enough and otherwise in pairs side by side
 * (2×2 for four), on every breakpoint. On phones the box is a summary of its text: tapping
 * it opens it full screen with the same right section or tools and Done, and `below` under the
 * text; Done, Escape or dismissing the keyboard returns to the page. `submit` adds its send arrow
 * there too, so typing and sending take one tap. An `inline` box edits in place on phones too, as
 * on desktop.
 */
export function TextBox({
  value,
  onChange,
  tools,
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
  /** The box's own actions, after Copy and Clear. */
  tools?: ReactNode[];
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
  const keyboard = useKeyboard(editing, content);
  const deepest = useRef(0);
  const modal = useProps("Modal", {}, {} as Pick<ModalProps, "transitionProps">);
  const latest = useRef({ value, onChange });
  const { copied, copy } = useCopy();
  latest.current = { value, onChange };
  const title = (typeof props.label === "string" && props.label) || props["aria-label"] || "Text";
  // How far the visible viewport is shorter than the editor, wherever iOS has scrolled it.
  const shortened = keyboard.top + keyboard.inset;
  useEffect(() => {
    deepest.current = editing ? Math.max(deepest.current, shortened) : 0;
    // Android hides the keyboard (Back) without blurring the field; the viewport grows back.
    if (deepest.current - shortened > 120) setEditing(false);
  }, [editing, shortened]);
  function clear() {
    const previous = value;
    onChange("");
    const notification = notifications.show({
      message: (
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm">{title} cleared</Text>
          <Button
            data-composer-layer
            size="compact-sm"
            variant="subtle"
            onClick={() => {
              notifications.hide(notification);
              // Only an untouched clear is undone, so later typing is never overwritten.
              if (!latest.current.value) latest.current.onChange(previous);
            }}
          >
            Undo
          </Button>
        </Group>
      ),
    });
  }
  const actions = tools && [
    <Tooltip key="copy" label={copied ? "Copied" : `Copy ${title}`}>
      <ActionIcon
        aria-label={`Copy ${title}`}
        variant="subtle"
        color="gray"
        disabled={!value}
        onMouseDown={keepFocus}
        onClick={() => copy(value)}
      >
        {copied ? <Check size={16} /> : <icons.copy size={16} />}
      </ActionIcon>
    </Tooltip>,
    <Tooltip key="clear" label={`Clear ${title}`}>
      <ActionIcon
        aria-label={`Clear ${title}`}
        variant="subtle"
        color="gray"
        disabled={!value || props.readOnly}
        onMouseDown={keepFocus}
        onClick={clear}
      >
        <icons.clear size={16} />
      </ActionIcon>
    </Tooltip>,
    ...Children.toArray(tools),
  ];
  const pairs =
    actions &&
    Array.from({ length: Math.ceil(actions.length / 2) }, (_, index) => (
      <div key={index} className={classes.pair}>
        {actions.slice(index * 2, index * 2 + 2)}
      </div>
    ));
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
      {pairs ? (
        <div
          className={classes.columned}
          style={
            { "--tool-pair-rows": hideTools ? 0 : Math.ceil(pairs.length / 2) } as CSSProperties
          }
        >
          {textarea}
          {!editing && !hideTools && (
            <div className={classes.tools}>
              <div className={classes.toolGrid}>{pairs}</div>
            </div>
          )}
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
                {actions || rightSection}
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
