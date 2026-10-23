import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Group,
  Menu,
  Select,
  Stack,
  Table,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { ArrowDown, ArrowUp, ChevronsUpDown, Ellipsis } from "lucide-react";
import { EmptyState } from "../../ui/EmptyState";
import { SearchInput } from "../../ui/SearchInput";
import { modelFamilyLabel } from "../../ui/modelFamily";

export interface LibraryItem {
  key: string;
  title?: string;
  name?: string;
  file?: string;
  installed: boolean;
  note?: string;
  description?: string;
  families?: string[];
  type?: string;
  kind?: string;
  folder?: string;
  modelType?: "original" | "finetune";
  update?: {
    state: string;
    note?: string;
    latest?: UpdateChoice;
    freeAlternative?: UpdateChoice;
  };
  applied?: { state: string; note?: string };
}
interface UpdateChoice {
  name: string;
  downloadable?: boolean;
  unavailable?: { reason: string; note?: string };
}
const modelKinds: Record<string, string> = {
  checkpoint: "Checkpoint",
  clip_vision: "CLIP Vision",
  diffusion_model: "Diffusion Model",
  model: "Model",
  text_encoder: "Text Encoder",
  vae: "VAE",
};
const modelFolders: Record<string, string> = {
  checkpoints: "checkpoint",
  clip_vision: "clip_vision",
  diffusion_models: "diffusion_model",
  text_encoders: "text_encoder",
  vae: "vae",
};
const loraTypes: Record<string, string> = {
  character: "Character",
  concept: "Concept",
  slider: "Slider",
  style: "Style",
};
export function libraryItemCategory(item: LibraryItem) {
  const kind = item.kind === "lora" ? "loras" : modelKinds[item.kind || ""] ? "models" : undefined;
  const folder =
    item.folder === "loras" ? "loras" : modelFolders[item.folder || ""] ? "models" : undefined;
  return kind && folder && kind !== folder ? "unclassified" : kind || folder || "unclassified";
}
const resourceName = (item: LibraryItem) => item.title || item.name || item.file || item.key;
const canUpdate = (item: LibraryItem) =>
  item.installed &&
  item.update?.state === "available" &&
  !["downloading", "kept", "removed"].includes(item.applied?.state || "");
const familiesOf = (item: LibraryItem) =>
  item.families?.length ? item.families : ["Unclassified"];
function resourceType(item: LibraryItem) {
  if (libraryItemCategory(item) === "unclassified") return "Unclassified";
  if (libraryItemCategory(item) === "loras")
    return loraTypes[item.type || ""] || item.type || "Unclassified";
  return (
    modelKinds[item.kind || ""] || modelKinds[modelFolders[item.folder || ""]] || "Unclassified"
  );
}
const modelTypeName = (item: LibraryItem) =>
  item.modelType === "original"
    ? "Original"
    : item.modelType === "finetune"
      ? "Finetune"
      : "Unclassified";
type SortField = "resource" | "family" | "modelType" | "type" | "status";
const columns: { field: SortField; label: string }[] = [
  { field: "resource", label: "Resource" },
  { field: "family", label: "Family" },
  { field: "type", label: "Type" },
  { field: "status", label: "Status" },
];

