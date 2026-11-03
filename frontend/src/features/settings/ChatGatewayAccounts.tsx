import { useState } from "react";
import { Alert, Button, Select, Switch } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { post } from "../../api";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";

export interface GatewayAccounts {
  adminTools: boolean;
  links: { identity: string; accountId: string; linkedAt?: string }[];
  pending: { identity: string; firstSeenAt?: string; lastSeenAt?: string }[];
}
type Action =
  | { kind: "link"; identity: string; accountId?: string }
  | { kind: "dismiss"; identity: string }
  | { kind: "admin"; on: boolean };

/** Links (or, without an account, unlinks) and dismisses chat identities, and switches admin tools. */
export function useGatewayChange() {
  const client = useQueryClient();
  return useMutation({
    meta: { inlineError: true },
    mutationFn: (action: Action) => {
      if (action.kind === "admin") return post("/api/accounts/gateway-admin", { on: action.on });
      if (action.kind === "dismiss")
        return post("/api/accounts/gateway-pending/dismiss", { identity: action.identity });
      return post("/api/accounts/gateway-links", {
        identity: action.identity,
        ...(action.accountId ? { accountId: action.accountId } : {}),
      });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["account-admin"] }),
  });
}

/** Settings › Users › Chat Gateway: its admin tools and the identities still awaiting a link. */
export function ChatGateway({
  gateway,
  accounts,
  change,
}: {
  gateway?: GatewayAccounts;
  accounts: { id: string; username: string }[];
  change: ReturnType<typeof useGatewayChange>;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const options = [...accounts]
    .sort((a, b) => a.username.localeCompare(b.username))
    .map((account) => ({ value: account.id, label: account.username }));
  return (
    <>
      <SettingGroup title="Chat Gateway">
        <SettingRow
          label="Admin Tools"
          description={
            gateway?.adminTools
              ? "Linked administrators can manage Library, catalogue and profiles from chat."
              : "Only an administrator’s personal MCP token gets admin tools."
          }
        >
          <Switch
            aria-label="Chat Gateway Admin Tools"
            checked={gateway?.adminTools === true}
            disabled={change.isPending}
            onChange={(event) => change.mutate({ kind: "admin", on: event.currentTarget.checked })}
          />
        </SettingRow>
        {(gateway?.pending || []).map(({ identity, firstSeenAt }) => (
          <SettingRow
            key={identity}
            label={identity}
            description={`Awaiting Link${firstSeenAt ? ` · ${new Date(firstSeenAt).toLocaleString("en-AU")}` : ""}`}
            wide
          >
            <Select
              aria-label={`Account for ${identity}`}
              placeholder="Choose an Account"
              data={options}
              value={choices[identity] || null}
              disabled={change.isPending}
              onChange={(value) =>
                setChoices((current) => ({ ...current, [identity]: value || "" }))
              }
              flex={1}
              miw={0}
            />
            <Button
              variant="default"
              disabled={change.isPending || !choices[identity]}
              aria-label={`Link ${identity}`}
              onClick={() =>
                change.mutate({ kind: "link", identity, accountId: choices[identity] })
              }
            >
              Link
            </Button>
            <Button
              variant="subtle"
              color="gray"
              disabled={change.isPending}
              aria-label={`Dismiss ${identity}`}
              onClick={() => change.mutate({ kind: "dismiss", identity })}
            >
              Dismiss
            </Button>
          </SettingRow>
        ))}
      </SettingGroup>
      {change.error && (
        <Alert color="red" title="Couldn’t Save Chat Gateway Changes">
          {change.error.message}
        </Alert>
      )}
    </>
  );
}
