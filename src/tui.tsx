import { Plugin } from "@opencode/plugin/tui";
import { LogView } from "./log-view";

export default Plugin.define({
  id: "opencode-debug.tui",
  setup(context) {
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "opencode-debug.logs",
        title: "View live debug logs",
        description: "Open the runtime debug log window",
        group: "Debug",
        palette: true,
        slash: { name: "debug-logs" },
        run() {
          const route = context.ui.router.current();
          const location = (route.type === "session"
            ? context.data.session.get(route.sessionID)?.location
            : undefined) ?? context.location ?? context.data.location.default();
          context.ui.dialog.show(() => <LogView context={context} location={location} />);
          context.ui.dialog.set({ size: "xlarge", centered: true });
        },
      }],
    }));
  },
});
