import { Alert, Button } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../api";
import { compareNames } from "../../ui/DataTable";
import { formatDateTime } from "../../ui/dates";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { plural } from "../../ui/plural";
import { PreviewList } from "../../ui/PreviewList";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { modelsQuery } from "../generation/GenerationProvider";
import { type RememberedChat, chatChoicesQuery } from "./queries";

/** Settings › Taste › Chat Choices: what each chat's later generate calls keep, each with Clear. */
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
  const title = (choices: RememberedChat) => choices.title || `Chat ${choices.chat.slice(0, 8)}`;
  const items = [...(chats.data?.chats ?? [])].sort((a, b) => compareNames(title(a), title(b)));
  return (
    <SettingGroup title="Chat Choices">
      {chats.isPending && <LoadingState label="Loading Chat Choices" />}
      {chats.data && !chats.data.chats.length && <EmptyState fill>No Chat Choices</EmptyState>}
      {items.length ? (
        <PreviewList items={items}>
          {(shown) => (
            <div>
              {shown.map((choices) => (
                <SettingRow
                  key={choices.chat}
                  label={<span style={{ overflowWrap: "anywhere" }}>{title(choices)}</span>}
                  description={[
                    model("Images:", choices.image),
                    model("Videos:", choices.video),
                    choices.loras === false && "No LoRAs",
                    choices.count && `${choices.count} each`,
                    choices.references &&
                      `${plural(choices.references.count, "reference")} until ${formatDateTime(choices.references.until)}`,
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
            </div>
          )}
        </PreviewList>
      ) : null}
      {chats.error && <Alert color="red">{chats.error.message}</Alert>}
    </SettingGroup>
  );
}
