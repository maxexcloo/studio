import { Alert, Badge, Menu, Stack, Text, type TextProps, Tooltip } from "@mantine/core";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";

import { loraName } from "../../../../shared/profiles";
import { menuWidth } from "../../theme";
import { formatBytes } from "../../ui/bytes";
import { copyText } from "../../ui/clipboard";
import { DataTable, TableRecord, compareNames } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import {
  FilterChoices,
  SectionHeader,
  SectionToolbar,
  ToolbarAction,
} from "../../ui/SectionToolbar";
import { usePhone } from "../../ui/usePhone";
import { modelFamilyLabel } from "../generation/modelFamily";

export interface LibraryItem {
  key: string;
  title?: string;
  name?: string;
  file?: string;
  /** The file's SHA-256, where its source recorded one. */
  sha256?: string;
  installed: boolean;
  installable?: boolean;
  install?: { state: string; note?: string };
  note?: string;
  description?: string;
  bytes?: number;
  families?: string[];
  triggers?: string[];
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
  detector: "Detector",
  diffusion_model: "Diffusion Model",
  model: "Model",
  text_encoder: "Text Encoder",
  upscaler: "Upscaler",
  vae: "VAE",
};
const modelFolders: Record<string, string> = {
  checkpoints: "checkpoint",
  clip_vision: "clip_vision",
  diffusion_models: "diffusion_model",
  SEEDVR2: "upscaler",
  text_encoders: "text_encoder",
  ultralytics_bbox: "detector",
  vae: "vae",
};
const loraTypes: Record<string, string> = {
  character: "Character",
  concept: "Concept",
  slider: "Slider",
  style: "Style",
};
const modelTypes: Record<string, string> = { original: "Original", finetune: "Fine-Tune" };
export function libraryItemCategory(item: LibraryItem) {
  const kind = item.kind === "lora" ? "loras" : modelKinds[item.kind || ""] ? "models" : undefined;
  const folder =
    item.folder === "loras" ? "loras" : modelFolders[item.folder || ""] ? "models" : undefined;
  return kind && folder && kind !== folder ? "unclassified" : kind || folder || "unclassified";
}
const resourceName = (item: LibraryItem) =>
  item.title || item.name || loraName(item.file || item.key);
const canUpdate = (item: LibraryItem) =>
  item.installed &&
  item.update?.state === "available" &&
  !["downloading", "kept", "removed"].includes(item.applied?.state || "");
/** Which version an update downloads for free: the newest, else its free alternative, else none. */
export const freeUpdate = (item: LibraryItem) =>
  !canUpdate(item)
    ? null
    : item.update?.latest?.downloadable
      ? "latest"
      : item.update?.freeAlternative?.downloadable
        ? "alternative"
        : null;
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
/** A status that needs attention has a colour; Installed and Not Installed are plain text. */
function statusOf(item: LibraryItem): { label: string; color?: string } {
  if (item.applied?.state === "downloading") return { label: "Updating", color: "blue" };
  if (canUpdate(item)) return { label: "Update Available", color: "yellow" };
  if (item.installed) return { label: "Installed" };
  if (item.install?.state === "queued") return { label: "Queued", color: "blue" };
  if (item.install?.state === "downloading") return { label: "Installing", color: "blue" };
  if (item.install?.state === "failed") return { label: "Install Failed", color: "red" };
  return { label: "Not Installed" };
}
const unique = (values: string[]) => [...new Set(values)].sort(compareNames);
const views = [
  { value: "installed", label: "Installed" },
  { value: "available", label: "Available" },
  { value: "outdated", label: "Outdated" },
];

