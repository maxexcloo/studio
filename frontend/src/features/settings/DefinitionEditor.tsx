import { useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  FocusTrap,
  Group,
  Menu,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import { DataTable } from "../../ui/DataTable";
import { LoadingState } from "../../ui/LoadingState";
import { modelsQuery } from "../generation/GenerationProvider";
import { loraInfoQuery } from "../generation/LoraPicker";
import { WorkflowConnections } from "./WorkflowConnections";
import { backendLabel } from "../generation/payload";
import { sharedProfileFields } from "../../../../shared/profiles";
import { usePhone } from "../../ui/usePhone";

export type DefinitionKind = "profile" | "guide";
interface DefinitionMeta {
  version: number;
  aiDrafted?: boolean;
  origin?: string;
  by?: string;
  editedAt?: string;
}
export interface LoadedDefinition {
  warnings?: string[];
  text?: string;
  pack?: Record<string, unknown>;
  hash: string;
  version?: DefinitionMeta;
  meta?: DefinitionMeta;
}
interface Check {
  ok: boolean;
  errors: string[];
  warnings: string[];
}
const definitionPath = (kind: DefinitionKind, id: string) =>
  `/api/profiles/${kind === "profile" ? "editable" : "guides"}/${encodeURIComponent(id)}`;
const pretty = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function DefinitionForm({
  kind,
  id,
  loaded,
  creating,
  existingIds,
  close,
}: {
  kind: DefinitionKind;
  id: string;
  loaded: LoadedDefinition;
  creating: boolean;
  existingIds: string[];
  close: () => void;
}) {
  const client = useQueryClient();
  const form = useForm({
    initialValues: { id, text: loaded.text || pretty(loaded.pack || { name: "", summary: "" }) },
  });
  const [tab, setTab] = useState<string | null>("details");
  const [check, setCheck] = useState<Check | null>(null);
  const [versionText, setVersionText] = useState("");
  const path = definitionPath(kind, form.values.id);
  let raw: Record<string, unknown> | undefined,
    error = "";
  try {
    const parsed = JSON.parse(form.values.text);
    if (!object(parsed)) throw new Error("A definition must be a JSON object.");
    raw = parsed;
  } catch (cause) {
    error = (cause as Error).message;
  }
  const block = kind === "profile" ? (raw && object(raw.studio) ? raw.studio : undefined) : raw;
  // A combined profile: the structured fields show and edit the backend it runs on, over the shared ones.
  const backends = kind === "profile" && object(block?.backends) ? block.backends : undefined;
  const backendIds = Object.keys(backends || {});
  const backend = backends
    ? backendIds.includes(String(block!.backend))
      ? String(block!.backend)
      : backendIds[0]
    : "";
  const backendBlock = backends && object(backends[backend]) ? backends[backend] : undefined;
  const metadata = block && backendBlock ? { ...block, ...backendBlock } : block;
  const metadataRaw = backendBlock ? { graph: backendBlock.graph, studio: metadata } : raw;
  function field(name: string, value: unknown) {
    if (!raw || !block) return;
    const next =
      backendBlock && name !== "backend" && !sharedProfileFields.includes(name)
        ? { ...block, backends: { ...backends, [backend]: { ...backendBlock, [name]: value } } }
        : { ...block, [name]: value };
    form.setFieldValue("text", pretty(kind === "profile" ? { ...raw, studio: next } : next));
    setCheck(null);
  }
  function nested(name: string, key: string, value: unknown) {
    field(name, { ...(object(metadata?.[name]) ? metadata[name] : {}), [key]: value });
  }
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["definition-list"] });
    void client.invalidateQueries({ queryKey: modelsQuery.queryKey });
    void client.invalidateQueries({ queryKey: ["library"] });
    void client.invalidateQueries({ queryKey: loraInfoQuery.queryKey });
    void client.invalidateQueries({ queryKey: ["definition", kind, id] });
    void client.invalidateQueries({ queryKey: ["definition-versions", kind, id] });
  };
  const save = useMutation({
    meta: { inlineError: true },
    mutationFn: async () => {
      if (error) throw new Error(error);
      if (!form.values.id.trim()) throw new Error("Choose a definition ID.");
      if (creating && existingIds.includes(form.values.id))
        throw new Error("That ID already exists. Edit the existing definition or choose a new ID.");
      if (creating && kind === "profile")
        return post("/api/workflows/import", { workflow: raw, metadata });
      return api(path, {
        method: "PUT",
        body: JSON.stringify(
          kind === "profile"
            ? { text: form.values.text, baseHash: loaded.hash }
            : { pack: raw, baseHash: loaded.hash },
        ),
      });
    },
    onSuccess: () => {
      refresh();
      close();
    },
  });
  const validate = useMutation({
    meta: { inlineError: true },
    mutationFn: () => post<{ check: Check }>(`${path}/check`, { text: form.values.text }),
    onSuccess: ({ check }) => setCheck(check),
  });
  const action = useMutation({
    meta: { inlineError: true },
    mutationFn: ({ action, version }: { action: "approve" | "revert"; version?: number }) =>
      post(`${path}/${action}`, { baseHash: loaded.hash, version }),
    onSuccess: () => {
      refresh();
      close();
    },
  });
  const versions = useQuery({
    queryKey: ["definition-versions", kind, id],
    queryFn: () => api<{ versions: DefinitionMeta[] }>(`${path}/versions`),
    enabled: !creating && tab === "versions",
  });
  const version = useMutation({
    meta: { inlineError: true },
    mutationFn: (number: number) =>
      api<{ version: { text?: string; pack?: Record<string, unknown> } }>(
        `${path}/versions/${number}`,
      ),
    onSuccess: ({ version }) => setVersionText(version.text || pretty(version.pack)),
  });
  const meta = loaded.version || loaded.meta;
  const busy = save.isPending || action.isPending;
  const collision = creating && existingIds.includes(form.values.id);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Stack gap="md">
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            {creating ? "New Definition" : `Version ${meta?.version || 0}`}
          </Text>
          {meta?.aiDrafted && <Badge color="orange">AI-Drafted</Badge>}
        </Group>
        <TextInput
          label="Definition ID"
          value={form.values.id}
          readOnly={!creating}
          required
          error={collision ? "This ID already exists." : undefined}
          onChange={(event) => {
            form.setFieldValue("id", event.currentTarget.value);
            if (kind === "profile") field("id", event.currentTarget.value);
          }}
        />
        {loaded.warnings?.length ? (
          <Alert color="yellow" title="Workflow Import Review">
            {loaded.warnings.map((message, index) => (
              <Text key={index} size="sm">
                {message}
              </Text>
            ))}
          </Alert>
        ) : null}
        {save.error && <Alert color="red">{save.error.message}</Alert>}
        {action.error && <Alert color="red">{action.error.message}</Alert>}
        {error && <Alert color="red">{error} Repair the definition in Advanced JSON.</Alert>}
        <Tabs value={tab} onChange={setTab} keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="details">Details</Tabs.Tab>
            {kind === "profile" && <Tabs.Tab value="connections">Connections</Tabs.Tab>}
            <Tabs.Tab value="advanced">Advanced JSON</Tabs.Tab>
            {!creating && <Tabs.Tab value="versions">Versions</Tabs.Tab>}
          </Tabs.List>
          <Tabs.Panel value="details" pt="md">
            <Stack gap="md">
              {!metadata ? (
                <Alert color="yellow">
                  This file needs its profile metadata repaired in Advanced JSON before structured
                  editing is available.
                </Alert>
              ) : (
                <>
                  <TextInput
                    label="Name"
                    required
                    value={String(metadata.name || "")}
                    onChange={(event) => field("name", event.currentTarget.value)}
                  />
                  {kind === "profile" ? (
                    <>
                      {backends && (
                        <Select
                          label="Backend"
                          description="Where this profile runs. Details and Connections edit this backend; Advanced JSON holds every backend."
                          data={backendIds.map((id) => ({ value: id, label: backendLabel(id) }))}
                          value={backend}
                          allowDeselect={false}
                          onChange={(value) => value && field("backend", value)}
                        />
                      )}
                      <SimpleGrid cols={{ base: 1, sm: 2 }}>
                        <TextInput
                          label="Family ID"
                          value={String(metadata.family || "")}
                          onChange={(event) => field("family", event.currentTarget.value)}
                        />
                        <Select
                          label="Output"
                          data={[
                            { value: "image", label: "Image" },
                            { value: "video", label: "Video" },
                          ]}
                          value={String(metadata.kind || "image")}
                          allowDeselect={false}
                          onChange={(value) => field("kind", value)}
                        />
                      </SimpleGrid>
                      <Switch
                        label="Uncensored"
                        checked={metadata.uncensored === true}
                        onChange={(event) => field("uncensored", event.currentTarget.checked)}
                      />
                      <Textarea
                        label="Description"
                        autosize
                        minRows={2}
                        value={String(metadata.description || "")}
                        onChange={(event) => field("description", event.currentTarget.value)}
                      />
                      <SimpleGrid cols={{ base: 1, sm: 2 }}>
                        <TextInput
                          label="Model & Finetune Label"
                          value={String(
                            (metadata.recipe as Record<string, unknown>)?.modelLabel || "",
                          )}
                          onChange={(event) =>
                            nested("recipe", "modelLabel", event.currentTarget.value)
                          }
                        />
                        <TextInput
                          label="Workflow Preset Label"
                          value={String((metadata.recipe as Record<string, unknown>)?.label || "")}
                          onChange={(event) => nested("recipe", "label", event.currentTarget.value)}
                        />
                      </SimpleGrid>
                      <TextInput
                        label="Conditioning"
                        description="The profile’s declared workflow conditioning."
                        value={String(
                          (metadata.recipe as Record<string, unknown>)?.conditioning || "",
                        )}
                        onChange={(event) =>
                          nested("recipe", "conditioning", event.currentTarget.value)
                        }
                      />
                      <Accordion variant="default">
                        <Accordion.Item value="defaults">
                          <Accordion.Control>Generation Defaults</Accordion.Control>
                          <Accordion.Panel>
                            <SimpleGrid cols={{ base: 1, sm: 2 }}>
                              {[
                                "width",
                                "height",
                                "steps",
                                "cfg",
                                "denoise",
                                "count",
                                "frames",
                                "fps",
                                "duration",
                              ].map((key) => (
                                <NumberInput
                                  key={key}
                                  label={
                                    key === "cfg" ? "Guidance" : key[0].toUpperCase() + key.slice(1)
                                  }
                                  value={
                                    typeof (metadata.defaults as Record<string, unknown>)?.[key] ===
                                    "number"
                                      ? (metadata.defaults as Record<string, number>)[key]
                                      : ""
                                  }
                                  onChange={(value) =>
                                    nested("defaults", key, value === "" ? undefined : value)
                                  }
                                />
                              ))}
                            </SimpleGrid>
                          </Accordion.Panel>
                        </Accordion.Item>
                      </Accordion>
                    </>
                  ) : (
                    <>
                      <Textarea
                        label="Summary"
                        autosize
                        minRows={3}
                        value={String(metadata.summary || "")}
                        onChange={(event) => field("summary", event.currentTarget.value)}
                      />
                      {Object.entries(metadata)
                        .filter(
                          ([key, value]) =>
                            !["name", "summary", "rules"].includes(key) &&
                            (typeof value === "string" ||
                              (Array.isArray(value) &&
                                value.length &&
                                value.every((item) => typeof item === "string"))),
                        )
                        .map(([key, value]) => (
                          <Textarea
                            key={key}
                            label={key.replaceAll("_", " ")}
                            description={Array.isArray(value) ? "One entry per line." : undefined}
                            autosize
                            minRows={2}
                            value={Array.isArray(value) ? value.join("\n") : String(value)}
                            onChange={(event) =>
                              field(
                                key,
                                Array.isArray(value)
                                  ? event.currentTarget.value.split("\n")
                                  : event.currentTarget.value,
                              )
                            }
                          />
                        ))}
                      {(!Object.hasOwn(metadata, "rules") ||
                        (Array.isArray(metadata.rules) &&
                          metadata.rules.every((rule) => typeof rule === "string"))) && (
                        <Textarea
                          label="Rules"
                          description="One rule per line."
                          autosize
                          minRows={3}
                          value={Array.isArray(metadata.rules) ? metadata.rules.join("\n") : ""}
                          onChange={(event) =>
                            field("rules", event.currentTarget.value.split("\n"))
                          }
                        />
                      )}
                    </>
                  )}
                </>
              )}
            </Stack>
          </Tabs.Panel>
          {kind === "profile" && (
            <Tabs.Panel value="connections" pt="md">
              {raw && metadata ? (
                <WorkflowConnections
                  id={form.values.id}
                  backend={backend}
                  raw={metadataRaw!}
                  metadata={metadata}
                  onChange={field}
                />
              ) : (
                <Alert color="yellow">
                  Repair the profile metadata in Advanced JSON before editing connections.
                </Alert>
              )}
            </Tabs.Panel>
          )}
          <Tabs.Panel value="advanced" pt="md">
            <Stack gap="sm">
              <Text size="sm" c="dimmed">
                Edit workflow graphs, control mappings or nested guide variants here. Structured
                fields preserve everything else in this document.
              </Text>
              <Textarea
                label={kind === "profile" ? "Profile JSON" : "Guide JSON"}
                autosize
                minRows={14}
                maxRows={28}
                spellCheck={false}
                value={form.values.text}
                styles={{ input: { fontFamily: "monospace" } }}
                onChange={(event) => {
                  form.setFieldValue("text", event.currentTarget.value);
                  setCheck(null);
                }}
              />
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="versions" pt="md">
            <Stack gap="sm">
              {versions.error ? (
                <Alert color="red">{versions.error.message}</Alert>
              ) : (
                <DataTable
                  label="Definition Versions"
                  rows={versions.data?.versions || []}
                  rowKey={(entry) => `${entry.version}`}
                  rowName={(entry) => `Version ${entry.version}`}
                  loading={versions.isPending && "Loading Versions"}
                  empty="No Versions"
                  columns={[
                    {
                      key: "version",
                      header: "Version",
                      sortValue: (entry) => entry.version,
                      cell: (entry) => (
                        <Group gap="xs" wrap="nowrap">
                          <Text size="sm">{entry.version}</Text>
                          {entry.aiDrafted && (
                            <Badge color="orange" variant="light">
                              AI-Drafted
                            </Badge>
                          )}
                        </Group>
                      ),
                    },
                    {
                      key: "by",
                      header: "Saved By",
                      main: true,
                      sortValue: (entry) => entry.by || entry.origin,
                      cell: (entry) => (
                        <Text size="sm" truncate>
                          {entry.by || entry.origin}
                        </Text>
                      ),
                    },
                  ]}
                  rowActions={(entry) => (
                    <>
                      <Menu.Item
                        disabled={version.isPending}
                        onClick={() => version.mutate(entry.version)}
                      >
                        View Version
                      </Menu.Item>
                      <Menu.Item
                        disabled={busy || form.isDirty()}
                        onClick={() => action.mutate({ action: "revert", version: entry.version })}
                      >
                        Restore Version
                      </Menu.Item>
                    </>
                  )}
                />
              )}
              {version.error && <Alert color="red">{version.error.message}</Alert>}
              {versionText && (
                <Textarea
                  label="Saved Definition"
                  readOnly
                  value={versionText}
                  autosize
                  minRows={8}
                  maxRows={20}
                />
              )}
              <Text size="xs" c="dimmed">
                Restoring saves the selected version as a new version. Save or discard current edits
                first.
              </Text>
            </Stack>
          </Tabs.Panel>
        </Tabs>
        {validate.error && <Alert color="red">{validate.error.message}</Alert>}
        {check && (
          <Alert
            color={check.ok ? "green" : "red"}
            title={check.ok ? "Profile Check Passed" : "Profile Needs Changes"}
          >
            {[...check.errors, ...check.warnings].map((message) => (
              <Text key={message} size="sm">
                {message}
              </Text>
            ))}
          </Alert>
        )}
        <Group justify="space-between">
          <Group gap="xs">
            {kind === "profile" && !creating && (
              <Button
                variant="default"
                loading={validate.isPending}
                disabled={!!error}
                onClick={() => validate.mutate()}
              >
                Check Profile
              </Button>
            )}
            {meta?.aiDrafted && (
              <Button
                variant="default"
                disabled={busy || form.isDirty()}
                onClick={() => action.mutate({ action: "approve" })}
              >
                Approve Draft
              </Button>
            )}
          </Group>
          <Group gap="xs">
            <Button variant="subtle" color="gray" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={save.isPending}
              disabled={!!error || collision || busy || (!creating && !form.isDirty())}
            >
              {creating ? "Create" : "Save"} {kind === "profile" ? "Profile" : "Guide"}
            </Button>
          </Group>
        </Group>
      </Stack>
    </form>
  );
}
export function DefinitionEditor({
  kind,
  id,
  close,
  creating,
  existingIds = [],
}: {
  kind: DefinitionKind;
  id: string;
  close: () => void;
  creating?: LoadedDefinition;
  existingIds?: string[];
}) {
  const phone = usePhone();
  const loaded = useQuery({
    queryKey: ["definition", kind, id],
    queryFn: () => api<LoadedDefinition>(definitionPath(kind, id)),
    enabled: !creating,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const data = creating || loaded.data;
  return (
    <Modal
      opened
      onClose={close}
      title={`${creating ? "Create" : "Edit"} ${kind === "profile" ? "Profile" : "Guide"}`}
      fullScreen={phone}
      closeButtonProps={{ "aria-label": "Close Definition Editor" }}
    >
      <FocusTrap.InitialFocus />
      {!data ? (
        loaded.error ? (
          <Alert color="red">{loaded.error.message}</Alert>
        ) : (
          <LoadingState label="Loading Definition" />
        )
      ) : (
        <DefinitionForm
          key={data.hash}
          kind={kind}
          id={id}
          loaded={data}
          creating={!!creating}
          existingIds={existingIds}
          close={close}
        />
      )}
    </Modal>
  );
}
