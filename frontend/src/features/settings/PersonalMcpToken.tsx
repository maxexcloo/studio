import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { api, post } from "../../api";
import { useCopy } from "../../ui/clipboard";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { ownAccountQuery } from "../auth/AccountGate";
import { useSettingsSection } from "./SettingsNavigation";

export interface McpTokenStatus {
  endpoint: string;
  enabled: boolean;
  createdAt: string;
}

/** Settings › Account › MCP Access, with Revoke Token in the section's Danger Zone. */
export function PersonalMcpToken({ initial }: { initial?: McpTokenStatus }) {
  const client = useQueryClient();
  const visible = useSettingsSection() === "account";
  const active = useRef(true);
  const visit = useRef(0);
  const [issuedToken, setIssuedToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState("");
  const { copied, copy } = useCopy();
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
      setRevoking(false);
    }
  };
  const endpoint = status.data?.endpoint || "";
  const copyButton = (text: string, name: string, label: string) => (
    <Button
      size="compact-sm"
      variant="default"
      leftSection={copied === name ? <Check size={16} /> : <icons.copy size={16} />}
      disabled={!text}
      onClick={() => copy(text, name)}
    >
      {copied === name ? "Copied" : label}
    </Button>
  );
  return (
    <>
      <SettingGroup title="MCP Access">
        {status.error && <Alert color="red">{status.error.message}</Alert>}
        {error && <Alert color="red">{error}</Alert>}
        <SettingRow
          label="MCP Endpoint"
          description={
            <Text span size="xs" style={{ wordBreak: "break-all" }}>
              {endpoint}
            </Text>
          }
        >
          {copyButton(endpoint, "url", "Copy URL")}
        </SettingRow>
        <SettingRow
          label="MCP Token"
          description={
            status.data?.createdAt
              ? `Carries your account’s access. Created ${new Date(status.data.createdAt).toLocaleString("en-AU")}.`
              : "Carries your account’s access. Send it as a bearer token, or use the URL with it in a client that only takes a URL (such as Grok)."
          }
        >
          <Badge color={status.data?.enabled ? "green" : "gray"} miw="max-content">
            {status.data?.enabled ? "Token Active" : "No Token Issued"}
          </Badge>
          <Button
            size="compact-sm"
            variant="default"
            loading={busy && !revoking}
            disabled={!status.data || busy}
            onClick={() => void change(false)}
          >
            {status.data?.enabled ? "Rotate Token" : "Create Token"}
          </Button>
        </SettingRow>
        {issuedToken && (
          <Stack gap="xs" py="sm">
            <TextInput
              label="New MCP Token"
              description="Shown only during this visit. Store it in your MCP client before leaving Account."
              value={issuedToken}
              readOnly
              autoComplete="off"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Group gap="xs">
              {copyButton(issuedToken, "token", "Copy Token")}
              {copyButton(
                endpoint && `${endpoint.replace(/\/+$/, "")}/${issuedToken}`,
                "tokenUrl",
                "Copy URL with Token",
              )}
            </Group>
          </Stack>
        )}
      </SettingGroup>
      {status.data?.enabled && (
        <SettingGroup title="Danger Zone" danger>
          <SettingRow
            label="Revoke Token"
            description="MCP clients using your token lose access at once."
          >
            <Button
              size="compact-sm"
              color="red"
              variant="light"
              disabled={busy}
              onClick={() => setRevoking(true)}
            >
              Revoke Token
            </Button>
          </SettingRow>
          <ConfirmDialog
            opened={revoking}
            title="Revoke Token"
            action="Revoke"
            pending={busy}
            onConfirm={() => void change(true)}
            onClose={() => setRevoking(false)}
          >
            Revoke your MCP token? Clients using it stop working until you create a new one.
          </ConfirmDialog>
        </SettingGroup>
      )}
    </>
  );
}
