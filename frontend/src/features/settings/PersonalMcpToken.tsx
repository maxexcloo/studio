import { Alert, Badge, Button, Group, Text } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { api, post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { CopyButton } from "../../ui/CopyButton";
import { formatDateTime } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { SettingGroup, SettingRow } from "../../ui/SettingRows";
import { ownAccountQuery } from "../auth/AccountGate";
import { useSettingsSection } from "./SettingsNavigation";

export interface McpTokenStatus {
  endpoint: string;
  enabled: boolean;
  /** Whether the token can be shown again: one issued before tokens were kept can't. */
  viewable: boolean;
  createdAt: string;
}

/**
 * Settings › Account › MCP: the endpoint, the account's token and the URL with it, each with plain
 * row actions, then Rotate and Revoke in the Danger Zone. The token loads while the section shows,
 * hidden until Show, so Copy works within the tap.
 */
export function PersonalMcpToken() {
  const client = useQueryClient();
  const visible = useSettingsSection() === "account";
  const visit = useRef(0);
  const [token, setToken] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"rotate" | "revoke" | null>(null);
  const [error, setError] = useState("");
  const status = useQuery({ ...ownAccountQuery, select: (data) => data.mcp });
  const viewable = visible && Boolean(status.data?.viewable);
  // The token stays in this mounted view, never in a query or mutation cache, and leaves with it.
  // Each visit to the section starts hidden, even for a token issued while away.
  useEffect(() => {
    const current = ++visit.current;
    if (!viewable) {
      setToken("");
      setShown(false);
      return;
    }
    api<{ token: string }>("/api/accounts/mcp-token/reveal").then(
      (result) => current === visit.current && setToken(result.token),
      (error: Error) => current === visit.current && setError(error.message),
    );
  }, [visible, viewable, status.data?.createdAt]);
  const change = async (revoke: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const startedVisit = visit.current;
    try {
      if (revoke) await post("/api/accounts/mcp-token/revoke");
      else {
        const result = await post<{ token: string }>("/api/accounts/mcp-token");
        if (startedVisit === visit.current) {
          setToken(result.token);
          setShown(false);
        }
      }
      await client.invalidateQueries({ queryKey: ownAccountQuery.queryKey });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Couldn't update the MCP token");
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };
  const endpoint = status.data?.endpoint || "";
  // For clients that only take a URL (such as Grok).
  const withToken = endpoint && token ? `${endpoint.replace(/\/+$/, "")}/${token}` : "";
  const enabled = Boolean(status.data?.enabled);
  return (
    <>
      <SettingGroup
        title="MCP"
        toolbar={
          <Group justify="flex-end">
            <Badge color={enabled ? "green" : "gray"} miw="max-content">
              {enabled ? "Active" : "No Token"}
            </Badge>
          </Group>
        }
      >
        {status.error && <Alert color="red">{status.error.message}</Alert>}
        {error && <Alert color="red">{error}</Alert>}
        <SettingRow
          label="Endpoint"
          description={
            <Text span size="xs" style={{ wordBreak: "break-all" }}>
              {endpoint}
            </Text>
          }
        >
          <CopyButton size="compact-sm" text={endpoint} aria-label="Copy Endpoint" />
        </SettingRow>
        <SettingRow
          label="Token"
          description={
            !enabled ? (
              "Carries your account's access. Send it as a bearer token."
            ) : !status.data?.viewable ? (
              "Rotate it in the Danger Zone to view. This token was created before Studio kept tokens to show again."
            ) : (
              <>
                <Text span size="xs" ff="monospace" style={{ wordBreak: "break-all" }}>
                  {shown ? token : "•".repeat(24)}
                </Text>
                <br />
                Created {formatDateTime(status.data.createdAt)}.
              </>
            )
          }
        >
          {status.data && !enabled && (
            <Button
              size="compact-sm"
              variant="default"
              leftSection={<icons.add size={16} />}
              loading={busy}
              onClick={() => void change(false)}
            >
              Create
            </Button>
          )}
          {enabled && status.data?.viewable && (
            <>
              <Button
                size="compact-sm"
                variant="default"
                leftSection={shown ? <icons.hide size={16} /> : <icons.show size={16} />}
                disabled={!token}
                onClick={() => setShown(!shown)}
              >
                {shown ? "Hide" : "Show"}
              </Button>
              <CopyButton size="compact-sm" text={token} aria-label="Copy Token" />
            </>
          )}
        </SettingRow>
        <SettingRow
          label="URL with Token"
          description="For clients that only take a URL, such as Grok."
        >
          <CopyButton size="compact-sm" text={withToken} aria-label="Copy URL with Token" />
        </SettingRow>
      </SettingGroup>
      {status.data?.enabled && (
        <SettingGroup title="Danger Zone" danger>
          {/* The milder action first, as Delete comes last. */}
          <SettingRow
            label="Rotate Token"
            description="Issues a new token; MCP clients using the old one lose access at once."
          >
            <Button
              size="compact-sm"
              color="red"
              variant="light"
              disabled={busy}
              onClick={() => setConfirming("rotate")}
            >
              Rotate
            </Button>
          </SettingRow>
          <SettingRow
            label="Revoke Token"
            description="MCP clients using your token lose access at once."
          >
            <Button
              size="compact-sm"
              color="red"
              variant="light"
              disabled={busy}
              onClick={() => setConfirming("revoke")}
            >
              Revoke
            </Button>
          </SettingRow>
          <ConfirmDialog
            opened={confirming === "rotate"}
            title="Rotate Token"
            action="Rotate"
            pending={busy}
            onConfirm={() => void change(false)}
            onClose={() => setConfirming(null)}
          >
            Rotate your MCP token? Clients using the old one stop working until they get the new
            one.
          </ConfirmDialog>
          <ConfirmDialog
            opened={confirming === "revoke"}
            title="Revoke Token"
            action="Revoke"
            pending={busy}
            onConfirm={() => void change(true)}
            onClose={() => setConfirming(null)}
          >
            Revoke your MCP token? Clients using it stop working until you create a new one.
          </ConfirmDialog>
        </SettingGroup>
      )}
    </>
  );
}
