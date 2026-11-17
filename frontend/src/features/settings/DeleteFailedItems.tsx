import { Button, Select } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { SettingRow } from "../../ui/SettingRows";
import { useAccount } from "../auth/AccountGate";
import { galleryKey } from "../gallery/queries";
import { queueQuery } from "../generation/Queue";
import { accountAdminQuery } from "./AccountAdmin";

/**
 * Delete Failed Items: Preferences deletes the account's own; Settings › Generation (`others`) lets
 * administrators of a multi-user Studio delete another account's, or every account's.
 */
export function DeleteFailedItems({ others = false }: { others?: boolean }) {
  const client = useQueryClient();
  const own = useAccount().data?.account?.id;
  const accounts = useQuery({ ...accountAdminQuery, enabled: others });
  const [owner, setOwner] = useState("all");
  const [confirming, setConfirming] = useState(false);
  const owners = [
    { value: "all", label: "All Users" },
    ...(accounts.data?.accounts || [])
      .filter((entry) => entry.id !== own)
      .map((entry) => ({ value: entry.id, label: entry.username }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const whose = !others
    ? "your"
    : owner === "all"
      ? "every account's"
      : `${owners.find((entry) => entry.value === owner)?.label}'s`;
  const remove = useMutation({
    mutationFn: () =>
      post<{ cleared: number }>("/api/gallery/errors/clear", others ? { owner } : undefined),
    onSuccess: () => {
      for (const queryKey of [galleryKey, ["gallery-filters"], queueQuery.queryKey])
        void client.invalidateQueries({ queryKey });
      setConfirming(false);
    },
  });
  return (
    <SettingRow
      wide={others}
      label="Delete Failed Items"
      description={
        remove.data
          ? `${remove.data.cleared.toLocaleString()} deleted.`
          : others
            ? "Remove failed and cancelled items from one account's gallery, or every account's."
            : "Remove your failed and cancelled items from the gallery."
      }
    >
      {others && (
        <Select
          aria-label="Whose Failed Items"
          data={owners}
          value={owner}
          allowDeselect={false}
          searchable={owners.length > 8}
          onChange={(value) => value && setOwner(value)}
        />
      )}
      <Button
        size="compact-sm"
        color="red"
        variant="light"
        leftSection={<icons.delete size={16} />}
        onClick={() => setConfirming(true)}
      >
        Delete
      </Button>
      <ConfirmDialog
        opened={confirming}
        title="Delete Failed Items"
        action="Delete"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirming(false)}
      >
        Remove {whose} failed and cancelled items from the gallery?
      </ConfirmDialog>
    </SettingRow>
  );
}
