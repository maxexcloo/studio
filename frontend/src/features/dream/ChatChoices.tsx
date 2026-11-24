import { Alert, Button, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../api";
import { formatDateTime } from "../../ui/dates";
import { LoadingState } from "../../ui/LoadingState";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { modelsQuery } from "../generation/GenerationProvider";
import { type RememberedChat, chatChoicesQuery } from "./queries";

/** Taste › Chat Notes: what each chat's later generate calls keep, each with Clear. */
export function ChatChoices() {
  const client = useQueryClient();
  const chats = useQuery(chatChoicesQuery);
  const models = useQuery(modelsQuery);
  const clear = useMutation({
    mutationFn: (chat: string) =>
      api<{ chats: RememberedChat[] }>(`/api/chat-choices/${encodeURIComponent(chat)}`, {
        method: "DELETE",
      }),
    onSuccess: (next) => client.setQueryData(chatChoicesQuery.queryKey, next),
  });
  const model = (label: string, choice: RememberedChat["image"]) =>
    choice &&
    `${label} ${
      "tier" in choice
        ? `${choice.tier} tier`
        : models.data?.profiles.find((profile) => profile.id === choice.profile_id)?.label ||
          choice.profile_id
    }`;
  return (
    <SettingGroup title="Chat Choices">
      {chats.isPending && <LoadingState label="Loading Chat Choices" />}
      {chats.data && !chats.data.chats.length && (
        <Text size="xs" c="dimmed">
          Nothing remembered. The model, LoRA and count choices chats keep show here.
        </Text>
      )}
      {chats.data?.chats.map((choices) => (
        <SettingRow
          key={choices.chat}
          label={
            <span style={{ overflowWrap: "anywhere" }}>
              {choices.title || `Chat ${choices.chat.slice(0, 8)}`}
            </span>
          }
          description={[
            model("Images:", choices.image),
            model("Videos:", choices.video),
            choices.loras === false && "No LoRAs",
            choices.count && `${choices.count} each`,
            choices.references &&
              `${choices.references.count} reference${choices.references.count === 1 ? "" : "s"} until ${formatDateTime(choices.references.until)}`,
            `Last used ${formatDateTime(choices.at)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <Button
            size="compact-sm"
            variant="default"
            loading={clear.isPending && clear.variables === choices.chat}
            onClick={() => clear.mutate(choices.chat)}
          >
            Clear
          </Button>
        </SettingRow>
      ))}
      {chats.error && <Alert color="red">{chats.error.message}</Alert>}
    </SettingGroup>
  );
}
