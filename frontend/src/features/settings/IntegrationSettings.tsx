import { Alert, Badge, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { deploymentQuery } from "./deployment";

const status = (on: boolean, label: string) => (
  <Badge color={on ? "green" : "gray"} miw="max-content">
    {label}
  </Badge>
);

/** Settings › Integrations: the services Studio reaches beyond its workers. */
export function IntegrationSettings() {
  const deployment = useQuery(deploymentQuery);
  if (deployment.isPending) return <LoadingState label="Loading Integrations" fill />;
  if (deployment.error) return <Alert color="red">{deployment.error.message}</Alert>;
  const { civitai, huggingFace, assistant } = deployment.data.integrations;
  return (
    <Stack gap="lg">
      <SettingGroup title="Model Sources">
        <SettingRow label="Civitai" description={civitai.token.set ? "Token set" : "No token"}>
          {status(civitai.token.set, civitai.token.set ? "Connected" : "Public Only")}
        </SettingRow>
        <SettingRow
          label="Hugging Face"
          description={
            huggingFace.token.set ? "Token set" : "No token; gated models can't download"
          }
        >
          {status(huggingFace.token.set, huggingFace.token.set ? "Connected" : "Public Only")}
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Prompt Assistant">
        <SettingRow
          label="Status"
          description={
            assistant.available ? `Background work uses ${assistant.model}` : assistant.note
          }
        >
          {status(assistant.available, assistant.available ? "On" : "Off")}
        </SettingRow>
      </SettingGroup>
    </Stack>
  );
}
