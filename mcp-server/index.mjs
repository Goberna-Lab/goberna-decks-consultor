#!/usr/bin/env node
/**
 * Goberna MCP Server
 *
 * Expone como tools de Claude Code los candidatos del consultor logged-in
 * en electoral.goberna.club. Auth: token JWT en ~/.config/goberna/token.
 *
 * Tools (Fase A — read-only):
 *   list_candidates          → lista candidatos asignados al consultor
 *   get_candidate_context    → contexto completo de un candidato
 *
 * Tools (Fase B — write):
 *   list_decks               → decks existentes de un candidato
 *   upload_deck              → sube un .html como draft (admin lo publica)
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Config ──────────────────────────────────────────────────────────────
const API_URL = process.env.GOBERNA_API_URL ?? "https://electoral.goberna.club";
const TOKEN_PATH =
  process.env.GOBERNA_TOKEN_PATH ?? join(homedir(), ".config", "goberna", "token");

function readToken() {
  if (!existsSync(TOKEN_PATH)) {
    throw new Error(
      `No se encontró tu token en ${TOKEN_PATH}.\n` +
        `Pedile al admin de Goberna que te genere uno y guardalo en ese archivo.`,
    );
  }
  return readFileSync(TOKEN_PATH, "utf8").trim();
}

async function api(path, init = {}) {
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

// ── Tool definitions ────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "list_candidates",
    description:
      "Lista los candidatos asignados al consultor logged-in. Devuelve nombre, cargo, jurisdicción y partido por cada uno. Llamar al inicio de cada conversación para ofrecerle al consultor cuál trabajar.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_candidate_context",
    description:
      "Devuelve el contexto completo de un candidato (cargo, ámbito, jurisdicción anidada, organización política, foto, has_password). Usar después de que el consultor elige uno de la lista para prepoblar el deck con datos reales en lugar de pedirlos manualmente.",
    inputSchema: {
      type: "object",
      properties: {
        candidato_id: {
          type: "integer",
          description: "ID del candidato (entero, viene de list_candidates)",
        },
      },
      required: ["candidato_id"],
    },
  },
  {
    name: "find_similar_analisis",
    description:
      "Busca análisis previos de candidatos similares (mismo cargo + ámbito geográfico, opcionalmente mismo partido). Usar al iniciar un deck nuevo para mostrarle al consultor qué encontraron consultores anteriores en casos parecidos. Devuelve hasta 5 análisis con counts de hallazgos/recomendaciones — el consultor decide cuál abrir si quiere detalle.",
    inputSchema: {
      type: "object",
      properties: {
        cargo: { type: "string", description: "código de cargo, ej: ALC_DIST, GOB_REG, PRES" },
        ambito: { type: "string", enum: ["pais", "departamento", "provincia", "distrito"] },
        partido: { type: "string", description: "código de organización política (opcional)" },
        exclude_candidato: { type: "integer", description: "candidato_id a excluir (típicamente el actual)" },
        limit: { type: "integer", description: "1..20 (default 5)" },
      },
      required: [],
    },
  },
  {
    name: "get_benchmarks",
    description:
      "Devuelve benchmarks numéricos (p10/p50/p90) por cargo + ámbito geográfico. Útil para que el deck mencione 'el percentil 50 de cobertura territorial para alcaldes de provincia es X%'. Si la DB de benchmarks aún no tiene data para tu cargo, devuelve array vacío y reportás 'aún no hay benchmarks históricos para este corte'.",
    inputSchema: {
      type: "object",
      properties: {
        cargo: { type: "string" },
        ambito: { type: "string", enum: ["pais", "departamento", "provincia", "distrito"] },
      },
      required: [],
    },
  },
  {
    name: "list_decks",
    description:
      "Lista los decks ya subidos para un candidato (cualquier status: draft/published/rejected). Útil para mostrarle al consultor su histórico antes de crear uno nuevo, o para evitar duplicados.",
    inputSchema: {
      type: "object",
      properties: {
        candidato_id: {
          type: "integer",
          description: "ID del candidato",
        },
      },
      required: ["candidato_id"],
    },
  },
  {
    name: "upload_deck",
    description:
      "Sube un deck HTML como draft. Después de generar la presentación localmente y mostrarsela al consultor (preview en localhost:3000), llamar este tool con el contenido HTML completo. Queda como status='draft' hasta que admin la revise/publique. Devuelve el id del deck y un preview_url interno.",
    inputSchema: {
      type: "object",
      properties: {
        candidato_id: {
          type: "integer",
          description: "ID del candidato (de list_candidates)",
        },
        title: {
          type: "string",
          description: "Título de la presentación (2–200 chars). Ej: 'Diagnóstico Inicial — Roberto Sánchez'",
        },
        type: {
          type: "string",
          enum: ["diagnostico", "analisis", "plan", "episodico", "otro"],
          description: "Tipo de deck",
        },
        description: {
          type: "string",
          description: "Resumen opcional (≤500 chars) para que admin entienda contexto",
        },
        html: {
          type: "string",
          description: "Contenido HTML completo del deck (self-contained: tailwind por CDN está OK). Máximo 5MB.",
        },
        structured: {
          type: "object",
          description:
            "OPCIONAL pero MUY recomendado: payload estructurado con los hallazgos/riesgos/recomendaciones del deck. Goberna lo guarda en su DB de análisis para alimentar benchmarks y futuros decks. Cero costo extra para el consultor — vos (Claude) lo construís a partir del mismo material que pusiste en el deck.",
          properties: {
            summary: { type: "string", description: "Abstract del deck (≤2000 chars), searchable" },
            fecha_corte: { type: "string", description: "YYYY-MM-DD — a qué fecha refiere el análisis" },
            hallazgos: {
              type: "array",
              description: "FODA + libre. Hechos detectados sobre candidato/territorio.",
              items: {
                type: "object",
                properties: {
                  categoria: { type: "string", enum: ["fortaleza", "debilidad", "oportunidad", "amenaza", "contexto"] },
                  texto: { type: "string" },
                  evidencia: { type: "string" },
                  peso: { type: "number", description: "0..1 importancia subjetiva" },
                  tags: { type: "array", items: { type: "string" } },
                },
                required: ["categoria", "texto"],
              },
            },
            riesgos: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  riesgo: { type: "string" },
                  severidad: { type: "string", enum: ["baja", "media", "alta", "critica"] },
                  probabilidad: { type: "string", enum: ["baja", "media", "alta"] },
                  mitigacion: { type: "string" },
                  responsable: { type: "string" },
                },
                required: ["riesgo", "severidad"],
              },
            },
            oportunidades: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  oportunidad: { type: "string" },
                  ventana_temporal: { type: "string" },
                  recursos_necesarios: { type: "string" },
                  impacto_esperado: { type: "string" },
                },
                required: ["oportunidad"],
              },
            },
            competidores: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  partido_codigo: { type: "string" },
                  partido_nombre: { type: "string" },
                  candidato_rival: { type: "string" },
                  fortaleza_relativa: { type: "integer", description: "1..10" },
                  jurisdiccion_clave: { type: "string" },
                  notas: { type: "string" },
                },
              },
            },
            recomendaciones: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  accion: { type: "string" },
                  area: { type: "string", enum: ["territorio", "digital", "datos", "comunicacion", "organizacion", "financiamiento", "legal", "otro"] },
                  plazo: { type: "string", enum: ["inmediato", "corto", "mediano", "largo"] },
                  recursos_estimados: { type: "string" },
                  kpi_objetivo: { type: "string" },
                  prioridad: { type: "integer", description: "1..5" },
                },
                required: ["accion"],
              },
            },
            kpis: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  nombre: { type: "string" },
                  valor_actual: { type: "number" },
                  valor_objetivo: { type: "number" },
                  unidad: { type: "string" },
                  fecha_objetivo: { type: "string", description: "YYYY-MM-DD" },
                },
                required: ["nombre"],
              },
            },
          },
        },
      },
      required: ["candidato_id", "title", "type", "html"],
    },
  },
];

// ── Server setup ────────────────────────────────────────────────────────

const server = new Server(
  {
    name: "goberna-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "list_candidates": {
        const data = await api("/api/consultor/candidates");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: data.ok,
                  count: data.candidates?.length ?? 0,
                  admin_all: data.admin_all ?? false,
                  candidates: data.candidates ?? [],
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "get_candidate_context": {
        const id = args.candidato_id;
        if (typeof id !== "number" || !Number.isInteger(id)) {
          throw new Error("candidato_id debe ser un entero");
        }
        const data = await api(`/api/consultor/candidates/${id}/context`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "find_similar_analisis": {
        const params = new URLSearchParams();
        if (args.cargo) params.set("cargo", String(args.cargo));
        if (args.ambito) params.set("ambito", String(args.ambito));
        if (args.partido) params.set("partido", String(args.partido));
        if (args.exclude_candidato) params.set("exclude_candidato", String(args.exclude_candidato));
        if (args.limit) params.set("limit", String(args.limit));
        const data = await api(`/api/consultor/analisis/similar?${params.toString()}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: data.ok,
                  count: data.items?.length ?? 0,
                  items: data.items ?? [],
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "get_benchmarks": {
        const params = new URLSearchParams();
        if (args.cargo) params.set("cargo", String(args.cargo));
        if (args.ambito) params.set("ambito", String(args.ambito));
        const data = await api(`/api/consultor/benchmarks?${params.toString()}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: data.ok,
                  count: data.items?.length ?? 0,
                  items: data.items ?? [],
                  note:
                    (data.items?.length ?? 0) === 0
                      ? "Aún no hay benchmarks históricos para este corte. La DB se irá llenando con cada deck que el consultor suba con structured payload."
                      : null,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "list_decks": {
        const id = args.candidato_id;
        if (typeof id !== "number" || !Number.isInteger(id)) {
          throw new Error("candidato_id debe ser un entero");
        }
        const data = await api(`/api/consultor/decks?candidato_id=${id}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: data.ok,
                  count: data.decks?.length ?? 0,
                  decks: (data.decks ?? []).map((d) => ({
                    id: d.id,
                    title: d.title,
                    type: d.type,
                    status: d.status,
                    created_at: d.created_at,
                    rejection_reason: d.rejection_reason,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "upload_deck": {
        const { candidato_id, title, type, description, html, structured } = args;
        if (typeof candidato_id !== "number" || !Number.isInteger(candidato_id)) {
          throw new Error("candidato_id debe ser entero");
        }
        if (typeof title !== "string" || title.trim().length < 2) {
          throw new Error("title requerido (mín 2 chars)");
        }
        const VALID_TYPES = ["diagnostico", "analisis", "plan", "episodico", "otro"];
        if (!VALID_TYPES.includes(type)) {
          throw new Error(`type debe ser uno de: ${VALID_TYPES.join(", ")}`);
        }
        if (typeof html !== "string" || html.length < 50) {
          throw new Error("html vacío o demasiado corto");
        }
        const payload = {
          candidato_id,
          title: title.trim(),
          type,
          description: description ? String(description).trim() : undefined,
          html,
        };
        if (structured && typeof structured === "object") {
          payload.structured = structured;
        }
        const data = await api("/api/consultor/decks", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        const counts = structured
          ? {
              hallazgos: structured.hallazgos?.length ?? 0,
              riesgos: structured.riesgos?.length ?? 0,
              oportunidades: structured.oportunidades?.length ?? 0,
              competidores: structured.competidores?.length ?? 0,
              recomendaciones: structured.recomendaciones?.length ?? 0,
              kpis: structured.kpis?.length ?? 0,
            }
          : null;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: data.ok,
                  deck_id: data.deck?.id,
                  analisis_id: data.deck?.analisis_id ?? null,
                  status: data.deck?.status,
                  replaced: data.replaced ?? false,
                  structured_saved: counts,
                  message:
                    "Deck subido como draft. Admin lo revisará antes de publicarlo." +
                    (counts
                      ? ` ${Object.values(counts).reduce((a, b) => a + b, 0)} items estructurados guardados en la DB de análisis.`
                      : " (Sin payload estructurado — considerá pasarlo en el próximo upload)") +
                    ` Preview URL (requiere auth): ${data.deck?.preview_url}`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      default:
        throw new Error(`Tool desconocida: ${name}`);
    }
  } catch (e) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error: ${e.message}`,
        },
      ],
    };
  }
});

// ── Boot ────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`[goberna-mcp] running · API=${API_URL} · token=${TOKEN_PATH}\n`);
