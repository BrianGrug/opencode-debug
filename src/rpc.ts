import { Rpc } from "@opencode/plugin/rpc";

export interface DebugSnapshot {
  active: boolean;
  url: string | null;
  lines: string[];
}

export const DebugRpc = Rpc.define({
  id: "opencode-debug",
  methods: {
    logs: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          active: { type: "boolean" },
          url: { type: ["string", "null"] },
          lines: { type: "array", items: { type: "string" } },
        },
        required: ["active", "url", "lines"],
        additionalProperties: false,
      },
    },
  },
  events: {
    updated: { schema: { type: "object", properties: {}, additionalProperties: false } },
  },
});
