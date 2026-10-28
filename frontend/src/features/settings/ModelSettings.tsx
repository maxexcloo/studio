import { Alert, Badge, Select, Stack, Switch } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import { LoadingState } from "../../ui/LoadingState";
import { modelsQuery } from "../generation/GenerationProvider";
import { SettingGroup, SettingRow } from "./SettingRows";

interface Source {
  source: "default" | "studio" | "deployment";
  locked: boolean;
}
type Setting = Source & { key: string; configured: string; effective: string };
interface Deployment {
  defaults: {
    image: Setting;
    video: Setting;
    profiles: { id: string; label: string; kind: string; ready: boolean }[];
  };
  catalogue: (Source & {
    key: string;
    label: string;
    description: string;
    applies: string;
    value: boolean;
  })[];
  integrations: {
    civitai: { token: { set: boolean }; presets: boolean };
    huggingFace: { token: { set: boolean } };
    assistant: { available: boolean; note?: string; model: Setting };
  };
  storage: Source & { outputs: "studio" | "comfy" };
}
const deploymentQuery = {
  queryKey: ["settings-deployment"],
  queryFn: () => api<Deployment>("/api/settings/deployment"),
};
const sourceNote = (setting: Source) =>
  setting.locked
    ? "Set by the deployment"
    : setting.source === "studio"
      ? "Saved in Studio"
      : "Default";
const onOff = (on: boolean, label = on ? "On" : "Off") => (
  <Badge color={on ? "green" : "gray"}>{label}</Badge>
);

/** Settings › Models: default profiles, catalogue switches and integrations. */
export function ModelSettings() {
  const client = useQueryClient();
  const deployment = useQuery(deploymentQuery);
  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string | boolean }) =>
      post("/api/settings/deployment", { key, value }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: deploymentQuery.queryKey });
      void client.invalidateQueries({ queryKey: modelsQuery.queryKey });
    },
  });
  if (deployment.isPending) return <LoadingState label="Loading Models" />;
  if (deployment.error) return <Alert color="red">{deployment.error.message}</Alert>;
  const { defaults, catalogue, integrations, storage } = deployment.data;
  const profileSelect = (kind: "image" | "video", setting: Setting) => {
    const label = kind === "image" ? "Default Image Profile" : "Default Video Profile";
    const options = defaults.profiles.filter((profile) => profile.kind === kind);
    const effective = options.find((profile) => profile.id === setting.effective);
    return (
      <SettingRow
        wide
        label={label}
        description={`${sourceNote(setting)} · New drafts start on ${effective?.label || "the first ready profile"}.`}
      >
        <Select
          aria-label={label}
          placeholder="First Ready Profile"
          data={options.map((profile) => ({
            value: profile.id,
            label: profile.ready ? profile.label : `${profile.label} (Not Ready)`,
          }))}
          value={setting.configured || null}
          onChange={(value) => save.mutate({ key: setting.key, value: value || "" })}
          disabled={setting.locked || save.isPending}
          searchable
          clearable
          nothingFoundMessage="No Matching Profiles"
          w={{ base: "100%", sm: 260 }}
        />
      </SettingRow>
    );
  };
  return (
    <Stack gap="lg">
      <SettingGroup title="Defaults">
        {profileSelect("image", defaults.image)}
        {profileSelect("video", defaults.video)}
      </SettingGroup>
      {catalogue.length > 0 && (
        <SettingGroup title="Features">
          {catalogue.map((flag) => (
            <SettingRow
              key={flag.key}
              label={flag.label}
              description={`${flag.description} ${sourceNote(flag)}${flag.applies === "restart" ? " · Applies after a restart" : ""}.`}
            >
              <Switch
                aria-label={flag.label}
                checked={flag.value}
                disabled={flag.locked || save.isPending}
                onChange={(event) =>
                  save.mutate({ key: flag.key, value: event.currentTarget.checked })
                }
              />
            </SettingRow>
          ))}
        </SettingGroup>
      )}
      <SettingGroup title="Integrations">
        <SettingRow
          label="Civitai"
          description={`${integrations.civitai.token.set ? "Token set" : "No token"} · Imports ${integrations.civitai.presets ? "on" : "off"}`}
        >
          {onOff(
            integrations.civitai.token.set,
            integrations.civitai.token.set ? "Connected" : "Public Only",
          )}
        </SettingRow>
        <SettingRow
          label="Hugging Face"
          description={
            integrations.huggingFace.token.set
              ? "Token set"
              : "No token; gated models can’t download"
          }
        >
          {onOff(
            integrations.huggingFace.token.set,
            integrations.huggingFace.token.set ? "Connected" : "Public Only",
          )}
        </SettingRow>
        <SettingRow
          label="Output Storage"
          description={`${sourceNote(storage)} · ${storage.outputs === "studio" ? "Finished outputs are kept in Studio’s media folder" : "Finished outputs stay in ComfyUI’s output folder"}`}
        >
          <Badge color="gray">{storage.outputs === "studio" ? "Studio" : "ComfyUI Folder"}</Badge>
        </SettingRow>
        <SettingRow
          label="Prompt Assistant"
          description={
            integrations.assistant.available
              ? `Model ${integrations.assistant.model.effective || "not chosen"}`
              : integrations.assistant.note
          }
        >
          {onOff(integrations.assistant.available)}
        </SettingRow>
      </SettingGroup>
    </Stack>
  );
}