/** Both catalogues use the same dense searchable, filterable and sortable table. */
export function LibraryCatalogueTable({
  items,
  label,
  onUpdate,
  updatePending = false,
}: {
  items: LibraryItem[];
  label: "Models" | "LoRAs";
  onUpdate?: (item: LibraryItem, alternative?: boolean) => void;
  updatePending?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [installed, setInstalled] = useState<string | null>(null);
  const [modelType, setModelType] = useState<string | null>(null);
  const [sort, setSort] = useState<SortField>("resource");
  const [descending, setDescending] = useState(false);
  const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
  const displayFamilies = (item: LibraryItem) =>
    familiesOf(item).map((family) => modelFamilyLabel(family));
  const families = unique(items.flatMap(displayFamilies));
  const visibleColumns =
    label === "Models"
      ? [
          ...columns.slice(0, 2),
          { field: "modelType" as const, label: "Model Type" },
          ...columns.slice(2),
        ]
      : columns;
  const types = unique(items.map(resourceType));
  const sortValue = (item: LibraryItem) =>
    ({
      resource: resourceName(item),
      family: displayFamilies(item).join(", "),
      modelType: modelTypeName(item),
      type: resourceType(item),
      status: item.installed ? "Installed" : "Not Installed",
    })[sort];
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = items
    .filter((item) => {
      if (family && !displayFamilies(item).includes(family)) return false;
      if (label === "Models" && modelType && (item.modelType || "unclassified") !== modelType)
        return false;
      if (type && resourceType(item) !== type) return false;
      if (
        installed === "updates"
          ? !canUpdate(item) &&
            !(item.installed && item.applied && item.applied.state !== "removed")
          : installed && item.installed !== (installed === "installed")
      )
        return false;
      const text = [
        resourceName(item),
        item.file,
        item.key,
        item.description,
        item.note,
        familiesOf(item).join(" "),
        displayFamilies(item).join(" "),
        ...(label === "Models" ? [modelTypeName(item)] : []),
        resourceType(item),
        item.installed ? "Installed" : "Not Installed",
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .sort(
      (a, b) =>
        (descending ? -1 : 1) *
        sortValue(a).localeCompare(sortValue(b), undefined, { numeric: true }),
    );
  const unclassified = items.filter((item) => libraryItemCategory(item) === "unclassified").length;
  return (
    <Stack gap="md">
      <SearchInput
        aria-label={`Search ${label}`}
        placeholder={`Search ${label}…`}
        value={query}
        onClear={() => setQuery("")}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <Group align="end" grow>
        <Select
          label="Family"
          aria-label={`${label} Family`}
          placeholder="All Families"
          data={families}
          value={family}
          onChange={setFamily}
          clearable
          searchable
          style={{ minWidth: 140 }}
        />
        <Select
          label="Type"
          aria-label={`${label} Type`}
          placeholder="All Types"
          data={types}
          value={type}
          onChange={setType}
          clearable
          style={{ minWidth: 140 }}
        />
        {label === "Models" && (
          <Select
            label="Model Type"
            aria-label="Models Model Type"
            placeholder="All Model Types"
            data={[
              { value: "original", label: "Original" },
              { value: "finetune", label: "Finetune" },
              { value: "unclassified", label: "Unclassified" },
            ]}
            value={modelType}
            onChange={setModelType}
            clearable
          />
        )}
        <Select
          label="Status"
          aria-label={`${label} Status`}
          placeholder="All Statuses"
          data={[
            { value: "installed", label: "Installed" },
            { value: "not-installed", label: "Not Installed" },
            { value: "updates", label: "Updates" },
          ]}
          value={installed}
          onChange={setInstalled}
          clearable
          style={{ minWidth: 140 }}
        />
      </Group>
      {unclassified > 0 && (
        <Text c="dimmed" size="sm">
          {unclassified} unclassified {unclassified === 1 ? "resource has" : "resources have"}{" "}
          missing or conflicting model/LoRA metadata.
        </Text>
      )}
      <Table.ScrollContainer minWidth={label === "Models" ? 680 : 560}>
        <Table
          aria-label={`Library ${label}`}
          verticalSpacing="xs"
          horizontalSpacing="sm"
          highlightOnHover
        >
          <Table.Thead>
            <Table.Tr>
              {visibleColumns.map((column) => {
                const active = sort === column.field;
                const Icon = active ? (descending ? ArrowDown : ArrowUp) : ChevronsUpDown;
                return (
                  <Table.Th
                    key={column.field}
                    aria-sort={active ? (descending ? "descending" : "ascending") : "none"}
                  >
                    <UnstyledButton
                      aria-label={`Sort ${label} by ${column.label}`}
                      onClick={() => {
                        setDescending(active ? !descending : false);
                        setSort(column.field);
                      }}
                      style={{ width: "100%" }}
                    >
                      <Group gap="xs" justify="space-between" wrap="nowrap">
                        <Text size="sm" fw={600}>
                          {column.label}
                        </Text>
                        <Icon size={14} aria-hidden="true" />
                      </Group>
                    </UnstyledButton>
                  </Table.Th>
                );
              })}
              {onUpdate && <Table.Th>Actions</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.length ? (
              rows.map((item) => (
                <Table.Tr key={item.key}>
                  <Table.Td>
                    <Stack gap={2}>
                      <Text size="sm" fw={500}>
                        {resourceName(item)}
                      </Text>
                      {item.description && (
                        <Text size="xs" c="dimmed">
                          {item.description}
                        </Text>
                      )}
                      {item.note && (
                        <Text size="xs" c="dimmed">
                          {item.note}
                        </Text>
                      )}
                      {canUpdate(item) && (
                        <Text size="xs">
                          Update Available: {item.update?.latest?.name}
                          {item.update?.note ? ` · ${item.update.note}` : ""}
                        </Text>
                      )}
                      {item.update?.state === "error" && item.update.note && (
                        <Text size="xs" c="red">
                          {item.update.note}
                        </Text>
                      )}
                      {item.applied?.note && (
                        <Text size="xs" c={item.applied.state === "failed" ? "red" : "dimmed"}>
                          {item.applied.note}
                        </Text>
                      )}
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{displayFamilies(item).join(", ")}</Text>
                  </Table.Td>
                  {label === "Models" && (
                    <Table.Td>
                      <Text size="sm">{modelTypeName(item)}</Text>
                    </Table.Td>
                  )}
                  <Table.Td>
                    <Text size="sm">{resourceType(item)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={item.installed ? "green" : "gray"} size="sm">
                      {item.applied?.state === "downloading"
                        ? "Updating"
                        : canUpdate(item)
                          ? "Update Available"
                          : item.installed
                            ? "Installed"
                            : "Not Installed"}
                    </Badge>
                  </Table.Td>
                  {onUpdate && (
                    <Table.Td>
                      {canUpdate(item) && (
                        <Menu position="bottom-end">
                          <Menu.Target>
                            <ActionIcon
                              variant="subtle"
                              aria-label={`Update Actions for ${resourceName(item)}`}
                              disabled={updatePending}
                            >
                              <Ellipsis size={18} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            {item.update?.latest?.downloadable &&
                            !item.update.latest.unavailable ? (
                              <Menu.Item onClick={() => onUpdate(item)}>
                                Update to {item.update.latest.name}
                              </Menu.Item>
                            ) : item.update?.freeAlternative?.downloadable &&
                              !item.update.freeAlternative.unavailable ? (
                              <Menu.Item onClick={() => onUpdate(item, true)}>
                                Update to {item.update.freeAlternative.name}
                              </Menu.Item>
                            ) : (
                              <Menu.Item disabled>
                                {item.update?.latest?.unavailable?.note ||
                                  "This update cannot be downloaded."}
                              </Menu.Item>
                            )}
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </Table.Td>
                  )}
                </Table.Tr>
              ))
            ) : (
              <Table.Tr>
                <Table.Td colSpan={visibleColumns.length + (onUpdate ? 1 : 0)}>
                  <EmptyState>
                    {items.length
                      ? `No ${label.toLowerCase()} match your filters.`
                      : `No ${label.toLowerCase()} to show.`}
                  </EmptyState>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
