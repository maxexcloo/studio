import { type MutationOptions, hashKey, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * A media action's mutation, kept with the item it started on rather than with the component that
 * ran it. The viewer and a tile's menu reuse or remount their actions as items change, so the
 * pending state and its variables come from the mutation cache under the item's key: another item
 * shows its own state, and coming back shows the run still going. Each run goes straight into the
 * cache, without `useMutation`'s observer, whose reset on every change of key re-renders the whole
 * viewer a second time per step. The options' callbacks stay with the item they started on; the
 * `onSuccess` passed to `mutate` stops once the item changes, so follow-ups that must happen anyway
 * take `mutateAsync`.
 */
export function useItemMutation<TData = unknown, TVariables = void>(
  itemId: string,
  action: string,
  options: Omit<MutationOptions<TData, Error, TVariables>, "mutationKey">,
) {
  const client = useQueryClient();
  const cache = client.getMutationCache();
  const mutationKey = ["item-action", action, itemId];
  const key = hashKey(mutationKey);
  // Only this item's own runs wake it, not every cache event.
  const subscribe = useCallback(
    (change: () => void) =>
      cache.subscribe((event) => {
        if (
          (event.type === "added" || event.type === "removed" || event.type === "updated") &&
          event.mutation.options.mutationKey &&
          hashKey(event.mutation.options.mutationKey) === key
        )
          change();
      }),
    [cache, key],
  );
  const running = useSyncExternalStore(subscribe, () =>
    cache.findAll({ mutationKey, exact: true, status: "pending" }).at(-1),
  );
  // This component's last failure, while it still shows the item.
  const [failure, setFailure] = useState<{ key: string; error: Error }>();
  const shown = useRef<string | null>(key);
  useEffect(() => {
    shown.current = key;
    return () => {
      shown.current = null;
    };
  }, [key]);
  const mutateAsync = (variables: TVariables) => {
    setFailure(undefined);
    return cache
      .build(client, { ...options, mutationKey })
      .execute(variables)
      .catch((error: Error) => {
        setFailure({ key, error });
        throw error;
      });
  };
  return {
    mutateAsync,
    mutate: (variables: TVariables, then?: { onSuccess?: (data: TData) => void }) =>
      void mutateAsync(variables).then(
        (data) => shown.current === key && then?.onSuccess?.(data),
        () => {},
      ),
    isPending: Boolean(running),
    variables: running?.state.variables as TVariables | undefined,
    error: failure?.key === key ? failure.error : null,
  };
}
