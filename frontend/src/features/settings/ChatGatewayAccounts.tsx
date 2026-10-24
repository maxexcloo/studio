import { useState } from "react";
import { Alert, Button, Group, Select, Stack, Switch, Table, Text } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { post } from "../../api";
import { EmptyState } from "../../ui/EmptyState";

export interface GatewayAccounts {
  adminTools: boolean;
  links: { identity: string; accountId: string; linkedAt?: string }[];
  pending: { identity: string; firstSeenAt?: string; lastSeenAt?: string }[];
}
type Action =
  | { kind: "link"; identity: string; accountId?: string }
  | { kind: "dismiss"; identity: string }
  | { kind: "admin"; on: boolean };

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
    .map((account) => ({
      value: account.id,
      label: `${account.displayName} (${account.username})`,
    }));
  const links = [...(gateway?.links || [])].sort((a, b) => a.identity.localeCompare(b.identity));
  const pending = [...(gateway?.pending || [])].sort((a, b) =>
    a.identity.localeCompare(b.identity),
  );
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
      {!links.length && !pending.length ? (
        <EmptyState title="No Chat Users Yet" />
      ) : (
        <Table.ScrollContainer minWidth={560}>
          <Table aria-label="Chat Gateway Identities" verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Identity</Table.Th>
                <Table.Th>Account</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {links.map((link) => {
                const account = accounts.find((account) => account.id === link.accountId);
                return (
                  <Table.Tr key={link.identity} aria-label={`Linked ${link.identity}`}>
                    <Table.Td>{link.identity}</Table.Td>
                    <Table.Td>
                      {account ? `${account.displayName} (${account.username})` : "Removed Account"}
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="compact-sm"
                        variant="light"
                        disabled={change.isPending}
                        aria-label={`Unlink ${link.identity}`}
                        onClick={() => change.mutate({ kind: "link", identity: link.identity })}
                      >
                        Unlink
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {pending.map((identity) => (
                <Table.Tr key={identity.identity} aria-label={`Pending ${identity.identity}`}>
                  <Table.Td>
                    <Text size="sm">{identity.identity}</Text>
                    <Text size="xs" c="dimmed">
                      Awaiting Link
                      {identity.firstSeenAt
                        ? ` · ${new Date(identity.firstSeenAt).toLocaleString("en-AU")}`
                        : ""}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Select
                      aria-label={`Account for ${identity.identity}`}
                      placeholder="Choose an Account"
                      data={options}
                      value={choices[identity.identity] || null}
                      disabled={change.isPending}
                      onChange={(value) =>
                        setChoices((current) => ({ ...current, [identity.identity]: value || "" }))
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Button
                        size="compact-sm"
                        disabled={change.isPending || !choices[identity.identity]}
                        aria-label={`Link ${identity.identity}`}
                        onClick={() =>
                          change.mutate({
                            kind: "link",
                            identity: identity.identity,
                            accountId: choices[identity.identity],
                          })
                        }
                      >
                        Link
                      </Button>
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        disabled={change.isPending}
                        aria-label={`Dismiss ${identity.identity}`}
                        onClick={() =>
                          change.mutate({ kind: "dismiss", identity: identity.identity })
                        }
                      >
                        Dismiss
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
