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
  Modal,
  Stack,
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
 * Every multi-line text box. `tools` adds compact Copy and Clear (undoable) beside the box's own
 * right section: a multi-row box on desktop lines them all up in one column beside the text, so
 * the text keeps the box's full height; a one-row box and the phone summary keep them inside. On
 * phones the box is a summary of its text: tapping it (or `edit`) opens it full screen with the
 * same right section, Copy, Clear and Done, and `below` under the text; Done, Escape or
 * dismissing the keyboard returns to the page. `submit` adds its send arrow there too,
 * so typing and sending take one tap. An `inline` box edits in place on phones too, as on desktop.
 */
export function TextBox({
  value,
  onChange,
  tools = false,
  overlay,
  below,
  inline = false,
  submit,
  rightSection,
  rightSectionWidth,
  onClick,
  ...props
}: Omit<TextareaProps, "value" | "onChange"> & {
  ref?: Ref<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  tools?: boolean;
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
  const actions = [
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
        disabled={!value}
        onMouseDown={keepFocus}
        onClick={clear}
      >
        <icons.clear size={16} />
      </ActionIcon>
    </Tooltip>,
  ];
  // Multi-row boxes stack their actions in a column; a one-row box lines them up.
  const stacked = (props.minRows ?? 1) > 1;
  const column = tools && stacked && !phone;
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
      rightSection={
        editing || column ? undefined : tools ? (
          <Group gap={stacked ? 4 : 0} wrap="nowrap" align="flex-start">
            {stacked ? <Stack gap={4}>{rightSection}</Stack> : rightSection}
            {stacked ? <Stack gap={4}>{actions}</Stack> : actions}
          </Group>
        ) : (
          rightSection
        )
      }
      rightSectionWidth={
        column
          ? undefined
          : tools
            ? Number(rightSectionWidth ?? 36) + (stacked ? 40 : 72)
            : rightSectionWidth
      }
      rightSectionPointerEvents={tools ? "all" : props.rightSectionPointerEvents}
    />
  );
  return (
    <>
      {column ? (
        <div className={classes.columned}>
          {textarea}
          <Stack gap={4} className={classes.tools}>
            {rightSection}
            {actions}
          </Stack>
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
          classNames={{ content: classes.content, body: classes.body }}
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
                {rightSection}
                {actions}
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
