import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/** False on the server and while hydrating, true once the page is interactive. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
