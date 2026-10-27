import { useState } from "react";
import { Alert, Button, Group, Menu, Select, Stack, Switch, Text } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { post } from "../../api";
import { DataTable } from "../../ui/DataTable";

export interface GatewayAccounts {
  adminTools: boolean;
  links: { identity: string; accountId: string; linkedAt?: string }[];
  pending: { identity: string; firstSeenAt?: string; lastSeenAt?: string }[];
}
type Identity =
  | GatewayAccounts["links"][number]
  | (GatewayAccounts["pending"][number] & { accountId?: undefined });
type Action =
  | { kind: "link"; identity: string; accountId?: string }
  | { kind: "dismiss"; identity: string }
  | { kind: "admin"; on: boolean };

const accountLabel = (account: { displayName: string; username: string }) =>
  `${account.displayName} (${account.username})`;

export function ChatGatewayAccounts({
  gateway,
  accounts,
}: {
  gateway?: GatewayAccounts;
  accounts: { id: string; displayName: string; username: string }[];
}) {
  const client = useQueryClient();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const change = useMutation({
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
  const options = [...accounts]
    .sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username))
    .map((account) => ({ value: account.id, label: accountLabel(account) }));
  const accountName = (id: string) => {
    const account = accounts.find((account) => account.id === id);
    return account ? accountLabel(account) : "Removed Account";
  };
  const rows: Identity[] = [
    ...(gateway?.links || []),
    ...(gateway?.pending || []).map((identity) => ({ ...identity, accountId: undefined })),
  ];
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        Link chat gateway identities to Studio accounts to use their access permissions. Matching
        verified email addresses can also link accounts automatically.
      </Text>
      <Switch
        label="Chat Gateway Admin Tools"
        checked={gateway?.adminTools === true}
        disabled={change.isPending}
        description={
          gateway?.adminTools
            ? "Linked administrators can manage Library, catalogue and profiles from chat."
            : "Only an administrator’s personal MCP token gets admin tools."
        }
        onChange={(event) => change.mutate({ kind: "admin", on: event.currentTarget.checked })}
      />
      {change.error && (
        <Alert color="red" title="Couldn’t Save Chat Gateway Changes">
          {change.error.message}
        </Alert>
      )}
      <DataTable
        label="Chat Gateway Identities"
        rows={rows}
        rowKey={(row) => row.identity}
        rowName={(row) => row.identity}
        initialSort={{ key: "identity", descending: false }}
        empty="No Chat Users Yet"
        columns={[
          {
            key: "identity",
            header: "Identity",
            sortValue: (row) => row.identity,
            cell: (row) => (
              <>
                <Text size="sm">{row.identity}</Text>
                {!row.accountId && (
                  <Text size="xs" c="dimmed">
                    Awaiting Link
                    {"firstSeenAt" in row && row.firstSeenAt
                      ? ` · ${new Date(row.firstSeenAt).toLocaleString("en-AU")}`
                      : ""}
                  </Text>
                )}
              </>
            ),
          },
          {
            key: "account",
            header: "Account",
            main: true,
            sortValue: (row) => (row.accountId ? accountName(row.accountId) : undefined),
            cell: (row) =>
              row.accountId ? (
                <Text size="sm">{accountName(row.accountId)}</Text>
              ) : (
                <Group gap="xs" wrap="nowrap">
                  <Select
                    aria-label={`Account for ${row.identity}`}
                    placeholder="Choose an Account"
                    data={options}
                    value={choices[row.identity] || null}
                    disabled={change.isPending}
                    onChange={(value) =>
                      setChoices((current) => ({ ...current, [row.identity]: value || "" }))
                    }
                    flex={1}
                    miw={0}
                  />
                  <Button
                    disabled={change.isPending || !choices[row.identity]}
                    aria-label={`Link ${row.identity}`}
                    onClick={() =>
                      change.mutate({
                        kind: "link",
                        identity: row.identity,
                        accountId: choices[row.identity],
                      })
                    }
                  >
                    Link
                  </Button>
                </Group>
              ),
          },
        ]}
        rowActions={(row) =>
          row.accountId ? (
            <Menu.Item
              disabled={change.isPending}
              onClick={() => change.mutate({ kind: "link", identity: row.identity })}
            >
              Unlink
            </Menu.Item>
          ) : (
            <Menu.Item
              disabled={change.isPending}
              onClick={() => change.mutate({ kind: "dismiss", identity: row.identity })}
            >
              Dismiss
            </Menu.Item>
          )
        }
      />
    </Stack>
  );
}
