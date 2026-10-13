import { appendFile, mkdir, open, readFile, truncate } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { getDebugInstructions } from "./instructions";

export const debugConfig = {
  endpoint: "/debug",
  healthEndpoint: "/health",
  logDir: ".opencode",
  logFileName: "debug.log",
  integrationID: "ngrok",
  integrationLabel: "Configure Ngrok Token",
} as const;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(response: ServerResponse, data: object, status = 200): void {
  response.writeHead(status, { "Content-Type": "application/json", ...corsHeaders });
  response.end(JSON.stringify(data));
}

function createDebugServer(logPath: string, onChange: () => void): Server {
  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "OPTIONS") {
        response.writeHead(204, corsHeaders);
        response.end();
        return;
      }
      if (url.pathname === debugConfig.healthEndpoint && request.method === "GET") {
        jsonResponse(response, { status: "ok" });
        return;
      }
      if (url.pathname !== debugConfig.endpoint || request.method !== "POST") {
        jsonResponse(response, { error: "Not found" }, 404);
        return;
      }

      let body: unknown;
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        jsonResponse(response, { error: "Invalid JSON body" }, 400);
        return;
      }
      if (
        !body || typeof body !== "object" || !("label" in body) ||
        typeof body.label !== "string" || !body.label.trim()
      ) {
        jsonResponse(response, { error: "label must be a non-empty string" }, 400);
        return;
      }

      const data = "data" in body ? body.data : undefined;
      const label = body.label.replace(/[\r\n]/g, " ");
      const timestamp = new Date().toISOString();
      const line = data !== undefined
        ? `[${timestamp}] ${label} | ${JSON.stringify(data)}\n`
        : `[${timestamp}] ${label}\n`;
      await appendFile(logPath, line);
      onChange();
      jsonResponse(response, { received: true });
    })().catch(() => {
      jsonResponse(response, { error: "Failed to record debug event" }, 500);
    });
  });
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function readLogLines(logPath: string, tail?: number): Promise<string[]> {
  if (!tail) return (await readFile(logPath, "utf8")).split("\n").filter(Boolean);
  // The live viewer only needs the tail, even when a capture file is large.
  const file = await open(logPath, "r");
  try {
    let position = (await file.stat()).size;
    let newlines = 0;
    const chunks: Buffer[] = [];
    while (position > 0 && newlines <= tail) {
      const length = Math.min(position, 64 * 1024);
      position -= length;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, position);
      const chunk = buffer.subarray(0, bytesRead);
      for (const byte of chunk) if (byte === 10) newlines++;
      chunks.unshift(chunk);
    }
    let content = Buffer.concat(chunks).toString("utf8");
    if (position > 0) content = content.slice(content.indexOf("\n") + 1);
    return content.split("\n").filter(Boolean).slice(-tail);
  } finally {
    await file.close();
  }
}

