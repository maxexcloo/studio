import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Image,
  Progress,
  Select,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { api, post } from "../../api";
import { LoadingState } from "../../ui/LoadingState";
import { modelsQuery } from "../generation/GenerationProvider";
import { SectionHeading } from "../../ui/SectionHeading";
import { InspirationPreset, type LibraryPreset } from "./InspirationPreset";

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
const folders = ["checkpoints", "clip_vision", "diffusion_models", "loras", "text_encoders", "vae"];

export function LibraryImportReview({
  id,
  active,
  vision,
  admin,
  onBack,
  onOpen,
}: {
  id: string;
  active: boolean;
  vision?: ImportVision;
  admin: boolean;
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const client = useQueryClient();
  const key = ["imports", id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<{ import: ImportRecord }>(`/api/library/imports/${encodeURIComponent(id)}`),
    enabled: active,
    refetchInterval: active ? 4000 : false,
  });
  const action = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) =>
      post<{ import: ImportRecord; failures?: string[]; queued?: number }>(
        `/api/library/imports/${encodeURIComponent(id)}/${action}`,
        body,
      ),
    onSuccess: (result, variables) => {
      client.setQueryData(["imports", result.import.id], { import: result.import });
      void client.invalidateQueries({ queryKey: ["imports"] });
      void client.invalidateQueries({ queryKey: ["library"] });
      void client.invalidateQueries({ queryKey: ["presets"] });
      if (variables.action === "draft-profile") {
        void client.invalidateQueries({ queryKey: modelsQuery.queryKey });
        void client.invalidateQueries({ queryKey: ["definition-list", "profile"] });
        notifications.show({ message: "Profile drafted. Review it in Settings › Profiles." });
      }
      if (result.failures?.length)
        notifications.show({
          color: "yellow",
          title: "Download Needs Attention",
          message: result.failures.join(" "),
        });
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
  const missing = resources.some(
    (resource) =>
      !resource.optional &&
      resource.status === "missing" &&
      resource.supported !== false &&
      !resource.unavailable &&
      !resource.unsourced,
  );
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
    <Stack>
      <Group justify="space-between">
        <Button variant="subtle" onClick={onBack}>
          Back to Imports
        </Button>
        <Button variant="default" loading={query.isFetching} onClick={() => void query.refetch()}>
          Check Again
        </Button>
      </Group>
      {query.isPending ? (
        <LoadingState label="Loading Import" />
      ) : query.error ? (
        <Alert color="red">{query.error.message}</Alert>
      ) : record ? (
        <>
          <SectionHeading>
            {record.title ||
              record.name ||
              record.input?.fileName ||
              record.input?.url ||
              record.id}
          </SectionHeading>
          <Group gap="xs">
            <Badge>{record.grade?.value || record.state}</Badge>
            <Text size="sm" c="dimmed">
              {record.state}
            </Text>
          </Group>
          {record.error && <Alert color="red">{record.error}</Alert>}
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
              Profile drafted. Review it in Settings › Profiles.
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
            <>
              <Group justify="space-between">
                <SectionHeading>Files</SectionHeading>
                <Button disabled={!missing || action.isPending} onClick={() => run("download")}>
                  Download Missing
                </Button>
              </Group>
              {resources.map((resource, index) => (
                <Stack
                  key={`${index}:${resource.name}`}
                  gap="xs"
                  py="sm"
                  style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
                >
                  <Group justify="space-between">
                    <Text fw={500} style={{ overflowWrap: "anywhere" }}>
                      {resource.want?.file || resource.name}
                    </Text>
                    <Badge color={resource.status === "installed" ? "green" : "gray"}>
                      {resource.status}
                    </Badge>
                  </Group>
                  {resource.note && <Text size="sm">{resource.note}</Text>}
                  {resource.downloadError && (
                    <Text size="sm" c="red">
                      {resource.downloadError}
                    </Text>
                  )}
                  {resource.unavailable && (
                    <Text size="sm">
                      {resource.unavailable.note || resource.unavailable.reason}
                    </Text>
                  )}
                  {resource.substitute && (
                    <Text size="sm">
                      Using {resource.substitute.file}: {resource.substitute.reason}
                    </Text>
                  )}
                  {resource.progress && (
                    <Progress
                      aria-label={`Downloading ${resource.name}`}
                      value={
                        resource.progress.totalBytes > 0
                          ? (100 * resource.progress.receivedBytes) / resource.progress.totalBytes
                          : 0
                      }
                    />
                  )}
                  <Group>
                    {resource.want?.source?.url && (
                      <Anchor
                        size="sm"
                        href={resource.want.source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        File Source
                      </Anchor>
                    )}
                    {resource.folderGuessed && resource.status !== "installed" && (
                      <Select
                        label={`Destination for ${resource.name}`}
                        value={resource.want?.folder || null}
                        data={folders}
                        disabled={action.isPending}
                        onChange={(folder) => folder && run("folder", { index, folder })}
                      />
                    )}
                    {resource.status === "substitute" && (
                      <Button
                        size="compact-sm"
                        variant="default"
                        disabled={!resource.exactInstalled || action.isPending}
                        onClick={() => run("exact", { index })}
                      >
                        Use Exact File
                      </Button>
                    )}
                    {(resource.status === "missing" ||
                      (resource.status === "substitute" && !resource.exactInstalled)) &&
                      !resource.unavailable &&
                      !resource.unsourced &&
                      resource.supported !== false && (
                        <Button
                          size="compact-sm"
                          variant="default"
                          disabled={action.isPending}
                          onClick={() => run("download", { indices: [index] })}
                        >
                          Download Exact File
                        </Button>
                      )}
                  </Group>
                </Stack>
              ))}
            </>
          )}
          {!!record.offers?.length && (
            <>
              <SectionHeading>Other Versions</SectionHeading>
              <Text size="sm" c="dimmed">
                Only versions compatible with this model’s family and worker are offered. Downloads
                start only when selected.
              </Text>
              {record.offers.map((offer, index) => (
                <Stack key={offer.key} gap="xs">
                  <Text fw={500} style={{ overflowWrap: "anywhere" }}>
                    {offer.file}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {[offer.label, offer.relation, offer.variant].filter(Boolean).join(" · ")}
                  </Text>
                  {offer.unavailable && (
                    <Text size="sm">{offer.unavailable.note || offer.unavailable.reason}</Text>
                  )}
                  {offer.note && <Text size="sm">{offer.note}</Text>}
                  <Group>
                    {offer.url && (
                      <Anchor href={offer.url} target="_blank" rel="noreferrer">
                        Version Source
                      </Anchor>
                    )}
                    {offer.unavailable?.freeAlternative?.url && (
                      <Anchor
                        href={offer.unavailable.freeAlternative.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Free Version: {offer.unavailable.freeAlternative.name}
                      </Anchor>
                    )}
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
                      {offer.taken ? "Chosen" : "Download Version"}
                    </Button>
                  </Group>
                </Stack>
              ))}
            </>
          )}
        </>
      ) : null}
    </Stack>
  );
}
