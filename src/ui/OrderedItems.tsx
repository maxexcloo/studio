import type { ReactNode } from "react";
import { ActionIcon, Group, Stack, Tooltip } from "@mantine/core";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";

/** Ordered references and adapter stacks share native drag and keyboard actions. */
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
  const mime = `application/x-studio-order-${kind}`;
  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || to >= items.length) return;
    const next = [...items];
    next.splice(to, 0, ...next.splice(from, 1));
    onChange(next);
  }
  return (
    <Stack gap="xs" role="list">
      {items.map((item, index) => (
        <Group
          role="listitem"
          aria-label={`${kind} ${label(item)}`}
          key={identity(item)}
          wrap="nowrap"
          gap="xs"
          align="start"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(mime)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(event) => {
            const id = event.dataTransfer.getData(mime);
            if (!id) return;
            event.preventDefault();
            move(
              items.findIndex((item) => identity(item) === id),
              index,
            );
          }}
        >
          {items.length > 1 && (
            <Stack gap={0}>
              <Tooltip label={`Drag ${label(item)}`}>
                <ActionIcon
                  draggable
                  aria-label={`Drag ${label(item)}`}
                  variant="subtle"
                  color="gray"
                  style={{ cursor: "grab" }}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(mime, identity(item));
                    event.dataTransfer.effectAllowed = "move";
                  }}
                >
                  <GripVertical size={16} />
                </ActionIcon>
              </Tooltip>
              <ActionIcon
                aria-label={`Move ${label(item)} Earlier`}
                variant="subtle"
                color="gray"
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUp size={14} />
              </ActionIcon>
              <ActionIcon
                aria-label={`Move ${label(item)} Later`}
                variant="subtle"
                color="gray"
                disabled={index === items.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDown size={14} />
              </ActionIcon>
            </Stack>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>{children(item, index)}</div>
        </Group>
      ))}
    </Stack>
  );
}
