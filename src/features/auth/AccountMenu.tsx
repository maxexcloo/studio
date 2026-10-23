import type { ReactNode } from "react";
import { ActionIcon, Menu } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, UserRound } from "lucide-react";
import { Link, useLocation } from "react-router";
import { api, failure, post } from "../../api";
import { useAccess, useAccount } from "./AccountGate";

export function AccountMenuContent({
  onNavigate,
  accountFirst = false,
  children,
}: {
  onNavigate?: () => void;
  accountFirst?: boolean;
  children?: ReactNode;
}) {
  const location = useLocation(),
    client = useQueryClient();
  const account = useAccount(),
    multi = account.data?.mode === "multi-user";
  const access = useAccess(!multi);
  const own = useQuery({
    queryKey: ["own-account"],
    queryFn: () => api<{ account: { displayName: string; username: string } }>("/api/accounts/me"),
    enabled: multi,
  });
  const signOut = useMutation({
    mutationFn: () => post(multi ? "/api/accounts/sign-out" : "/api/access/sign-out"),
    onSuccess: () => {
      client.clear();
      window.location.assign("/");
    },
    onError: failure,
  });
  const name = multi
    ? own.data?.account.displayName || own.data?.account.username || "Your Account"
    : access.data?.thisComputer === false
      ? "Studio User"
      : "Single-User Development";
  const canSignOut = multi || (access.data?.signedIn && access.data.thisComputer === false);
  return (
    <>
      {!accountFirst && <Menu.Item component={Link} to="/settings#account" state={{backgroundLocation:location}} onClick={onNavigate}>{name}</Menu.Item>}
      <Menu.Item
        component={Link}
        to="/settings#account"
        state={{ backgroundLocation: location }}
        leftSection={<UserRound size={16} />}
        onClick={onNavigate}
      >
        Account
      </Menu.Item>
      {children}
      {(canSignOut || accountFirst) && <Menu.Divider />}
      {accountFirst && <Menu.Item component={Link} to="/settings#account" state={{backgroundLocation:location}} onClick={onNavigate}>{name}</Menu.Item>}
      {canSignOut && (
        <>
          <Menu.Item
            leftSection={<LogOut size={16} />}
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            Sign Out
          </Menu.Item>
        </>
      )}
    </>
  );
}
export function AccountMenu() {
  return (
    <Menu position="bottom-end" shadow="md" width={240}>
      <Menu.Target>
        <ActionIcon aria-label="Your Account" variant="subtle" color="gray" size="lg" radius="xl">
          <UserRound size={19} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <AccountMenuContent />
      </Menu.Dropdown>
    </Menu>
  );
}