export function createDebugRuntime(
  directory: string,
  getToken: () => Promise<string | undefined>,
  onChange: () => void,
) {
  const logPath = join(directory, debugConfig.logDir, debugConfig.logFileName);
  const displayPath = `${debugConfig.logDir}/${debugConfig.logFileName}`;
  let server: Server | undefined;
  let tunnel: { close(): Promise<void> } | undefined;
  let activeDebugUrl: string | undefined;
  let disposed = false;
  let lifecycle = Promise.resolve();

  // Starts, stops, and unloads may arrive concurrently from different sessions.
  function exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = lifecycle.then(action);
    lifecycle = result.then(() => {}, () => {});
    return result;
  }

  async function stopServer(): Promise<void> {
    activeDebugUrl = undefined;
    if (tunnel) {
      await tunnel.close().catch(() => {});
      tunnel = undefined;
    }
    if (server) {
      const current = server;
      server = undefined;
      await new Promise<void>((resolve, reject) => {
        current.close((error) => error ? reject(error) : resolve());
        current.closeAllConnections();
      });
    }
    onChange();
  }

  return {
    start({ port }: { port?: number } = {}): Promise<string> {
      return exclusive(async () => {
        if (disposed) throw new Error("Debug plugin has been unloaded.");
        if (activeDebugUrl) {
          return `Debug server already running!\n\nDebug URL: ${activeDebugUrl}\n\nUse HTTP POST instrumentation in the application's language, then reproduce the issue.`;
        }
        if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
          throw new Error("port must be an integer between 0 and 65535.");
        }
        await mkdir(dirname(logPath), { recursive: true });
        const next = createDebugServer(logPath, onChange);
        try {
          await listen(next, port ?? 0);
        } catch (error) {
          if (!port || !hasCode(error, "EADDRINUSE")) throw error;
          await listen(next, 0);
        }
        server = next;

        try {
          const address = next.address();
          if (!address || typeof address === "string") throw new Error("No debug server address.");
          let baseUrl = `http://127.0.0.1:${address.port}`;
          const token = process.env.NGROK_AUTHTOKEN || await getToken();
          if (token) {
            const ngrok = await import("@ngrok/ngrok");
            const listener = await ngrok.forward({ addr: address.port, authtoken: token });
            tunnel = listener;
            const publicUrl = listener.url();
            if (!publicUrl) throw new Error("Ngrok did not return a public URL.");
            baseUrl = publicUrl;
          }
          activeDebugUrl = `${baseUrl}${debugConfig.endpoint}`;
          onChange();
          return [
            "# Debug Mode Started",
            "",
            `**Debug URL:** ${activeDebugUrl}`,
            `**Log File:** ${displayPath}`,
            "",
            getDebugInstructions(activeDebugUrl),
          ].join("\n");
        } catch (error) {
          await stopServer();
          throw error;
        }
      });
    },

    stop(): Promise<string> {
      return exclusive(async () => {
        if (!server) return "Debug server is not running.";
        await stopServer();
        return [
          "# Debug Mode Stopped",
          "",
          `Log file preserved at: ${displayPath}`,
          "",
          "**Remember:** Remove the temporary HTTP debug instrumentation from the codebase.",
        ].join("\n");
      });
    },

    async clear(): Promise<string> {
      try {
        await truncate(logPath, 0);
      } catch (error) {
        if (hasCode(error, "ENOENT")) return `Debug log does not exist yet: ${displayPath}`;
        throw error;
      }
      onChange();
      return `Debug log cleared: ${displayPath}\n\nReady for fresh debug data.`;
    },

    async read({ tail }: { tail?: number } = {}): Promise<string> {
      if (tail !== undefined && (!Number.isInteger(tail) || tail < 1)) {
        throw new Error("tail must be a positive integer.");
      }
      let output: string[];
      try {
        output = await readLogLines(logPath, tail);
      } catch (error) {
        if (hasCode(error, "ENOENT")) {
          return "No debug log yet.\n\n**Tip:** Add HTTP debug instrumentation and reproduce the issue.";
        }
        throw error;
      }
      if (!output.length) {
        return "Debug log is empty.\n\n**Tip:** The instrumented code paths may not have been executed. Reproduce the issue.";
      }
      return [
        `# Debug Log (${output.length} entries)`,
        "=".repeat(50),
        "",
        output.join("\n"),
        "",
        "=".repeat(50),
        "**Analyze the above data to identify the issue.**",
      ].join("\n");
    },

    async status(): Promise<string> {
      if (!activeDebugUrl) {
        return "Debug mode is **not active**.\n\nUse debug_start to begin a debugging session.";
      }
      return [
        "# Debug Mode Active",
        "",
        `**Debug URL:** ${activeDebugUrl}`,
        `**Log File:** ${displayPath}`,
        "",
        "Send HTTP POST requests to this URL from your application's language to capture debug data.",
      ].join("\n");
    },

    instructions(): string | undefined {
      return activeDebugUrl ? getDebugInstructions(activeDebugUrl) : undefined;
    },

    async snapshot() {
      let lines: string[] = [];
      try {
        lines = await readLogLines(logPath, 200);
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
      }
      return { active: Boolean(activeDebugUrl), url: activeDebugUrl ?? null, lines };
    },

    dispose(): Promise<void> {
      disposed = true;
      return exclusive(stopServer);
    },
  };
}
