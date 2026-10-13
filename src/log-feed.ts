import type { LocationRef, RpcClient } from "@opencode/client";
import type { DebugRpc, DebugSnapshot } from "./rpc";

export function watchDebugLogs(
  rpc: RpcClient<typeof DebugRpc>,
  location: LocationRef,
  onSnapshot: (snapshot: DebugSnapshot) => void,
  onError: (message: string) => void,
): () => void {
  const controller = new AbortController();
  let refreshing = false;
  let pending = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  async function refresh() {
    if (controller.signal.aborted) return;
    if (refreshing) {
      pending = true;
      return;
    }
    refreshing = true;
    do {
      pending = false;
      try {
        const snapshot = await rpc.logs({}, { location, signal: controller.signal });
        if (!controller.signal.aborted) onSnapshot(snapshot as DebugSnapshot);
      } catch (error) {
        if (!controller.signal.aborted) {
          onError(error instanceof Error ? error.message : String(error));
        }
      }
    } while (pending && !controller.signal.aborted);
    refreshing = false;
  }

  const unsubscribe = rpc.events.on("updated", (event) => {
    if (
      event.location?.directory !== location.directory || debounce
    ) return;
    // Coalesce bursts while keeping the window responsive.
    debounce = setTimeout(() => {
      debounce = undefined;
      void refresh();
    }, 50);
  }, { signal: controller.signal });

  // Refresh after missed events/reconnects as well as on live notifications.
  const timer = setInterval(() => void refresh(), 2000);
  void refresh();
  return () => {
    controller.abort();
    unsubscribe();
    clearInterval(timer);
    clearTimeout(debounce);
  };
}
