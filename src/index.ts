#!/usr/bin/env node
/**
 * MCP server for the ElevenLabs API.
 *
 * Exposes text to speech, speech to text, voice changer, sound effects, music,
 * voice design, voice management, generation history and dubbing as MCP tools.
 *
 * Transports: stdio by default, or streamable HTTP with TRANSPORT=http.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  DEFAULT_BASE_URL,
  DEFAULT_OUTPUT_DIRNAME,
  RESIDENCY_HOSTS,
  SERVER_NAME,
  SERVER_VERSION,
} from "./constants.js";
import { resolveOutputDir } from "./services/files.js";
import { registerAccountTools } from "./tools/account.js";
import { registerAudioTools } from "./tools/audio.js";
import { registerDubbingTools } from "./tools/dubbing.js";
import { registerSpeechTools } from "./tools/speech.js";
import { registerVoiceDesignTools } from "./tools/voiceDesign.js";
import { registerVoiceTools } from "./tools/voices.js";

const HELP = `${SERVER_NAME} ${SERVER_VERSION}

An MCP server for the ElevenLabs API.

Usage:
  elevenlabs-mcp-server              Serve over stdio (default)
  TRANSPORT=http elevenlabs-mcp-server   Serve streamable HTTP on 127.0.0.1:$PORT

Environment:
  ELEVENLABS_API_KEY    Required. Create one at https://elevenlabs.io/app/settings/api-keys
  ELEVENLABS_BASE_URL   Optional. Defaults to ${DEFAULT_BASE_URL}
                        Data-residency hosts: ${RESIDENCY_HOSTS.slice(1).join(", ")}
  ELEVENLABS_OUTPUT_DIR Optional. Directory generated audio is written to.
                        Defaults to ./${DEFAULT_OUTPUT_DIRNAME} under the working directory
  TRANSPORT             'stdio' (default) or 'http'
  PORT                  Port for the http transport. Defaults to 3000

Options:
  -h, --help            Show this message
  -v, --version         Show the version
`;

/** Builds a server with every tool registered. */
export function createElevenLabsServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerVoiceTools(server);
  registerSpeechTools(server);
  registerAudioTools(server);
  registerVoiceDesignTools(server);
  registerAccountTools(server);
  registerDubbingTools(server);
  return server;
}

function requireApiKey(): void {
  if (!process.env.ELEVENLABS_API_KEY?.trim()) {
    console.error(
      `${SERVER_NAME}: ELEVENLABS_API_KEY is not set. Export it in the environment that launches ` +
        "this server; create a key at https://elevenlabs.io/app/settings/api-keys.",
    );
    process.exit(1);
  }
}

async function runStdio(): Promise<void> {
  requireApiKey();
  const server = createElevenLabsServer();
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol, so all logging goes to stderr.
  console.error(`${SERVER_NAME} ${SERVER_VERSION} ready on stdio. Output directory: ${resolveOutputDir()}`);
}

/** Reads a request body, rejecting anything implausibly large for a JSON-RPC message. */
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 8 * 1024 * 1024) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Rejects cross-origin requests so a browser page cannot drive a locally bound
 * server (DNS rebinding protection).
 */
function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients do not send Origin
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

async function runHttp(): Promise<void> {
  requireApiKey();
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      if (req.method !== "POST" || !req.url?.startsWith("/mcp")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "POST /mcp is the only supported endpoint" }));
        return;
      }
      if (!originAllowed(req)) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "cross-origin requests are not allowed" }));
        return;
      }

      // A fresh stateless transport per request keeps request ids from colliding.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => void transport.close());

      try {
        const body = await readBody(req);
        const server = createElevenLabsServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (error) {
        console.error(`${SERVER_NAME}: request failed:`, error);
        if (!res.headersSent) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "malformed request" }));
        }
      }
    })();
  });

  httpServer.listen(port, "127.0.0.1", () => {
    console.error(
      `${SERVER_NAME} ${SERVER_VERSION} ready on http://127.0.0.1:${port}/mcp. ` +
        `Output directory: ${resolveOutputDir()}`,
    );
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }
  if (args.includes("-v") || args.includes("--version")) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }

  if ((process.env.TRANSPORT ?? "stdio").toLowerCase() === "http") {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((error: unknown) => {
  console.error(`${SERVER_NAME}: fatal error:`, error);
  process.exit(1);
});
