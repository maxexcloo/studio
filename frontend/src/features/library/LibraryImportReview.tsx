import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Image,
  Modal,
  Progress,
  Select,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";

import { titleCase } from "../../../../shared/titles";
import { api, post } from "../../api";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { closeWhenTop } from "../../ui/popupClicks";
import { SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { usePhone } from "../../ui/usePhone";
import { modelsQuery } from "../generation/GenerationProvider";
import { type LibraryPreset, inspirationQuery } from "../generation/inspiration";
import { InspirationPreset } from "./InspirationPreset";
import { catalogueQuery, editableProfilesQuery, importsQuery } from "./queries";

interface Availability {
  note?: string;
  reason: string;
  freeAlternative?: { name: string; url?: string };
}
export interface ImportRecord {
  id: string;
  title?: string;
  name?: string;
  state: string;
  /** Where it stands in Library › Imports. */
  audit: "busy" | "failed" | "needs-files" | "ready" | "substitute";
  /** Failed, or waiting on a file no provider gives: Clear Stale removes it. */
  stale?: boolean;
  input?: { url?: string; kind?: string; fileName?: string };
  grade?: { value: string; reasons: string[] };
  error?: string;
  warnings?: string[];
  picture?: boolean;
  links?: { civitaiCom?: string; civitaiRed?: string; hf?: string };
  preset?: {
    prompt: string;
    negative?: string;
    settings: Record<string, unknown>;
    warnings?: string[];
  };
  suggestion?: { model?: string; profileId?: string };
  recipe?: { source?: string };
  resources?: {
    name: string;
    status: string;
    role?: string;
    optional?: boolean;
    supported?: boolean;
    unsourced?: boolean;
    note?: string;
    downloadError?: string;
    unavailable?: Availability;
    strength?: number | null;
    profileId?: string;
    folderGuessed?: boolean;
    exactInstalled?: boolean;
    /** The substitute was accepted for good. */
    accepted?: boolean;
    /** Download Missing can fetch it. */
    downloadable?: boolean;
    localName?: string;
    substitute?: { file: string; folder?: string; reason: string; profileId?: string };
    want?: { file: string; folder: string; source?: { url?: string } };
    progress?: { receivedBytes: number; totalBytes: number };
  }[];
  offers?: {
    key: string;
    file: string;
    label: string;
    relation: string;
    variant?: string;
    url?: string;
    downloadable: boolean;
    taken?: boolean;
    unavailable?: Availability;
    note?: string;
  }[];
  results?: { presetId?: string; profileId?: string };
  image?: { name?: string; thumbnailUrl?: string };
  prompt?: string;
}
export interface ImportVision {
  available: boolean;
  reason: string;
}
export const gradeColours: Record<string, string> = {
  exact: "green",
  close: "yellow",
  partial: "orange",
};
const stateLabels: Record<string, string> = {
  failed: "Failed",
  "needs-files": "Needs Files",
  ready: "Ready",
  resolving: "Resolving",
};
/** An import state as words, such as Needs Files. */
export const stateLabel = (state: string) =>
  stateLabels[state] || titleCase(state.replaceAll("-", " "));
/** An import still resolving or downloading, which polling follows until it settles. */
export const importBusy = (record: ImportRecord) =>
  ["resolving", "downloading"].includes(record.state);
const folders = ["checkpoints", "clip_vision", "diffusion_models", "loras", "text_encoders", "vae"];

/** Accept keeps a substitute for good; Reject drops it for the exact file, to download. */
function SubstituteChoice({
  accepted,
  disabled,
  onChoose,
}: {
  accepted?: boolean;
  disabled: boolean;
  onChoose: (accept: boolean) => void;
}) {
  return (
    <>
      <Button
        size="compact-sm"
        variant="default"
        disabled={disabled || accepted}
        onClick={() => onChoose(true)}
      >
        {accepted ? "Accepted" : "Accept"}
      </Button>
      <Button
        size="compact-sm"
        variant="default"
        disabled={disabled}
        onClick={() => onChoose(false)}
      >
        Reject
      </Button>
    </>
  );
}

export function LibraryImportReview({
  id,
  active,
  vision,
  admin,
  onClose,
  onOpen,
}: {
  id: string;
  active: boolean;
  vision?: ImportVision;
  admin: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const client = useQueryClient();
  const phone = usePhone();
  const dialog = useId();
  const key = ["imports", id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<{ import: ImportRecord }>(`/api/library/imports/${encodeURIComponent(id)}`),
    enabled: active,
    refetchInterval: (query) =>
      active && query.state.data && importBusy(query.state.data.import) ? 4000 : false,
  });
  const action = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) =>
      post<{ import: ImportRecord; failures?: string[]; queued?: number }>(
        `/api/library/imports/${encodeURIComponent(id)}/${action}`,
        body,
      ),
    onSuccess: (result, variables) => {
      client.setQueryData(["imports", result.import.id], { import: result.import });
      void client.invalidateQueries({ queryKey: importsQuery.queryKey });
      void client.invalidateQueries({ queryKey: catalogueQuery.queryKey });
      void client.invalidateQueries({ queryKey: inspirationQuery.queryKey });
      if (variables.action === "draft-profile") {
        void client.invalidateQueries({ queryKey: modelsQuery.queryKey });
        void client.invalidateQueries({ queryKey: editableProfilesQuery.queryKey });
      }
      if (result.import.id !== id) onOpen(result.import.id);
    },
  });
  const record = query.data?.import;
  const run = (actionName: string, body?: unknown) => action.mutate({ action: actionName, body });
  const resources = record?.resources || [];
  const canDraft =
    admin &&
    !!record &&
    !record.results?.profileId &&
    record.state !== "failed" &&
    ["civitai-model", "hf-file"].includes(record.input?.kind || "") &&
    resources.filter(
      (resource) =>
        ["checkpoint", "diffusion_model"].includes(resource.role || "") && !resource.optional,
    ).length === 1;
  const missing = resources.some((resource) => !resource.optional && resource.downloadable);
  const preset: LibraryPreset | undefined = record?.preset
    ? {
        id: record.id,
        name: record.title || record.name || "Imported Image",
        prompt: record.preset.prompt,
        negative: record.preset.negative || "",
        settings: record.preset.settings,
        thumbnailUrl: record.picture
          ? `/api/library/imports/${encodeURIComponent(id)}/picture`
          : undefined,
        warnings: [...(record.warnings || []), ...(record.preset.warnings || [])],
        resources: resources
          .filter((resource) => !resource.optional)
          .map((resource) => ({
            folder: resource.want?.folder,
            localName:
              resource.status === "substitute"
                ? resource.substitute?.file
                : resource.status === "installed"
                  ? resource.localName || resource.want?.file
                  : undefined,
            profileId: resource.substitute?.profileId || resource.profileId,
            status: resource.status,
            weight: resource.strength,
          })),
      }
    : undefined;
  return (
    <Modal
      opened
      id={dialog}
      onClose={closeWhenTop(dialog, onClose)}
      title={
        record?.title || record?.name || record?.input?.fileName || record?.input?.url || "Import"
      }
      size="xl"
      fullScreen={phone}
    >
      <Stack>
        {query.isPending ? (
          <LoadingState label="Loading Import" />
        ) : query.error ? (
          <Alert color="red">{query.error.message}</Alert>
        ) : record ? (
          <>
            <Group gap="xs">
              {record.grade && (
                <Badge color={gradeColours[record.grade.value] || "gray"}>
                  {stateLabel(record.grade.value)}
                </Badge>
              )}
              <Text size="sm" c="dimmed">
                {stateLabel(record.state)}
              </Text>
              <Button
                variant="default"
                size="compact-sm"
                ml="auto"
                loading={query.isFetching}
                onClick={() => void query.refetch()}
              >
                Check Again
              </Button>
            </Group>
            {record.error && <Alert color="red">{record.error}</Alert>}
            {!!action.data?.failures?.length && (
              <Alert color="yellow">{action.data.failures.join(" ")}</Alert>
            )}
            {canDraft && (
              <Button
                variant="default"
                loading={action.isPending && action.variables?.action === "draft-profile"}
                disabled={action.isPending}
                onClick={() => run("draft-profile")}
              >
                Draft Profile
              </Button>
            )}
            {record.results?.profileId && (
              <Text size="sm" c="dimmed">
                Profile drafted. Review it in Library › Profiles.
              </Text>
            )}
            {record.grade?.reasons.map((reason) => (
              <Text size="sm" key={reason}>
                {reason}
              </Text>
            ))}
            <Group>
              {Object.entries(record.links || {}).map(
                ([name, url]) =>
                  url && (
                    <Anchor key={name} href={url} target="_blank" rel="noreferrer">
                      {name === "hf"
                        ? "Hugging Face"
                        : name === "civitaiRed"
                          ? "Civitai Red"
                          : "Civitai"}
                    </Anchor>
                  ),
              )}
              {record.input?.url && (
                <Anchor href={record.input.url} target="_blank" rel="noreferrer">
                  Original Source
                </Anchor>
              )}
            </Group>
            {record.picture && !preset && (
              <Image
                src={`/api/library/imports/${encodeURIComponent(id)}/picture`}
                alt={record.title || "Imported Image"}
                mah={400}
                fit="contain"
              />
            )}
            {preset && (
              <>
                <Text size="sm" c="dimmed">
                  {record.input?.kind === "described"
                    ? `Described by AI${record.suggestion?.model ? ` · ${record.suggestion.model}` : ""}`
                    : record.recipe?.source
                      ? `Metadata: ${record.recipe.source}`
                      : "Imported Settings"}
                </Text>
                <Text fw={500}>Prompt</Text>
                <Text style={{ whiteSpace: "pre-wrap" }}>
                  {preset.prompt || "No prompt was recorded."}
                </Text>
                {preset.negative && (
                  <>
                    <Text fw={500}>Negative Prompt</Text>
                    <Text style={{ whiteSpace: "pre-wrap" }}>{preset.negative}</Text>
                  </>
                )}
                {!!Object.keys(preset.settings).length && (
                  <Table aria-label="Imported Settings">
                    <Table.Tbody>
                      {Object.entries(preset.settings).map(([name, value]) => (
                        <Table.Tr key={name}>
                          <Table.Th>{name}</Table.Th>
                          <Table.Td>
                            {typeof value === "object" ? JSON.stringify(value) : String(value)}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
                <InspirationPreset key={`${id}:${preset.prompt}`} preset={preset} />
              </>
            )}
            {record.picture && (
              <Stack gap="xs">
                <Button
                  variant="default"
                  disabled={!vision?.available || record.state === "resolving" || action.isPending}
                  loading={action.isPending && action.variables?.action === "describe"}
                  onClick={() => run("describe")}
                >
                  Describe With AI
                </Button>
                {!vision?.available && (
                  <Text size="sm" c="dimmed">
                    {vision?.reason || "Checking whether the assistant can describe images."}
                  </Text>
                )}
              </Stack>
            )}
            {!!resources.length && (
              <SettingGroup
                title="Files"
                toolbar={
                  missing && (
                    <SectionToolbar
                      label="Files"
                      actions={
                        <ToolbarAction
                          label="Download Missing"
                          icon={icons.download}
                          disabled={action.isPending}
                          onClick={() => run("download")}
                        />
                      }
                    />
                  )
                }
              >
                {resources.map((resource, index) => (
                  <SettingRow
                    key={`${index}:${resource.name}`}
                    label={
                      <span style={{ overflowWrap: "anywhere" }}>
                        {resource.want?.file || resource.name}
                      </span>
                    }
                    description={
                      <Stack gap={4} component="span">
                        {[
                          resource.note,
                          resource.unavailable &&
                            (resource.unavailable.note || resource.unavailable.reason),
                          resource.substitute &&
                            `Using ${resource.substitute.file}: ${resource.substitute.reason}`,
                        ].map(
                          (line) =>
                            line && (
                              <Text key={line} span size="xs">
                                {line}
                              </Text>
                            ),
                        )}
                        {resource.downloadError && (
                          <Text span size="xs" c="red">
                            {resource.downloadError}
                          </Text>
                        )}
                        {resource.want?.source?.url && (
                          <Anchor
                            size="xs"
                            href={resource.want.source.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            File Source
                          </Anchor>
                        )}
                      </Stack>
                    }
                  >
                    {resource.progress && (
                      <Progress
                        size="sm"
                        w={96}
                        aria-label={`Downloading ${resource.name}`}
                        value={
                          resource.progress.totalBytes > 0
                            ? (100 * resource.progress.receivedBytes) / resource.progress.totalBytes
                            : 0
                        }
                      />
                    )}
                    <Badge
                      miw="max-content"
                      color={resource.status === "installed" ? "green" : "gray"}
                    >
                      {stateLabel(resource.status)}
                    </Badge>
                    {resource.folderGuessed && resource.status !== "installed" && (
                      <Select
                        aria-label={`Destination for ${resource.name}`}
                        size="xs"
                        value={resource.want?.folder || null}
                        data={folders}
                        disabled={action.isPending}
                        onChange={(folder) => folder && run("folder", { index, folder })}
                      />
                    )}
                    {resource.status === "substitute" && (
                      <SubstituteChoice
                        accepted={resource.accepted}
                        disabled={action.isPending}
                        onChoose={(accept) => run("substitute", { index, accept })}
                      />
                    )}
                    {resource.downloadable && (
                      <Button
                        size="compact-sm"
                        variant="default"
                        disabled={action.isPending}
                        onClick={() => run("download", { indices: [index] })}
                      >
                        Download
                      </Button>
                    )}
                  </SettingRow>
                ))}
              </SettingGroup>
            )}
            {!!record.offers?.length && (
              <SettingGroup title="Other Versions">
                <Text size="xs" c="dimmed">
                  Only versions that suit this model's family and worker are listed. Nothing
                  downloads until you choose one.
                </Text>
                {record.offers.map((offer, index) => (
                  <SettingRow
                    key={offer.key}
                    label={<span style={{ overflowWrap: "anywhere" }}>{offer.file}</span>}
                    description={
                      <Stack gap={4} component="span">
                        <Text span size="xs">
                          {[offer.label, offer.relation, offer.variant].filter(Boolean).join(" · ")}
                        </Text>
                        {[
                          offer.unavailable && (offer.unavailable.note || offer.unavailable.reason),
                          offer.note,
                        ].map(
                          (line) =>
                            line && (
                              <Text key={line} span size="xs">
                                {line}
                              </Text>
                            ),
                        )}
                        {offer.url && (
                          <Anchor size="xs" href={offer.url} target="_blank" rel="noreferrer">
                            Version Source
                          </Anchor>
                        )}
                        {offer.unavailable?.freeAlternative?.url && (
                          <Anchor
                            size="xs"
                            href={offer.unavailable.freeAlternative.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Free Version: {offer.unavailable.freeAlternative.name}
                          </Anchor>
                        )}
                      </Stack>
                    }
                  >
                    <Button
                      size="compact-sm"
                      variant="default"
                      disabled={
                        !!offer.unavailable ||
                        !offer.downloadable ||
                        offer.taken ||
                        action.isPending
                      }
                      onClick={() => run("offers", { index })}
                    >
                      {offer.taken ? "Chosen" : "Download"}
                    </Button>
                  </SettingRow>
                ))}
              </SettingGroup>
            )}
          </>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </Stack>
    </Modal>
  );
}
