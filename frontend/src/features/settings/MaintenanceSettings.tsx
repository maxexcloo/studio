import { Button, Stack } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Eraser, ExternalLink } from "lucide-react";
import { api, post } from "../../api";
import { copyText } from "../../ui/clipboard";
import { SettingGroup, SettingRow } from "./SettingRows";

/** Settings › Maintenance: clean-up and bug-report tools backed by the gallery and diagnostics routes. */
export function MaintenanceSettings() {
  const client = useQueryClient();
  // Read ahead so copying stays inside the tap, which Safari requires for the clipboard.
  const diagnostics = useQuery({
    queryKey: ["diagnostics"],
    queryFn: () => api<{ text: string }>("/api/diagnostics"),
    staleTime: 60_000,
  });
  const clear = useMutation({
    mutationFn: () => post("/api/gallery/errors/clear"),
    onSuccess: () => {
      for (const queryKey of [["gallery"], ["gallery-filters"], ["queue"]])
        void client.invalidateQueries({ queryKey });
      notifications.show({ message: "Failed items cleared" });
    },
  });
  return (
    <Stack gap="lg">
      <SettingGroup title="Clean Up">
        <SettingRow
          label="Clear Failed Items"
          description="Remove your failed and cancelled items from the gallery."
        >
          <Button
            variant="default"
            size="compact-sm"
            leftSection={<Eraser size={16} />}
            loading={clear.isPending}
            onClick={() => clear.mutate()}
          >
            Clear
          </Button>
        </SettingRow>
        <SettingRow
          label="Export Gallery"
          description="Download every finished image and video as one ZIP."
        >
          <Button
            component="a"
            href="/api/gallery/export"
            download
            variant="default"
            size="compact-sm"
            leftSection={<Download size={16} />}
          >
            Export
          </Button>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Help">
        <SettingRow
          label="Copy Diagnostics"
          description="Versions, system and GPU for a bug report; no prompts, images or file names."
        >
          <Button
            variant="default"
            size="compact-sm"
            leftSection={<Copy size={16} />}
            loading={diagnostics.isPending}
            disabled={!diagnostics.data}
            onClick={() => diagnostics.data && void copyText(diagnostics.data.text, "Diagnostics")}
          >
            Copy
          </Button>
        </SettingRow>
        <SettingRow label="Troubleshooting" description="Common errors and how to fix them.">
          <Button
            component="a"
            href="https://github.com/maxexcloo/studio/blob/main/TROUBLESHOOTING.md"
            target="_blank"
            rel="noopener noreferrer"
            variant="subtle"
            size="compact-sm"
            rightSection={<ExternalLink size={14} />}
          >
            Open
          </Button>
        </SettingRow>
      </SettingGroup>
    </Stack>
  );
}
