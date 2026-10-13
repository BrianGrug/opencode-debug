import { Plugin } from "@opencode/plugin";
import { createDebugRuntime, debugConfig } from "./runtime";
import { debugWorkflow, toolDescriptions } from "./instructions";
import { DebugRpc } from "./rpc";

export default Plugin.define({
  id: "opencode-debug",
  async setup(ctx) {
    let notify = () => {};
    const debug = createDebugRuntime(ctx.location.directory, async () => {
      const connection = await ctx.integration.connection.active(debugConfig.integrationID);
      const credential = connection
        ? await ctx.integration.connection.resolve(connection)
        : undefined;
      return credential?.type === "key" ? credential.key : undefined;
    }, () => notify());

    const rpc = await ctx.rpc.register(DebugRpc, { logs: () => debug.snapshot() });
    notify = () => { void rpc.events.emit("updated", {}).catch(() => {}); };

    await ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID: debugConfig.integrationID,
        method: { type: "key", label: debugConfig.integrationLabel },
      });
      editor.update(debugConfig.integrationID, (integration) => {
        integration.name = "ngrok";
      });
    });

    await ctx.command.transform((editor) => {
      editor.add({
        name: "debug",
        description: "Debug an issue using captured runtime logs",
        async execute({ sessionID, prompt, delivery }) {
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            // Append instructions so composer attachment offsets stay valid.
            text: prompt.text ? `${prompt.text}\n\n${debugWorkflow}` : debugWorkflow,
            delivery,
          });
        },
      });
    });

    await ctx.session.hook("context", (event) => {
      const instructions = debug.instructions();
      if (instructions) event.system.push({ type: "text", text: instructions });
    });

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "debug_start",
        description: toolDescriptions.start,
        input: {
          type: "object",
          properties: {
            port: {
              type: "integer",
              minimum: 0,
              maximum: 65535,
              description: "Port for local server (default: auto-select)",
            },
          },
          additionalProperties: false,
        },
        async execute(input) {
          return { content: await debug.start(input as { port?: number }) };
        },
      });
      editor.add({
        name: "debug_read",
        description: toolDescriptions.read,
        input: {
          type: "object",
          properties: {
            tail: {
              type: "integer",
              minimum: 1,
              description: "Only show last N lines (useful for large logs)",
            },
          },
          additionalProperties: false,
        },
        async execute(input) {
          return { content: await debug.read(input as { tail?: number }) };
        },
      });
      for (const [name, description, execute] of [
        ["debug_stop", toolDescriptions.stop, debug.stop],
        ["debug_clear", toolDescriptions.clear, debug.clear],
        ["debug_status", toolDescriptions.status, debug.status],
      ] as const) {
        editor.add({
          name,
          description,
          input: { type: "object", properties: {}, additionalProperties: false },
          async execute() {
            return { content: await execute() };
          },
        });
      }
    });

    return async () => {
      notify = () => {};
      await debug.dispose();
    };
  },
});
