import { useState, type ReactNode } from "react";
import {
  ActionIcon,
  Group,
  Menu,
  Table,
  UnstyledButton,
  VisuallyHidden,
  type MantineBreakpoint,
} from "@mantine/core";
import { ChevronDown, ChevronsUpDown, ChevronUp, Ellipsis } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";

export interface DataColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Makes the header sort the rows by this value; missing values sort last. */
  sortValue?: (row: T) => string | number | undefined;
  /** Hides the column on smaller screens; put what it shows in the main cell there instead. */
  visibleFrom?: MantineBreakpoint;
  width?: number;
  /** The column that takes the free width and lets its text truncate. */
  main?: boolean;
}
type Sort = { key: string; descending: boolean };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
function compare(a: string | number | undefined, b: string | number | undefined) {
  if (a === undefined || a === "") return b === undefined || b === "" ? 0 : 1;
  if (b === undefined || b === "") return -1;
  return typeof a === "number" && typeof b === "number" ? a - b : collator.compare(`${a}`, `${b}`);
}

/**
 * Every list of records renders through this one Mantine table: sortable headers, the section's
 * text query, one empty line, a loading state and a row actions menu. Rows are named by `rowName`
 * for their accessible label and the actions trigger. Without `initialSort` rows keep the order
 * they arrive in, which matters for queues and histories.
 */
export function DataTable<T>({
  label,
  rows,
  rowKey,
  rowName,
  columns,
  rowActions,
  query = "",
  searchText,
  initialSort,
  empty,
  loading,
  minWidth,
}: {
  label: string;
  rows: T[];
  rowKey: (row: T) => string;
  rowName: (row: T) => string;
  columns: DataColumn<T>[];
  /** Menu items for the row, or null when it has none. */
  rowActions?: (row: T) => ReactNode;
  query?: string;
  /** The text the query matches; every word of the query must appear. */
  searchText?: (row: T) => (string | number | undefined | null | false)[];
  initialSort?: Sort;
  /** Shown when there are no rows; a query that hides every row shows No Matches. */
  empty: string;
  /** The loading label while the rows are fetched. */
  loading?: string | false;
  /** For editable grids that cannot drop columns: scroll sideways below this width. */
  minWidth?: number;
}) {
  const [sort, setSort] = useState<Sort | undefined>(initialSort);
  if (loading) return <LoadingState label={loading} />;
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matching =
    terms.length && searchText
      ? rows.filter((row) => {
          const text = searchText(row).filter(Boolean).join(" ").toLowerCase();
          return terms.every((term) => text.includes(term));
        })
      : rows;
  if (!matching.length) return <EmptyState>{rows.length ? "No Matches" : empty}</EmptyState>;
  const sortValue = columns.find((column) => column.key === sort?.key)?.sortValue;
  const sorted =
    sort && sortValue
      ? [...matching].sort((a, b) => {
          const order = compare(sortValue(a), sortValue(b));
          return sort.descending && order ? -order : order;
        })
      : matching;
  const table = (
    <Table aria-label={label} verticalSpacing="xs" highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          {columns.map((column) => {
            const active = sort?.key === column.key;
            const Icon = !active ? ChevronsUpDown : sort.descending ? ChevronDown : ChevronUp;
            return (
              <Table.Th
                key={column.key}
                visibleFrom={column.visibleFrom}
                w={column.width}
                aria-sort={
                  column.sortValue
                    ? active
                      ? sort.descending
                        ? "descending"
                        : "ascending"
                      : "none"
                    : undefined
                }
              >
                {column.sortValue ? (
                  <UnstyledButton
                    fw="inherit"
                    fz="inherit"
                    onClick={() =>
                      setSort({ key: column.key, descending: active && !sort.descending })
                    }
                  >
                    <Group gap={4} wrap="nowrap">
                      {column.header}
                      <Icon size={14} opacity={active ? 1 : 0.4} aria-hidden />
                    </Group>
                  </UnstyledButton>
                ) : (
                  column.header
                )}
              </Table.Th>
            );
          })}
          {rowActions && (
            <Table.Th w={44}>
              <VisuallyHidden>Actions</VisuallyHidden>
            </Table.Th>
          )}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {sorted.map((row) => {
          const name = rowName(row);
          const actions = rowActions?.(row);
          return (
            <Table.Tr key={rowKey(row)} aria-label={name}>
              {columns.map((column) => (
                <Table.Td
                  key={column.key}
                  visibleFrom={column.visibleFrom}
                  maw={column.main ? 0 : undefined}
                  w={column.main ? "100%" : undefined}
                >
                  {column.cell(row)}
                </Table.Td>
              ))}
              {rowActions && (
                <Table.Td>
                  {actions && (
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          aria-label={`Actions for ${name}`}
                        >
                          <Ellipsis size={18} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>{actions}</Menu.Dropdown>
                    </Menu>
                  )}
                </Table.Td>
              )}
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
  return minWidth ? (
    <Table.ScrollContainer minWidth={minWidth}>{table}</Table.ScrollContainer>
  ) : (
    table
  );
}
