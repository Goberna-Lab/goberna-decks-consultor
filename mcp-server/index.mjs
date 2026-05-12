#!/usr/bin/env node
/**
 * Goberna MCP Server — entry point.
 *
 * Estructura modular:
 *   lib/api.mjs        → auth/token, fetch helpers, replies
 *   prompts.mjs        → PROMPTS + GetPromptMessages
 *   tools/index.mjs    → agrega TOOLS + handlers de cada módulo
 *   tools/<dominio>.mjs → schemas + handlers por dominio (auth, candidates, decks, fase2, analytics)
 *
 * Para agregar una tool nueva: editá (o creá) un archivo en tools/ y agregalo a tools/index.mjs.
 * NO toques este archivo — el dispatch es genérico.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { TOOLS, handlers } from "./tools/index.mjs";
import { PROMPTS, getPromptMessages } from "./prompts.mjs";
import { API_URL, TOKEN_PATH } from "./lib/api.mjs";

const server = new Server(
  { name: "goberna-mcp", version: "0.8.0" },
  { capabilities: { tools: {}, prompts: {} } },
);

server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));

server.setRequestHandler(GetPromptRequestSchema, async (request) =>
  getPromptMessages(request.params.name),
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const handler = handlers[name];
  if (!handler) {
    return {
      isError: true,
      content: [{ type: "text", text: `Tool desconocida: ${name}` }],
    };
  }
  try {
    return await handler(args);
  } catch (e) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error: ${e.message}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`[goberna-mcp] running · API=${API_URL} · token=${TOKEN_PATH}\n`);
