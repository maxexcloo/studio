import type { ReactNode } from "react";
import { ActionIcon, Menu, Tooltip } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, UserRound } from "lucide-react";
import { Link, useLocation } from "react-router";
import { post } from "../../api";
import { ownAccountQuery, useAccount } from "./AccountGate";

/** The account's name, Account and Sign Out, last after any `children` (the phone overflow's items). */
export function AccountMenuContent({ children }: { children?: ReactNode }) {
  const location = useLocation(),
    client = useQueryClient();
  const account = useAccount(),
    multi = account.data?.mode === "multi-user";
  const own = useQuery({ ...ownAccountQuery, enabled: multi });
  const signOut = useMutation({
    mutationFn: () => post("/api/accounts/sign-out"),
    onSuccess: () => {
      client.clear();
      window.location.assign("/");
    },
  });
  const name = multi ? own.data?.account.username || "Your Account" : "Single-User Development";
  return (
    <>
      {children}
      {children && <Menu.Divider />}
      <Menu.Label>{name}</Menu.Label>
      <Menu.Item
        component={Link}
        to="/settings#account"
        state={{ backgroundLocation: location }}
        leftSection={<UserRound size={16} />}
      >
        Account
      </Menu.Item>
      {multi && (
        <Menu.Item
          leftSection={<LogOut size={16} />}
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
        >
          Sign Out
        </Menu.Item>
      )}
    </>
  );
}
export function AccountMenu() {
  return (
    <Menu position="bottom-end" shadow="md" width={240}>
      <Tooltip label="User">
        <Menu.Target>
          <ActionIcon aria-label="User" variant="subtle" color="gray">
            <UserRound size={19} />
          </ActionIcon>
        </Menu.Target>
      </Tooltip>
      <Menu.Dropdown>
        <AccountMenuContent />
      </Menu.Dropdown>
    </Menu>
  );
}
