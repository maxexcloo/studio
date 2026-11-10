import { Alert, Badge, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { deploymentQuery, lockedNote, useDeploymentSetting } from "./deployment";
import { TextModelSelect } from "./TextModelSelect";

const status = (on: boolean, label: string) => (
  <Badge color={on ? "green" : "gray"} miw="max-content">
    {label}
  </Badge>
);

/** Settings › Integrations: the services Studio reaches beyond its workers. */
export function IntegrationSettings() {
  const deployment = useQuery(deploymentQuery);
  const save = useDeploymentSetting();
  if (deployment.isPending) return <LoadingState label="Loading Integrations" fill />;
  if (deployment.error) return <Alert color="red">{deployment.error.message}</Alert>;
  const { civitai, huggingFace, assistant } = deployment.data.integrations;
  const { model, models } = assistant;
  return (
    <Stack gap="lg">
      <SettingGroup title="Model Sources">
        <SettingRow label="Civitai" description={civitai.token.set ? "Token set" : "No token"}>
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
        {assistant.available && (
          // Automatic (no saved model) lets each account's pick or Studio's route choose the model.
          <SettingRow
            wide
            label="Model"
            description={`The model for every assistant call, replacing each account’s Prompt Writing model. Automatic writes prompts with the account’s pick and everything else with the running local model, otherwise the cloud model; uncensored accounts get the uncensored one.${lockedNote(model)}`}
          >
            <TextModelSelect
              label="Prompt Assistant Model"
              automatic="Automatic"
              models={models}
              value={model.configured}
              onChange={(value) => save.mutate({ key: model.key, value })}
              disabled={model.locked}
            />
          </SettingRow>
        )}
        <SettingRow
          label="Status"
          description={
            assistant.available ? `Using ${model.effective || "no model yet"}` : assistant.note
          }
        >
          {status(assistant.available, assistant.available ? "On" : "Off")}
        </SettingRow>
      </SettingGroup>
    </Stack>
  );
}
