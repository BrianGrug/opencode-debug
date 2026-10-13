import solidPlugin from "@opentui/solid/bun-plugin";
import { rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["src/index.ts", "src/tui.tsx", "src/rpc.ts"],
  outdir: "dist",
  target: "node",
  packages: "external",
  plugins: [solidPlugin],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
