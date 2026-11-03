import { Alert, Badge, Select, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { deploymentQuery, sourceNote, useDeploymentSetting } from "./deployment";

const status = (on: boolean, label: string) => (
  <Badge color={on ? "green" : "gray"} miw="max-content">
    {label}
  </Badge>
);

/** Settings › Integrations: the services Studio reaches beyond its workers. */
export function IntegrationSettings() {
  const deployment = useQuery(deploymentQuery);
  const save = useDeploymentSetting();
  if (deployment.isPending) return <LoadingState label="Loading Integrations" />;
  if (deployment.error) return <Alert color="red">{deployment.error.message}</Alert>;
  const { civitai, huggingFace, assistant } = deployment.data.integrations;
  const { model, models } = assistant;
  return (
    <Stack gap="lg">
      <SettingGroup title="Model Sources">
        <SettingRow
          label="Civitai"
          description={`${civitai.token.set ? "Token set" : "No token"} · Imports ${civitai.presets ? "on" : "off"}`}
        >
          {status(civitai.token.set, civitai.token.set ? "Connected" : "Public Only")}
        </SettingRow>
        <SettingRow
          label="Hugging Face"
          description={
            huggingFace.token.set ? "Token set" : "No token; gated models can’t download"
          }
        >
          {status(huggingFace.token.set, huggingFace.token.set ? "Connected" : "Public Only")}
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Prompt Assistant">
        <SettingRow
          label="Prompt Assistant"
          description={
            assistant.available ? `Model ${model.effective || "not chosen"}` : assistant.note
          }
        >
          {status(assistant.available, assistant.available ? "On" : "Off")}
        </SettingRow>
        {assistant.available && (
          // Automatic (no saved model) lets Studio pick the local or cloud model for each call.
          <SettingRow
            wide
            label="Assistant Model"
            description={`${sourceNote(model)} · Replaces the automatic choice for every assistant call.`}
          >
            <Select
              aria-label="Assistant Model"
              data={[
                { value: "", label: "Automatic" },
                ...[...new Set([...models, model.configured].filter(Boolean))].map((id) => ({
                  value: id,
                  label: id,
                })),
              ]}
              value={model.configured}
              onChange={(value) => save.mutate({ key: model.key, value: value || "" })}
              disabled={model.locked}
              allowDeselect={false}
              searchable
              nothingFoundMessage="No Matching Models"
              w={{ base: "100%", sm: 240 }}
            />
          </SettingRow>
        )}
      </SettingGroup>
    </Stack>
  );
}
