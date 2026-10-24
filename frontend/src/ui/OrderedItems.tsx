import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type Ref,
} from "react";
import { ActionIcon, Group, Stack, Tooltip } from "@mantine/core";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";

export type OrderedItemsProps<T> = {
  items: T[];
  identity: (item: T) => string;
  label: (item: T) => string;
  onChange: (items: T[]) => void;
  children: (item: T, index: number) => ReactNode;
  kind: "references" | "loras";
};

const loadSortable = () => import("./SortableOrderedItems");
const SortableOrderedItems = lazy(loadSortable) as <T>(props: OrderedItemsProps<T>) => ReactNode;

export function OrderedItemRow({
  elementRef,
  handleRef,
  isDragging = false,
  index,
  label,
  kind,
  count,
  move,
  children,
}: {
  elementRef?: Ref<HTMLDivElement>;
  handleRef?: Ref<HTMLButtonElement>;
  isDragging?: boolean;
  index: number;
  label: string;
  kind: "references" | "loras";
  count: number;
  move: (from: number, to: number) => void;
  children: ReactNode;
}) {
  const earlier = useRef<HTMLButtonElement>(null);
  const later = useRef<HTMLButtonElement>(null);
  const moved = useRef<"earlier" | "later">(undefined);
  // Keyboard moves keep focus on the moved item, switching buttons at either end.
  useLayoutEffect(() => {
    if (!moved.current) return;
    const target =
      moved.current === "earlier"
        ? index === 0
          ? later
          : earlier
        : index === count - 1
          ? earlier
          : later;
    target.current?.focus();
    moved.current = undefined;
  }, [index, count]);
  return (
    <Group
      ref={elementRef}
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
              disabled={!handleRef}
              aria-label={`Drag ${label}`}
              variant="subtle"
              color="gray"
              style={{ cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
            >
              <GripVertical size={16} />
            </ActionIcon>
          </Tooltip>
          <ActionIcon
            ref={earlier}
            aria-label={`Move ${label} Earlier`}
            variant="subtle"
            color="gray"
            disabled={index === 0}
            onClick={() => {
              moved.current = "earlier";
              move(index, index - 1);
            }}
          >
            <ArrowUp size={14} />
          </ActionIcon>
          <ActionIcon
            ref={later}
            aria-label={`Move ${label} Later`}
            variant="subtle"
            color="gray"
            disabled={index === count - 1}
            onClick={() => {
              moved.current = "later";
              move(index, index + 1);
            }}
          >
            <ArrowDown size={14} />
          </ActionIcon>
        </Stack>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </Group>
  );
}

function PlainOrderedItems<T>(props: OrderedItemsProps<T>) {
  const { items, identity, label, onChange, children, kind } = props;
  // Loads ordering ahead of a second item, so the list isn't replaced (and focus lost) when it arrives.
  useEffect(() => void loadSortable(), []);
  return (
    <Stack gap="xs" role="list">
      {items.map((item, index) =>
        items.length < 2 ? (
          <div key={identity(item)} role="listitem" aria-label={`${kind} ${label(item)}`}>
            {children(item, index)}
          </div>
        ) : (
          <OrderedItemRow
            key={identity(item)}
            index={index}
            label={label(item)}
            kind={kind}
            count={items.length}
            move={(from, to) => {
              const next = [...items];
              const [moved] = next.splice(from, 1);
              next.splice(to, 0, moved);
              onChange(next);
            }}
          >
            {children(item, index)}
          </OrderedItemRow>
        ),
      )}
    </Stack>
  );
}

/** References and adapter stacks share handle-only pointer, touch and keyboard ordering. */
export function OrderedItems<T>(props: OrderedItemsProps<T>) {
  if (props.items.length < 2) return <PlainOrderedItems {...props} />;
  return (
    <Suspense fallback={<PlainOrderedItems {...props} />}>
      <SortableOrderedItems {...props} />
    </Suspense>
  );
}
