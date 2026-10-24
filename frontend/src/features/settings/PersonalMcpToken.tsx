import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { api, post } from "../../api";
import { copyText } from "../../ui/clipboard";
import { ownAccountQuery } from "../auth/AccountGate";

export interface McpTokenStatus {
  endpoint: string;
  enabled: boolean;
  createdAt: string;
}
export function PersonalMcpToken({ initial }: { initial?: McpTokenStatus }) {
  const client = useQueryClient();
  const location = useLocation();
  const visible =
    location.pathname === "/settings" && (!location.hash || location.hash === "#account");
  const active = useRef(true);
  const visit = useRef(0);
  const [issuedToken, setIssuedToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = useQuery({
    queryKey: ["personal-mcp-status"],
    queryFn: () => api<McpTokenStatus>("/api/accounts/mcp-token"),
    initialData: initial,
  });
  useEffect(() => {
    active.current = visible;
    if (!visible) setIssuedToken("");
    return () => {
      active.current = false;
      visit.current++;
    };
  }, [visible]);
  const change = async (revoke: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const startedVisit = visit.current;
    try {
      // Issued credentials stay in this mounted view, never in a query or mutation cache.
      if (revoke) {
        await post("/api/accounts/mcp-token/revoke");
        if (active.current) setIssuedToken("");
      } else {
        const result = await post<{ token: string }>("/api/accounts/mcp-token");
        if (active.current && startedVisit === visit.current) setIssuedToken(result.token);
      }
      await client.invalidateQueries({ queryKey: ["personal-mcp-status"] });
      await client.invalidateQueries({ queryKey: ownAccountQuery.queryKey });
    } catch (error) {
      if (active.current)
        setError(error instanceof Error ? error.message : "Couldn’t update the MCP token");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        Your personal MCP token has your account’s access. Use it as a bearer token separately from
        the endpoint URL.
      </Text>
      {status.error && <Alert color="red">{status.error.message}</Alert>}
      {error && <Alert color="red">{error}</Alert>}
      <TextInput label="MCP Endpoint" value={status.data?.endpoint || ""} readOnly />
      <Group>
        <Button
          variant="light"
          disabled={!status.data?.endpoint}
          onClick={() => void copyText(status.data!.endpoint, "Endpoint URL")}
        >
          Copy URL
        </Button>
        <Badge color={status.data?.enabled ? "green" : "gray"}>
          {status.data?.enabled ? "Token Active" : "No Token Issued"}
        </Badge>
      </Group>
      {status.data?.createdAt && (
        <Text size="xs" c="dimmed">
          Created {new Date(status.data.createdAt).toLocaleString("en-AU")}
        </Text>
      )}
      <Group>
        <Button loading={busy} disabled={!status.data} onClick={() => void change(false)}>
          {status.data?.enabled ? "Rotate Token" : "Create Token"}
        </Button>
        {status.data?.enabled && (
          <Button color="red" variant="light" disabled={busy} onClick={() => void change(true)}>
            Revoke Token
          </Button>
        )}
      </Group>
      {issuedToken && (
        <Stack gap="xs">
          <TextInput
            label="New MCP Token"
            description="Shown only during this visit. Store it in your MCP client before leaving Account."
            value={issuedToken}
            readOnly
            autoComplete="off"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            variant="light"
            style={{ alignSelf: "start" }}
            onClick={() => void copyText(issuedToken, "Token")}
          >
            Copy Token
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
