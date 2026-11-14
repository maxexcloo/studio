import { useCallback, useSyncExternalStore } from "react";
import {
  hashKey,
  useMutation,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";

/**
 * A media action's mutation, kept with the item it started on rather than with the component that
 * ran it. The viewer and a tile's menu reuse or remount their actions as items change, so the
 * pending state and its variables come from the mutation cache under the item's key: another item
 * shows its own state, and coming back shows the run still going. The options' callbacks stay with
 * the item they started on; those passed to `mutate` stop once the item changes, so follow-ups that
 * must happen anyway take `mutateAsync`.
 */
export function useItemMutation<TData = unknown, TVariables = void>(
  itemId: string,
  action: string,
  options: Omit<UseMutationOptions<TData, Error, TVariables>, "mutationKey">,
) {
  const mutationKey = ["item-action", action, itemId];
  const mutation = useMutation({ ...options, mutationKey });
  const cache = useQueryClient().getMutationCache();
  const key = hashKey(mutationKey);
  // Only this item's own runs wake it: `useMutationState` rechecks on every cache event, including
  // each observer's options update, which every render of every action sends.
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
  return {
    ...mutation,
    isPending: Boolean(running),
    variables: running?.state.variables as TVariables | undefined,
  };
}
