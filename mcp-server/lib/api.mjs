import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const API_URL = process.env.GOBERNA_API_URL ?? "https://electoral.goberna.club";
export const TOKEN_PATH =
  process.env.GOBERNA_TOKEN_PATH ?? join(homedir(), ".config", "goberna", "token");

export function hasToken() {
  return existsSync(TOKEN_PATH);
}

export function readToken() {
  if (!existsSync(TOKEN_PATH)) {
    throw new Error(
      `NO_TOKEN: No estás logged in. Llamá la tool 'login' con tu email y password del portal Goberna (electoral.goberna.club) — la misma cuenta del consultor.`,
    );
  }
  return readFileSync(TOKEN_PATH, "utf8").trim();
}

export function writeToken(token) {
  const dir = dirname(TOKEN_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  try {
    chmodSync(TOKEN_PATH, 0o600);
  } catch {
    /* algunos FS no permiten chmod (Windows), ignoramos */
  }
}

export function deleteToken() {
  if (existsSync(TOKEN_PATH)) {
    unlinkSync(TOKEN_PATH);
  }
}

async function parseError(res, path) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text().catch(() => null);
  }
  const code = typeof body === "object" && body?.code ? body.code : `HTTP_${res.status}`;
  const msg = typeof body === "object" && body?.message ? body.message : `HTTP ${res.status}`;
  const err = new Error(`Goberna API ${path} → ${msg}`);
  err.code = code;
  return err;
}

/**
 * Versión sin token — usada por login() porque todavía no hay token.
 */
export async function apiNoAuth(path, init = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw await parseError(res, path);
  return res.json();
}

export async function api(path, init = {}) {
  const token = readToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }
    const msg = typeof body === "object" && body?.message ? body.message : `HTTP ${res.status}`;
    throw new Error(`Goberna API ${path} → ${msg}`);
  }
  return res.json();
}

export function slugify(name) {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Comando shell platform-aware para abrir una URL en el browser. */
export function openUrlCmd(url) {
  const platform = process.platform;
  if (platform === "darwin") return `open "${url}"`;
  if (platform === "win32") return `start "" "${url}"`;
  return `(xdg-open "${url}" || sensible-browser "${url}" || brave-browser "${url}") >/dev/null 2>&1`;
}

/** Bloque shell estándar: arranca preview-server idempotente + abre URL. */
export function previewBashCommands(url) {
  return [
    `pgrep -f "preview-server.js" >/dev/null 2>&1 || (cd ~/Goberna/decks && nohup npm start >/tmp/goberna-preview.log 2>&1 &) && sleep 1`,
    openUrlCmd(url),
  ].join("\n");
}

/** Helper para retornar respuestas MCP de texto JSON. */
export function jsonReply(payload, { pretty = false } = {}) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, pretty ? 2 : 0),
      },
    ],
  };
}

export function textReply(text) {
  return { content: [{ type: "text", text }] };
}

export function errorReply(text) {
  return { isError: true, content: [{ type: "text", text }] };
}
