import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Menu,
  Select,
  Stack,
  Table,
  Text,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { Ellipsis, RefreshCw } from "lucide-react";
import { copyText } from "../../ui/clipboard";
import { EmptyState } from "../../ui/EmptyState";
import { modelFamilyLabel } from "../../ui/modelFamily";
import { SectionToolbar } from "../../ui/SectionToolbar";

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
  links?: { civitaiCom?: string; civitaiRed?: string; hf?: string };
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
const modelTypes: Record<string, string> = { original: "Original", finetune: "Finetune" };
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
const updating = (item: LibraryItem) =>
  canUpdate(item) || (item.installed && !!item.applied && item.applied.state !== "removed");
const familiesOf = (item: LibraryItem) =>
  item.families?.length
    ? item.families.map((family) => modelFamilyLabel(family))
    : ["Unclassified"];
/** Shared files (a VAE many families use) name the first two and count the rest. */
function familySummary(item: LibraryItem) {
  const families = familiesOf(item);
  return families.length > 2
    ? `${families.slice(0, 2).join(", ")} +${families.length - 2}`
    : families.join(", ");
}
function resourceType(item: LibraryItem) {
  if (libraryItemCategory(item) === "unclassified") return "Unclassified";
  if (libraryItemCategory(item) === "loras")
    return loraTypes[item.type || ""] || item.type || "Unclassified";
  return (
    modelKinds[item.kind || ""] || modelKinds[modelFolders[item.folder || ""]] || "Unclassified"
  );
}
const statusOf = (item: LibraryItem) =>
  item.applied?.state === "downloading"
    ? { label: "Updating", color: "blue" }
    : canUpdate(item)
      ? { label: "Update Available", color: "yellow" }
      : item.installed
        ? { label: "Installed", color: "green" }
        : { label: "Not Installed", color: "gray" };
const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
const views = [
  { value: "installed", label: "Installed" },
  { value: "available", label: "Available" },
  { value: "updates", label: "Updates" },
];

