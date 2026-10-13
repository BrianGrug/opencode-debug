import type { LocationRef } from "@opencode/client";
import type { Context } from "@opencode/plugin/tui/context";
import { useTerminalDimensions } from "@opentui/solid";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { watchDebugLogs } from "./log-feed";
import { DebugRpc, type DebugSnapshot } from "./rpc";

export function LogView(props: { context: Context; location: LocationRef }) {
  const [snapshot, setSnapshot] = createSignal<DebugSnapshot>();
  const [error, setError] = createSignal<string>();
  const dimensions = useTerminalDimensions();
  const stop = watchDebugLogs(
    props.context.client.rpc(DebugRpc),
    props.location,
    (value) => { setSnapshot(value); setError(undefined); },
    setError,
  );
  onCleanup(stop);

  return (
    <box paddingX={2} paddingY={1} gap={1} height={Math.max(8, dimensions().height - 8)}>
      <text fg={props.context.theme.text.base}><b>Debug Logs</b></text>
      <text fg={props.context.theme.text.base}>
        {snapshot()?.active ? "LIVE" : "STOPPED"} · {props.location.directory}
      </text>
      <Show when={snapshot()?.url}>
        <text fg={props.context.theme.text.base}>{snapshot()!.url!}</text>
      </Show>
      <Show when={error()}>
        <text fg={props.context.theme.text.base}>
          Unable to load logs: {error()}. Retrying… Check that the server plugin is enabled.
        </text>
      </Show>
      <scrollbox flexGrow={1} minHeight={1} focused stickyScroll stickyStart="bottom" scrollX={false}>
        <Show when={snapshot()?.lines.length} fallback={
          <text fg={props.context.theme.text.base}>
            {snapshot() ? "No logs yet. Ask the agent to run debug_start, then reproduce the issue." : "Loading logs…"}
          </text>
        }>
          <For each={snapshot()?.lines}>
            {(line) => <text fg={props.context.theme.text.base} flexShrink={0}>{line}</text>}
          </For>
        </Show>
      </scrollbox>
      <text fg={props.context.theme.text.base}>
        Latest 200 entries · ↑/↓ PgUp/PgDn scroll · End follow · Esc close
      </text>
    </box>
  );
}
