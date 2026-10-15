export const debugWorkflow = `## Runtime debugging workflow

Debug the issue described by the user or the current conversation.

1. Call debug_status. If capture is active, use debug_read to inspect existing logs and retain anything useful for diagnosis or comparison.
2. If capture is inactive, call debug_start without a port argument to select a free random port. Do not explicitly pass port 0, 4173, or 5173.
3. Understand the relevant code paths and add temporary HTTP POST instrumentation using the application's own language and HTTP client. Capture function inputs/outputs, state changes, errors, and branch decisions.
4. Clear stale logs with debug_clear before a new reproduction only when they are no longer useful. Preserve previous logs when comparing behavior before and after a change.
5. Tell the user what to reproduce and that /debug-logs opens the live log window. Use the question tool to ask whether they have reproduced the issue, with a "Reproduced" option. Wait for their answer before continuing.
6. Call debug_read, analyze the captured data, and fix the cause. For another reproduction, repeat the log-retention decision and the "Reproduced" question.
7. Once the user confirms the issue is resolved, remove all temporary debug instrumentation and call debug_stop.

Tools: debug_start starts capture, debug_status reports the current URL, debug_read reads captured data, debug_clear clears obsolete logs, and debug_stop closes capture while preserving the log file.`;

export const toolDescriptions = {
  start: `Start debug mode to capture runtime data from code in any programming language.

WORKFLOW:
1. Start the debug server with this tool
2. Add HTTP POST instrumentation using the codebase's native HTTP client
3. Ask the user to reproduce the issue using the question tool with a "Reproduced" option
4. Use debug_read to analyze captured logs and identify the problem
5. Remove the temporary instrumentation and call debug_stop

Send JSON with a string label and optional data to the returned URL. No client SDK is required.`,
  stop: `Stop debug mode and preserve the captured logs for debug_read.
Remember to remove the temporary HTTP debug instrumentation from the codebase.`,
  clear: "Clear the debug log file to start fresh before a new debugging session.",
  read: `Read timestamped debug logs captured by HTTP instrumentation.
Use this after reproducing the issue to trace execution, identify unexpected values,
locate errors, and compare expected vs actual behavior.`,
  status: "Check if debug mode is currently active and get the debug URL.",
};

export function getDebugInstructions(debugUrl: string): string {
  return `## Debug Mode Instructions

You are in DEBUG MODE. Instrument the codebase using its own language and HTTP client to capture runtime data. Any language that can send an HTTP request is supported; no JavaScript runtime or client SDK is needed in the application.

### HTTP contract
- URL: ${debugUrl}
- Method: POST
- Content-Type: application/json
- Body: {"label":"descriptive-label","data":{"key":"value"}}
- label: required non-empty string
- data: optional JSON value (object, array, string, number, boolean, or null)
- Success: HTTP 200 with {"received":true}

${debugWorkflow}

### Instrumentation guidance
- Match the language, libraries, and conventions already used in the codebase.
- Use descriptive labels and JSON-serializable data; capture error messages and stack traces explicitly.
- Keep requests best-effort: use a short timeout and handle serialization/network failures without changing application behavior.
- Prefer the runtime's existing asynchronous/background mechanism where appropriate; flush pending requests before a short-lived program exits.
- Use the returned URL verbatim. For a remote application, use the public ngrok URL or another address reachable from that environment.

### Shell / cURL example
\`\`\`sh
curl --max-time 1 -sS -X POST '${debugUrl}' \\
  -H 'Content-Type: application/json' \\
  --data '{"label":"checkpoint","data":{"value":42}}' >/dev/null 2>&1 || true
\`\`\`

### JavaScript / TypeScript example
\`\`\`javascript
fetch(${JSON.stringify(debugUrl)}, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ label: "checkpoint", data: { value: 42 } }),
  signal: AbortSignal.timeout(1000),
}).catch(() => {});
\`\`\`

### Python example (standard library)
\`\`\`python
import json
import urllib.request

try:
    request = urllib.request.Request(
        ${JSON.stringify(debugUrl)},
        data=json.dumps({"label": "checkpoint", "data": {"value": 42}}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=1) as response:
        response.read()
except (OSError, TypeError, ValueError):
    pass
\`\`\`

For other languages (Go, Java, C#, Ruby, Rust, PHP, etc.), send the same JSON with the project's native HTTP client.
`;
}