/** Models and LoRAs share one compact catalogue: views, search, filters and row actions. */
export function LibraryCatalogueTable({
  items,
  label,
  onUpdate,
  onCheckUpdates,
  checkingUpdates = false,
  onEdit,
  updatePending = false,
}: {
  items: LibraryItem[];
  label: "Models" | "LoRAs";
  onUpdate?: (item: LibraryItem, alternative?: boolean) => void;
  onCheckUpdates?: () => void;
  checkingUpdates?: boolean;
  onEdit?: (item: LibraryItem) => void;
  updatePending?: boolean;
}) {
  const [view, setView] = useState("installed");
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [modelType, setModelType] = useState<string | null>(null);
  const models = label === "Models";
  // Whether a model is an original or a finetune is shown only where the catalogue says so.
  const withModelType = models && items.some((item) => item.modelType);
  const typeLabel = (item: LibraryItem) =>
    [resourceType(item), item.modelType && modelTypes[item.modelType]].filter(Boolean).join(" · ");
  const inView = items.filter((item) =>
    view === "updates" ? updating(item) : item.installed === (view === "installed"),
  );
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = inView.filter((item) => {
    if (family && !familiesOf(item).includes(family)) return false;
    if (type && resourceType(item) !== type) return false;
    if (modelType && (item.modelType || "unclassified") !== modelType) return false;
    const text = [
      resourceName(item),
      item.file,
      item.description,
      item.note,
      ...(item.families || []),
      ...familiesOf(item),
      typeLabel(item),
      statusOf(item).label,
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const filterCount = Number(!!family) + Number(!!type) + Number(!!modelType);
  const noun = label === "LoRAs" ? "LoRAs" : "Models";
  const unclassified = items.filter((item) => libraryItemCategory(item) === "unclassified").length;
  return (
    <Stack gap="md">
      <SectionToolbar
        label={label}
        views={views}
        view={view}
        onViewChange={setView}
        query={query}
        onQueryChange={setQuery}
        filters={
          <>
            <Select
              label="Family"
              placeholder="All Families"
              data={unique(items.flatMap(familiesOf))}
              value={family}
              onChange={setFamily}
              clearable
              searchable
              openOnFocus={false}
              comboboxProps={{ withinPortal: false }}
              data-mantine-stop-propagation
            />
            <Select
              label="Type"
              placeholder="All Types"
              data={unique(items.map(resourceType))}
              value={type}
              onChange={setType}
              clearable
              comboboxProps={{ withinPortal: false }}
              data-mantine-stop-propagation
            />
            {withModelType && (
              <Select
                label="Model Type"
                placeholder="All Model Types"
                data={[
                  { value: "original", label: "Original" },
                  { value: "finetune", label: "Finetune" },
                  { value: "unclassified", label: "Unclassified" },
                ]}
                value={modelType}
                onChange={setModelType}
                clearable
                comboboxProps={{ withinPortal: false }}
                data-mantine-stop-propagation
              />
            )}
          </>
        }
        filterCount={filterCount}
        onResetFilters={() => {
          setFamily(null);
          setType(null);
          setModelType(null);
        }}
        actions={
          onCheckUpdates && (
            <Tooltip label="Check Updates">
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label="Check Updates"
                loading={checkingUpdates}
                disabled={updatePending}
                onClick={onCheckUpdates}
              >
                <RefreshCw size={18} />
              </ActionIcon>
            </Tooltip>
          )
        }
      />
      {unclassified > 0 && (
        <Text c="dimmed" size="xs">
          {unclassified} {unclassified === 1 ? "resource has" : "resources have"} missing or
          conflicting model or LoRA metadata.
        </Text>
      )}
      {rows.length ? (
        <Table aria-label={`Library ${label}`} verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th visibleFrom="sm" w={170}>
                Family
              </Table.Th>
              <Table.Th visibleFrom="sm" w={150}>
                Type
              </Table.Th>
              <Table.Th w={130}>Status</Table.Th>
              <Table.Th w={44}>
                <VisuallyHidden>Actions</VisuallyHidden>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((item) => {
              const name = resourceName(item);
              const status = statusOf(item);
              const source = item.links?.civitaiCom || item.links?.hf || item.links?.civitaiRed;
              const latest = item.update?.latest;
              const free = item.update?.freeAlternative;
              return (
                <Table.Tr key={item.key}>
                  <Table.Td maw={0} w="100%">
                    <Text size="sm" fw={500} truncate>
                      {name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate hiddenFrom="sm">
                      {[familySummary(item), typeLabel(item)]
                        .filter((part) => part !== "Unclassified")
                        .join(" · ")}
                    </Text>
                    {(item.description || item.note) && (
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {item.description || item.note}
                      </Text>
                    )}
                    {canUpdate(item) && (
                      <Text size="xs">
                        Update Available: {latest?.name}
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
                  </Table.Td>
                  <Table.Td visibleFrom="sm">
                    <Text
                      size="sm"
                      lineClamp={2}
                      title={familiesOf(item).join(", ")}
                      c={item.families?.length ? undefined : "dimmed"}
                    >
                      {familySummary(item)}
                    </Text>
                  </Table.Td>
                  <Table.Td visibleFrom="sm">
                    <Text
                      size="sm"
                      c={typeLabel(item) === "Unclassified" ? "dimmed" : undefined}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {typeLabel(item)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={status.color} variant="light" size="sm" miw="max-content">
                      {status.label}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
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
                      <Menu.Dropdown>
                        {onUpdate &&
                          canUpdate(item) &&
                          (latest?.downloadable && !latest.unavailable ? (
                            <Menu.Item disabled={updatePending} onClick={() => onUpdate(item)}>
                              Update to {latest.name}
                            </Menu.Item>
                          ) : free?.downloadable && !free.unavailable ? (
                            <Menu.Item
                              disabled={updatePending}
                              onClick={() => onUpdate(item, true)}
                            >
                              Update to {free.name}
                            </Menu.Item>
                          ) : (
                            <Menu.Item disabled>
                              {latest?.unavailable?.note || "This update cannot be downloaded."}
                            </Menu.Item>
                          ))}
                        <Menu.Item
                          onClick={() => void copyText(item.file || item.key, "File name")}
                        >
                          Copy File Name
                        </Menu.Item>
                        {source && (
                          <Menu.Item
                            component="a"
                            href={source}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open Source Page
                          </Menu.Item>
                        )}
                        {onEdit && (
                          <Menu.Item onClick={() => onEdit(item)}>Edit Catalogue Entry</Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      ) : (
        <EmptyState
          title={
            inView.length
              ? `No Matching ${noun}`
              : view === "updates"
                ? "Everything Is Up to Date"
                : view === "installed"
                  ? `No ${noun} Installed`
                  : `No Other ${noun} Catalogued`
          }
        >
          {inView.length
            ? "Try another search or reset the filters."
            : view === "updates"
              ? onCheckUpdates
                ? "Check for updates to see newer versions of installed files."
                : "Installed files have no newer versions."
              : view === "installed"
                ? `${noun} on the workers show here.`
                : `Catalogued ${noun} that are not installed show here.`}
        </EmptyState>
      )}
    </Stack>
  );
}