/** Models and LoRAs share one compact catalogue: views, search, filters and row actions. */
export function LibraryCatalogueTable({
  heading,
  items,
  loading = false,
  label,
  onUpdate,
  onInstall,
  installingKey,
  onCheckUpdates,
  onTest,
  canTest,
  onUpdateAll,
  inventoryError,
  onEdit,
  onDelete,
  updatePending = false,
}: {
  heading: ReactNode;
  items: LibraryItem[];
  /** Why the installed files are unknown, so none reads as unknown rather than not installed. */
  inventoryError?: string;
  /** The catalogue is still loading: the toolbar shows, the table its loading state. */
  loading?: boolean;
  label: "Files" | "LoRAs";
  onUpdate?: (item: LibraryItem, alternative?: boolean) => void;
  onInstall?: (item: LibraryItem) => void;
  installingKey?: string;
  onCheckUpdates?: () => void;
  /** Test LoRA: a strength sweep in Compare; greyed out where `canTest` finds no model to run it. */
  onTest?: (item: LibraryItem) => void;
  canTest?: (item: LibraryItem) => boolean;
  /** Applies every free update, models and LoRAs alike; absent when there are none. */
  onUpdateAll?: () => void;
  onEdit?: (item: LibraryItem) => void;
  onDelete?: (item: LibraryItem) => void;
  updatePending?: boolean;
}) {
  const phone = usePhone();
  const [view, setView] = useState("installed");
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [modelType, setModelType] = useState<string | null>(null);
  const models = label === "Files";
  // Whether a model is an original or a finetune is shown only where the catalogue says so.
  const withModelType = models && items.some((item) => item.modelType);
  // LoRA types are set only by editing an entry; until one is, every row would read Unclassified.
  const withType = models || items.some((item) => item.type);
  const withSize = items.some((item) => item.bytes);
  const families = unique(items.flatMap(familiesOf));
  const typeLabel = (item: LibraryItem) =>
    [resourceType(item), item.modelType && modelTypes[item.modelType]].filter(Boolean).join(" · ");
  const inView = items.filter((item) =>
    view === "outdated" ? updating(item) : item.installed === (view === "installed"),
  );
  // Sorted by type, family and name first, so the stable sort on the first column keeps that order.
  const rows = inView
    .filter(
      (item) =>
        (!family || familiesOf(item).includes(family)) &&
        (!type || resourceType(item) === type) &&
        (!modelType || (item.modelType || "unclassified") === modelType),
    )
    .sort(
      (a, b) =>
        compareNames(typeLabel(a), typeLabel(b)) ||
        compareNames(familySummary(a), familySummary(b)) ||
        compareNames(resourceName(a), resourceName(b)),
    );
  const filterCount = Number(!!family) + Number(!!type) + Number(!!modelType);
  const unclassified = items.filter((item) => libraryItemCategory(item) === "unclassified").length;
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label={label}
          views={views}
          view={view}
          onViewChange={setView}
          query={query}
          onQueryChange={setQuery}
          filters={
            <>
              <FilterChoices label="Family" data={families} value={family} onChange={setFamily} />
              {models && (
                <FilterChoices
                  label="Type"
                  data={unique(items.map(resourceType))}
                  value={type}
                  onChange={setType}
                />
              )}
              {withModelType && (
                <FilterChoices
                  label="Model Type"
                  data={[
                    { value: "original", label: "Original" },
                    { value: "finetune", label: "Fine-Tune" },
                    { value: "unclassified", label: "Unclassified" },
                  ]}
                  value={modelType}
                  onChange={setModelType}
                />
              )}
            </>
          }
          filterCount={filterCount}
          onClearFilters={() => {
            setFamily(null);
            setType(null);
            setModelType(null);
          }}
          actions={
            onCheckUpdates && (
              <Menu position="bottom-end" width={menuWidth}>
                <Menu.Target>
                  {/* Filled while free updates wait to be applied. */}
                  <ToolbarAction
                    label="Updates"
                    icon={icons.download}
                    variant={onUpdateAll ? undefined : "default"}
                    rightSection={<ChevronDown size={14} />}
                    loading={updatePending}
                  />
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<icons.refresh size={16} />} onClick={onCheckUpdates}>
                    Check
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<icons.download size={16} />}
                    disabled={!onUpdateAll}
                    onClick={onUpdateAll}
                  >
                    Update All
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )
          }
        />
      </SectionHeader>
      {inventoryError && <Alert color="red">{inventoryError}</Alert>}
      {unclassified > 0 && (
        <Text c="dimmed" size="xs">
          {unclassified} {unclassified === 1 ? "resource has" : "resources have"} missing or
          conflicting model or LoRA metadata.
        </Text>
      )}
      <DataTable
        label={`Library ${label}`}
        rows={rows}
        rowKey={(item) => item.key}
        rowName={resourceName}
        loading={loading && `Loading ${label}`}
        query={query}
        searchText={(item) => [
          resourceName(item),
          item.file,
          item.description,
          item.note,
          ...(item.families || []),
          ...familiesOf(item),
          ...(item.triggers || []),
          typeLabel(item),
          statusOf(item).label,
        ]}
        initialSort={{ key: withType ? "type" : "family", descending: false }}
        empty={
          inView.length
            ? "No Matches"
            : view === "outdated"
              ? "Everything Is Up to Date"
              : view === "installed"
                ? `No ${label} Installed`
                : `No Other ${label} Catalogued`
        }
        columns={[
          ...(withType
            ? [
                {
                  key: "type",
                  header: "Type",
                  hideOnPhone: true,
                  sortValue: (item: LibraryItem) =>
                    typeLabel(item) === "Unclassified" ? undefined : typeLabel(item),
                  cell: (item: LibraryItem) => (
                    <Text
                      size="sm"
                      c={typeLabel(item) === "Unclassified" ? "dimmed" : undefined}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {typeLabel(item)}
                    </Text>
                  ),
                },
              ]
            : []),
          {
            key: "family",
            header: "Family",
            hideOnPhone: true,
            sortValue: (item) => (item.families?.length ? familySummary(item) : undefined),
            cell: (item) => (
              <Text
                size="sm"
                style={{ whiteSpace: "nowrap" }}
                title={familiesOf(item).join(", ")}
                c={item.families?.length ? undefined : "dimmed"}
              >
                {familySummary(item)}
              </Text>
            ),
          },
          {
            key: "name",
            header: "Name",
            main: true,
            sortValue: resourceName,
            cell: (item) => (
              <>
                <TableRecord
                  name={resourceName(item)}
                  openLabel={`Edit ${resourceName(item)}`}
                  onOpen={onEdit && (() => onEdit(item))}
                  detail={
                    phone &&
                    [typeLabel(item), familySummary(item)]
                      .filter((part) => part !== "Unclassified")
                      .join(" · ")
                  }
                />
                {item.file && <FileName file={item.file} sha256={item.sha256} />}
                {(item.description || item.note) && (
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {item.description || item.note}
                  </Text>
                )}
                {canUpdate(item) && (
                  <Text size="xs">
                    {/* The note names the update, as "v2 is newer than v1." */}
                    {item.update?.note || `${item.update?.latest?.name} is newer.`}
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
                {item.install?.note && (
                  <Text size="xs" c="red">
                    {item.install.note}
                  </Text>
                )}
              </>
            ),
          },
          ...(withSize
            ? [
                {
                  key: "size",
                  header: "Size",
                  hideOnPhone: true,
                  sortValue: (item: LibraryItem) => item.bytes || undefined,
                  cell: (item: LibraryItem) => (
                    <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                      {formatBytes(item.bytes)}
                    </Text>
                  ),
                },
              ]
            : []),
          {
            key: "status",
            header: "Status",
            sortValue: (item) => statusOf(item).label,
            cell: (item) => {
              const { label, color } = statusOf(item);
              return color ? (
                <Badge color={color} miw="max-content">
                  {label}
                </Badge>
              ) : (
                <Text size={phone ? "xs" : "sm"} c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  {label}
                </Text>
              );
            },
          },
        ]}
        rowActions={(item) => {
          const source = item.links?.civitaiCom || item.links?.hf || item.links?.civitaiRed;
          const latest = item.update?.latest;
          const free = item.update?.freeAlternative;
          const install =
            item.install?.state === "failed"
              ? { label: "Retry Install", icon: icons.retry }
              : item.install?.state === "paused"
                ? { label: "Resume Install", icon: icons.resume }
                : { label: "Install", icon: icons.download };
          return (
            <>
              {onEdit && (
                <Menu.Item leftSection={<icons.edit size={16} />} onClick={() => onEdit(item)}>
                  Edit
                </Menu.Item>
              )}
              <Menu.Item
                leftSection={<icons.copy size={16} />}
                onClick={() => void copyText(item.file || item.key, "File name")}
              >
                Copy File Name
              </Menu.Item>
              {source && (
                <Menu.Item
                  leftSection={<icons.external size={16} />}
                  component="a"
                  href={source}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Source Page
                </Menu.Item>
              )}
              {onTest && item.installed && item.folder === "loras" && (
                <Menu.Item
                  leftSection={<icons.compare size={16} />}
                  disabled={canTest && !canTest(item)}
                  onClick={() => onTest(item)}
                >
                  Test
                </Menu.Item>
              )}
              {onInstall && item.installable && (
                <Menu.Item
                  leftSection={<install.icon size={16} />}
                  disabled={
                    item.key === installingKey ||
                    ["queued", "downloading"].includes(item.install?.state || "")
                  }
                  onClick={() => onInstall(item)}
                >
                  {install.label}
                </Menu.Item>
              )}
              {onUpdate &&
                canUpdate(item) &&
                (freeUpdate(item) === "latest" ? (
                  <Menu.Item
                    leftSection={<icons.download size={16} />}
                    disabled={updatePending}
                    onClick={() => onUpdate(item)}
                  >
                    Update to {latest?.name}
                  </Menu.Item>
                ) : freeUpdate(item) === "alternative" ? (
                  <Menu.Item
                    leftSection={<icons.download size={16} />}
                    disabled={updatePending}
                    onClick={() => onUpdate(item, true)}
                  >
                    Update to {free?.name}
                  </Menu.Item>
                ) : (
                  <Menu.Item leftSection={<icons.download size={16} />} disabled>
                    {latest?.unavailable?.note || "This update cannot be downloaded."}
                  </Menu.Item>
                ))}
              {onDelete && (
                <>
                  <Menu.Divider />
                  <Menu.Item
                    color="red"
                    leftSection={<icons.delete size={16} />}
                    onClick={() => onDelete(item)}
                  >
                    Delete
                  </Menu.Item>
                </>
              )}
            </>
          );
        }}
      />
    </Stack>
  );
}

/** A catalogued file's name with its extension, and its hashes on hover where its source recorded them. */
export function FileName({
  file,
  sha256,
  ...props
}: TextProps & { file: string; sha256?: string }) {
  const name = (
    <Text size="xs" c="dimmed" truncate {...props}>
      {file}
    </Text>
  );
  return sha256 ? (
    <Tooltip
      multiline
      w={360}
      label={
        <>
          <div style={{ overflowWrap: "anywhere" }}>SHA256 {sha256}</div>
          {/* AutoV2 is the SHA-256's first ten hex digits, as Civitai shows it. */}
          <div>AutoV2 {sha256.slice(0, 10).toUpperCase()}</div>
        </>
      }
    >
      {name}
    </Tooltip>
  ) : (
    name
  );
}
