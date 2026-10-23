import type { ReactNode } from "react";
import { ActionIcon, Group, Stack, Tooltip } from "@mantine/core";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { Feedback } from "@dnd-kit/dom";
import { arrayMove } from "@dnd-kit/helpers";
import { useMotionDuration } from "./Appearance";

function OrderedItem({
  id,
  index,
  label,
  kind,
  count,
  move,
  duration,
  children,
}: {
  id: string;
  index: number;
  label: string;
  kind: "references" | "loras";
  count: number;
  move: (from: number, to: number) => void;
  duration: number;
  children: ReactNode;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id,
    index,
    type: kind,
    accept: kind,
    transition: { duration },
  });
  return (
    <Group
      ref={ref}
      role="listitem"
      aria-label={`${kind} ${label}`}
      wrap="nowrap"
      gap="xs"
      align="start"
    >
      {count > 1 && (
        <Stack gap={0}>
          <Tooltip label={`Drag ${label}`}>
            <ActionIcon
              ref={handleRef}
              aria-label={`Drag ${label}`}
              variant="subtle"
              color="gray"
              style={{ cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
            >
              <GripVertical size={16} />
            </ActionIcon>
          </Tooltip>
          <ActionIcon
            aria-label={`Move ${label} Earlier`}
            variant="subtle"
            color="gray"
            disabled={index === 0}
            onClick={() => move(index, index - 1)}
          >
            <ArrowUp size={14} />
          </ActionIcon>
          <ActionIcon
            aria-label={`Move ${label} Later`}
            variant="subtle"
            color="gray"
            disabled={index === count - 1}
            onClick={() => move(index, index + 1)}
          >
            <ArrowDown size={14} />
          </ActionIcon>
        </Stack>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </Group>
  );
}

/** References and adapter stacks share handle-only pointer, touch and keyboard ordering. */
export function OrderedItems<T>({
  items,
  identity,
  label,
  onChange,
  children,
  kind,
}: {
  items: T[];
  identity: (item: T) => string;
  label: (item: T) => string;
  onChange: (items: T[]) => void;
  children: (item: T, index: number) => ReactNode;
  kind: "references" | "loras";
}) {
  const duration = useMotionDuration();
  if (items.length < 2)
    return (
      <Stack gap="xs" role="list">
        {items.map((item, index) => (
          <div key={identity(item)} role="listitem" aria-label={`${kind} ${label(item)}`}>
            {children(item, index)}
          </div>
        ))}
      </Stack>
    );
  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || to >= items.length) return;
    onChange(arrayMove(items, from, to));
  }
  return (
    <DragDropProvider
      plugins={(defaults) =>
        defaults.map((plugin) =>
          plugin === Feedback
            ? Feedback.configure({
                dropAnimation: duration ? { duration } : null,
                keyboardTransition: duration ? { duration } : null,
              })
            : plugin,
        )
      }
      onDragEnd={(event) => {
        if (event.canceled) return;
        const { source } = event.operation;
        // Optimistic sorting updates the source's index before React receives the drop.
        if (isSortable(source)) move(source.initialIndex, source.index);
      }}
    >
      <Stack gap="xs" role="list">
        {items.map((item, index) => (
          <OrderedItem
            key={identity(item)}
            id={identity(item)}
            index={index}
            label={label(item)}
            kind={kind}
            count={items.length}
            move={move}
            duration={duration}
          >
            {children(item, index)}
          </OrderedItem>
        ))}
      </Stack>
    </DragDropProvider>
  );
}
