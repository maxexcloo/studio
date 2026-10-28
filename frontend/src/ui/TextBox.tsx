import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
  Tooltip,
  type TextareaProps,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Copy, X } from "lucide-react";
import { copyText } from "./clipboard";
import { usePhone } from "./usePhone";
import classes from "./TextBox.module.css";

// Pressing Copy or Clear keeps focus (and the phone keyboard) in the text.
const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * Every multi-line text box. `tools` adds compact Copy and Clear (undoable) beside the box's own
 * right section. On phones, tapping the box opens it full screen with Copy, Clear and Done; Done,
 * Escape or dismissing the keyboard returns to the page.
 */
export function TextBox({
  value,
  onChange,
  tools = false,
  overlay,
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
}) {
  const phone = usePhone();
  const [editing, setEditing] = useState(false);
  const [height, setHeight] = useState<number>();
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const title = (typeof props.label === "string" && props.label) || props["aria-label"] || "Text";
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!editing || !viewport) return;
    let lowest = viewport.height;
    const resize = () => {
      lowest = Math.min(lowest, viewport.height);
      setHeight(viewport.height);
      // Android hides the keyboard (Back) without blurring the field; the viewport grows back.
      if (viewport.height - lowest > 120) setEditing(false);
    };
    resize();
    viewport.addEventListener("resize", resize);
    return () => viewport.removeEventListener("resize", resize);
  }, [editing]);
  function clear() {
    const previous = value;
    onChange("");
    const notification = notifications.show({
      message: (
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm">{title} cleared</Text>
          <Button
            data-composer-layer
            size="compact-xs"
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
    <Tooltip key="copy" label={`Copy ${title}`}>
      <ActionIcon
        aria-label={`Copy ${title}`}
        variant="subtle"
        color="gray"
        className={classes.tool}
        disabled={!value}
        onMouseDown={keepFocus}
        onClick={() => void copyText(value, title)}
      >
        <Copy size={16} />
      </ActionIcon>
    </Tooltip>,
    <Tooltip key="clear" label={`Clear ${title}`}>
      <ActionIcon
        aria-label={`Clear ${title}`}
        variant="subtle"
        color="gray"
        className={classes.tool}
        disabled={!value}
        onMouseDown={keepFocus}
        onClick={clear}
      >
        <X size={16} />
      </ActionIcon>
    </Tooltip>,
  ];
  // Multi-row boxes stack their actions in a column; a one-row box lines them up.
  const stacked = (props.minRows ?? 1) > 1;
  const close = () => setEditing(false);
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  return (
    <>
      <Textarea
        {...props}
        // While the phone editor is open, it alone is the box.
        aria-hidden={editing || undefined}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onClick={(event) => {
          onClick?.(event);
          if (phone && !props.readOnly && !props.disabled) setEditing(true);
        }}
        rightSection={
          tools ? (
            <Group gap={stacked ? 4 : 0} wrap="nowrap" align="flex-start">
              {rightSection}
              {stacked ? <Stack gap={4}>{actions}</Stack> : actions}
            </Group>
          ) : (
            rightSection
          )
        }
        rightSectionWidth={
          tools ? Number(rightSectionWidth ?? 36) + (stacked ? 40 : 72) : rightSectionWidth
        }
        rightSectionPointerEvents={tools ? "all" : props.rightSectionPointerEvents}
      />
      {!editing && overlay}
      {phone && (
        <Modal.Root
          opened={editing}
          onClose={close}
          fullScreen
          closeOnEscape={false}
          returnFocus={false}
          classNames={{ content: classes.content, body: classes.body }}
        >
          <Modal.Overlay />
          {/* Modal.Content drops onKeyDown, so Escape is caught in the capture phase. */}
          <Modal.Content
            data-composer-layer
            aria-label={title}
            style={{ height }}
            onKeyDownCapture={escape}
          >
            <Modal.Header>
              <Modal.Title>{title}</Modal.Title>
              <Group gap={4} wrap="nowrap">
                {actions}
                <Button size="compact-sm" onClick={close}>
                  Done
                </Button>
              </Group>
            </Modal.Header>
            <Modal.Body>
              <Textarea
                data-autofocus
                aria-label={title}
                placeholder={props.placeholder}
                maxLength={props.maxLength}
                spellCheck={props.spellCheck}
                variant="unstyled"
                classNames={{ root: classes.field, wrapper: classes.field, input: classes.input }}
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                // Editing carries on from the end of the text.
                onFocus={(event) =>
                  event.currentTarget.setSelectionRange(value.length, value.length)
                }
                // Dismissing the keyboard (iOS Done or hide) blurs the text and returns to the page.
                onBlur={close}
              />
              {overlay && <div className={classes.overlay}>{overlay}</div>}
            </Modal.Body>
          </Modal.Content>
        </Modal.Root>
      )}
    </>
  );
}
