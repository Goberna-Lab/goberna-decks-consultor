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
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
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
    name: "publish_deck",
    description:
      "Autopublica un deck que está en status 'draft'. Pasa a 'published' y queda visible en https://electoral.goberna.club/candidatos/<slug>/digital/decks. Solo funciona si tu cuenta tiene consultor_global_access (los consultores Goberna principales). Sin global access devuelve 403 — en ese caso el deck queda en draft hasta que admin lo publique manualmente. Llamalo apenas el consultor diga 'subilo y publicalo' / 'publicalo ya' / similar.",
    inputSchema: {
      type: "object",
      properties: {
        deck_id: {
          type: "string",
          description: "UUID del deck a publicar (lo devolvió upload_deck).",
        },
      },
      required: ["deck_id"],
    },
  },
  {
    name: "fetch_deck_html",
    description:
      "Descarga el HTML completo de un deck existente. Devuelve metadata (title, type, status) + el HTML como string. Usalo cuando el consultor elige un candidato que ya tiene un deck previo, para iterar sobre el existente en lugar de empezar de cero. Importante: usalo INMEDIATAMENTE después de list_decks si encontrás un deck del tipo que querés trabajar.",
    inputSchema: {
      type: "object",
      properties: {
        deck_id: {
          type: "string",
          description: "UUID del deck (de list_decks).",
        },
      },
      required: ["deck_id"],
    },
  },
  {
    name: "sync_candidate_workspace",
    description:
      "Atajo que combina list_decks + fetch_deck_html + recomendación de filename local. Llamalo apenas el consultor elige el candidato — devuelve un payload listo para que sepas: (a) si hay decks previos, (b) cuál es el más reciente para iterar, (c) qué filename usar al guardar localmente con la herramienta filesystem (`<candidato>-<type>.html` en /Users/.../Goberna/decks/output/). Después usás el filesystem MCP para escribir el archivo y mostrás el HTML al consultor diciendo \"acá está tu último deck, ¿iteramos sobre éste o empezamos de cero?\".",
    inputSchema: {
      type: "object",
      properties: {
        candidato_id: {
          type: "integer",
          description: "ID del candidato",
        },
        prefer_type: {
          type: "string",
          enum: ["diagnostico", "analisis", "plan", "episodico", "otro"],
          description: "Tipo preferido (default: el más reciente sin importar el tipo)",
        },
      },
      required: ["candidato_id"],
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
    version: "0.3.0",
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  },
);

// ── Prompts (slash commands en Claude Desktop) ─────────────────────────

const ARRANCAR_DECK_INSTRUCTIONS = `Sos el asistente de un consultor político de Goberna. Tu tarea es **convertir material político en presentaciones HTML cinemáticas** y subirlas al portal Goberna como draft para que admin las publique al candidato.

## Tu workflow OBLIGATORIO

### Paso 0 — Contexto + bootstrap del workspace (CHAIN, sin preguntas intermedias)

Cuando el consultor diga "trabajemos a Leonardo Jurado" o similar:

1. Llamá \`list_candidates\`. Si hay ambigüedad de nombre, presentale las opciones con AskUserQuestion. Si es claro, seguí directo.

2. APENAS tengas el \`candidato_id\` elegido, hacé estas 4 llamadas EN PARALELO (todas en una sola respuesta tuya, sin pedir confirmación al medio):
   - \`sync_candidate_workspace({candidato_id, prefer_type: "diagnostico"})\` — devuelve HTML listo (existente o STARTER prefilled) + filename + bash_commands_to_run.
   - \`find_similar_analisis({cargo: <cargo_codigo>, ambito: <ambito>, exclude_candidato: candidato_id, limit: 3})\` — análisis previos para context.
   - \`get_benchmarks({cargo: <cargo_codigo>, ambito: <ambito>})\` — percentiles si los hay.
   - \`get_candidate_context\` (opcional, sync_candidate_workspace ya lo llama por dentro).

3. CON los resultados de sync_candidate_workspace:
   - **Escribí el HTML** al archivo \`output/<local_filename>\` usando la herramienta filesystem MCP \`write_file\`.
   - **Ejecutá** el campo \`bash_commands_to_run\` con la herramienta Bash (arranca preview server y abre browser). NO preguntes — hacelo directo.

4. Recién entonces avisale al consultor en una sola línea:
   > Listo. Abrí \`<preview_url>\` — está prepoblado con [partido + jurisdicción + cargo del candidato]. \`<N>\` análisis previos similares en mi context (X, Y, Z). ¿Iteramos sobre el deck actual o querés que arranque preguntas para profundizar?

NO pongas friction extra. NO preguntes "¿qué tipo de deck?" si el consultor ya dijo "diagnóstico" o "armemos un deck". Default a \`diagnostico\` si no especifica.

### Paso 1 — Tipo de deck
Preguntá: ¿Diagnóstico Inicial, Análisis Episódico, Plan Operativo, u Otro?

### Paso 2 — Preguntas
Hacé las preguntas necesarias **una a una** (no soltarle 20 juntas). Si te pega un PPT viejo / notas / pantallazo, extraé lo que puedas y solo pedí lo que falte.

Para diagnóstico, preguntás aprox: contexto político local, biografía/origen del candidato, fortalezas y debilidades percibidas, tres riesgos principales, ideas-fuerza del programa, recomendaciones priorizadas.

### Paso 3 — Outline
Antes de generar HTML, mostrá la estructura propuesta y pedí confirmación.

### Paso 4 — Genera el deck como artifact HTML
Reglas inviolables (paleta y tipografía Goberna):
- **Tipografía**: Montserrat 400/500/600/700/800/900 desde Google Fonts.
- **Paleta exclusiva**:
  - Navy \`#0a1f4a\` / navy deep \`#061633\` / navy mid \`#1a2c5e\`
  - Gold \`#fbbf24\` / gold deep \`#f59e0b\`
  - Rojo accent \`#dc2626\` (riesgos)
  - Blanco / grises neutros
  - **Nunca** colores fuera de esta paleta.
- Cada slide entra en pantalla 16:9 — no scroll vertical infinito.
- Patrón estándar: header navy con white uppercase + 6px gold underline, body blanco con cards, footer gold bar fina.
- Section dividers: pantalla completa navy con cielo, pregunta gigante uppercase con highlight gold.

Tailwind via CDN está OK. Generá HTML standalone (sin frameworks). Mostralo como artifact en el chat.

### Paso 5 — Iteración
El consultor puede pedirte cambios ("cambiá el dato del slide 4", "agregá una sección de riesgos"). Editás el artifact en el mismo turno.

### Paso 6 — Subir y (opcionalmente) publicar
Cuando el consultor diga "subilo" / "publicalo" / "listo":
1. Antes, llamá \`list_decks\` con el candidato_id. Si hay un \`rejected\` previo del mismo type, mostrale el \`rejection_reason\` y preguntale si lo abordó.
2. Llamá \`upload_deck\` con:
   - \`candidato_id\`, \`title\`, \`type\`, \`description?\`, \`html\` (todo el contenido del artifact), y SIEMPRE
   - \`structured\`: la versión estructurada de lo que pusiste en el deck. Tiene 7 campos opcionales — completalos con lo que ya tenés en tu contexto:
     - \`summary\`, \`fecha_corte\` (YYYY-MM-DD)
     - \`hallazgos[]\` con \`{categoria: 'fortaleza|debilidad|oportunidad|amenaza|contexto', texto, evidencia?, peso 0..1?, tags[]?}\` (apuntá a 8-15)
     - \`riesgos[]\` con \`{riesgo, severidad: 'baja|media|alta|critica', probabilidad?, mitigacion?, responsable?}\`
     - \`oportunidades[]\` con \`{oportunidad, ventana_temporal?, recursos_necesarios?, impacto_esperado?}\`
     - \`competidores[]\` con \`{partido_codigo?, partido_nombre?, candidato_rival?, fortaleza_relativa 1..10?, jurisdiccion_clave?, notas?}\`
     - \`recomendaciones[]\` con \`{accion, area: 'territorio|digital|datos|comunicacion|...', plazo: 'inmediato|corto|mediano|largo'?, recursos_estimados?, kpi_objetivo?, prioridad 1..5?}\`
     - \`kpis[]\` con \`{nombre, valor_actual?, valor_objetivo?, unidad?, fecha_objetivo?}\`
3. El backend reemplaza automáticamente cualquier draft previo del mismo \`(candidato, consultor, type)\` — no acumula 5 borradores.

4. **CHAIN automático con publish_deck**: si el consultor dijo "publicalo" / "subilo y publicalo" / "subilo ya" / "listo, publicar" — APENAS termina upload_deck con éxito y tenés \`deck_id\`, llamá inmediatamente \`publish_deck({deck_id})\` en la misma respuesta. NO le preguntes si quiere publicar — ya te lo dijo.
   - Si publish_deck devuelve 403 (sin global access), avisale: "Subido como draft, te falta permiso de autopublicar — admin lo publica desde /decks."
   - Si publish_deck OK, decile en una sola línea: "✅ Publicado. Ya está en https://electoral.goberna.club/candidatos/<slug>/digital/decks" (reemplazando <slug> por el campaign_slug del candidato).

5. Si el consultor dijo SOLO "subilo" (sin mencionar publicar), dejalo en draft y decile: "Deck subido como draft. Decime 'publicalo' cuando estés listo."

## Tono
- Español rioplatense informal-profesional ("vos", "tenés", "armemos")
- Frases cortas, punchlines
- No alucinés números — si falta data, marcá "[A completar]"

Listo. Llamá \`list_candidates\` ahora.`;

const PROMPTS = [
  {
    name: "arrancar-deck",
    description: "Inicia el flow Goberna: lista tus candidatos, elegí uno, armamos el deck con el formato y lo subimos al portal.",
    arguments: [],
  },
];

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: PROMPTS,
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== "arrancar-deck") {
    throw new Error(`Prompt desconocido: ${request.params.name}`);
  }
  return {
    description: "Workflow Goberna para armar y subir un deck",
    messages: [
      {
        role: "user",
        content: { type: "text", text: ARRANCAR_DECK_INSTRUCTIONS },
      },
    ],
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "list_candidates": {
        const data = await api("/api/consultor/candidates");
        // Slim: omitir foto_url (puede ser base64 grande) + ids redundantes.
        // Solo lo necesario para mostrar la lista al consultor.
        const slim = (data.candidates ?? []).map((c) => ({
          candidato_id: c.candidato_id,
          campaign_slug: c.campaign_slug,
          campaign_id: c.campaign_id,
          candidato_nombres: c.candidato_nombres,
          cargo_codigo: c.cargo_codigo,
          cargo_nombre: c.cargo_nombre,
          cargo_ambito: c.cargo_ambito,
          jurisdiccion_label: c.jurisdiccion_label,
          organizacion_codigo: c.organizacion_codigo,
          organizacion_siglas: c.organizacion_siglas,
        }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: data.ok,
                  count: slim.length,
                  admin_all: data.admin_all ?? false,
                  candidates: slim,
                },
                null,
                0,
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

      case "publish_deck": {
        const id = args.deck_id;
        if (typeof id !== "string" || id.length < 5) {
          throw new Error("deck_id debe ser un UUID");
        }
        try {
          const data = await api(`/api/consultor/decks/${encodeURIComponent(id)}/publish`, {
            method: "POST",
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ok: data.ok,
                    deck_id: data.deck?.id,
                    status: data.deck?.status,
                    published_at: data.deck?.published_at,
                    public_url: `https://electoral.goberna.club/candidatos/<slug>/digital/decks`,
                    message:
                      "✅ Deck publicado. Ya está visible en el portal del candidato.",
                  },
                  null,
                  0,
                ),
              },
            ],
          };
        } catch (e) {
          // Mensaje específico si es 403 SELF_PUBLISH_NOT_ALLOWED
          if (String(e.message).includes("SELF_PUBLISH_NOT_ALLOWED") || String(e.message).includes("403")) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "No tenés permiso para autopublicar (te falta consultor_global_access). El deck quedó en draft — pedile a admin que lo publique en https://electoral.goberna.club/decks.",
                },
              ],
            };
          }
          throw e;
        }
      }

      case "fetch_deck_html": {
        const id = args.deck_id;
        if (typeof id !== "string" || id.length < 5) {
          throw new Error("deck_id debe ser un UUID");
        }
        const data = await api(`/api/consultor/decks/${encodeURIComponent(id)}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: data.ok,
                  deck: data.deck ?? null,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "sync_candidate_workspace": {
        const cid = args.candidato_id;
        if (typeof cid !== "number" || !Number.isInteger(cid)) {
          throw new Error("candidato_id debe ser entero");
        }
        const preferType = args.prefer_type ?? "diagnostico";

        // 1. Traer contexto (cargo, jurisdicción, partido) para placeholders
        let ctx = null;
        try {
          ctx = await api(`/api/consultor/candidates/${cid}/context`);
        } catch (e) {
          // Si falla, seguimos sin contexto — usamos slug genérico
        }

        // 2. Listar decks existentes
        const list = await api(`/api/consultor/decks?candidato_id=${cid}`);
        const decks = list.decks ?? [];
        const chosen =
          decks.find((d) => d.type === preferType) ?? decks[0] ?? null;

        // 3. Slug del archivo local
        const baseSlug = ctx?.campaign?.slug
          ?? (chosen?.candidato_nombres ?? "candidato")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
        const localFilename = `${baseSlug}-${preferType}.html`;

        // 4a. Si hay deck previo: bajar HTML del server.
        let html = null;
        let source = null;
        if (chosen) {
          const data = await api(`/api/consultor/decks/${encodeURIComponent(chosen.id)}`);
          html = data.deck?.html ?? null;
          source = "existing_deck";
        }

        // 4b. Si no hay deck: leer STARTER.html local y sustituir placeholders
        if (!html) {
          try {
            const { fileURLToPath } = await import("node:url");
            const { dirname, resolve: pathResolve } = await import("node:path");
            const here = dirname(fileURLToPath(import.meta.url));
            const starterPath = pathResolve(here, "..", "STARTER.html");
            if (existsSync(starterPath)) {
              let starter = readFileSync(starterPath, "utf8");
              const fullName = ctx?.user?.full_name ?? "Candidato";
              const nameUpper = fullName.toUpperCase();
              const parts = nameUpper.split(/\s+/);
              const nameSplit = parts.length >= 2
                ? `${parts[0]}<br/>${parts.slice(1).join(" ")}`
                : nameUpper;
              const jurisdiccionLabel =
                ctx?.jurisdiccion?.distrito?.nombre ??
                ctx?.jurisdiccion?.provincia?.nombre ??
                ctx?.jurisdiccion?.departamento?.nombre ??
                ctx?.jurisdiccion?.pais?.nombre ??
                "—";
              const partido = ctx?.organizacion_politica?.nombre ?? "[partido]";
              const tipoLabel = preferType.charAt(0).toUpperCase() + preferType.slice(1);
              // Cargo → nivel de elección guess (Generales/Regionales/Municipales)
              const ambito = ctx?.cargo?.ambito;
              const eleccion =
                ambito === "pais" ? "GENERALES 2026"
                : ambito === "departamento" ? "REGIONALES 2026"
                : "MUNICIPALES 2026";

              const subs = [
                ["[CANDIDATO] · [TIPO DE DECK]", `${fullName} · ${tipoLabel}`],
                ["[NOMBRE<br/>CANDIDATO]", nameSplit],
                ["[GENERALES / REGIONALES / MUNICIPALES]", eleccion],
                ["[Partido]", partido],
                ["[Jurisdicción]", jurisdiccionLabel],
                ["[Candidato] [Tipo]", `${fullName} · ${tipoLabel}`],
              ];
              for (const [needle, replacement] of subs) {
                starter = starter.split(needle).join(replacement);
              }
              html = starter;
              source = "starter_template";
            }
          } catch (e) {
            // No fallar si no podemos leer STARTER — caller puede seguir sin HTML
          }
        }

        // 5. Devolver TODO listo: html + filename + comandos shell que Claude
        //    debería ejecutar para iniciar preview + abrir browser.
        const previewUrl = `http://localhost:3000/output/${localFilename}`;
        const platform = process.platform;
        const openCmd =
          platform === "darwin" ? `open "${previewUrl}"`
          : platform === "win32" ? `start "" "${previewUrl}"`
          : `(xdg-open "${previewUrl}" || sensible-browser "${previewUrl}" || brave-browser "${previewUrl}") >/dev/null 2>&1`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  has_existing_deck: !!chosen,
                  source,
                  local_filename: localFilename,
                  preview_url: previewUrl,
                  total_decks: decks.length,
                  decks_summary: decks.map((d) => ({
                    id: d.id,
                    type: d.type,
                    status: d.status,
                    title: d.title,
                    created_at: d.created_at,
                    rejection_reason: d.rejection_reason,
                  })),
                  chosen_for_workspace: chosen
                    ? {
                        deck_id: chosen.id,
                        type: chosen.type,
                        status: chosen.status,
                        title: chosen.title,
                      }
                    : null,
                  html,
                  bash_commands_to_run: [
                    `# 1. Asegurar que el preview-server está corriendo (idempotente)`,
                    `pgrep -f "preview-server.js" >/dev/null 2>&1 || (cd ~/Goberna/decks && nohup npm start >/tmp/goberna-preview.log 2>&1 &) && sleep 1`,
                    `# 2. Abrir el deck en el browser`,
                    openCmd,
                  ].join("\n"),
                  next_steps: html
                    ? `1) Escribí 'html' al archivo 'output/${localFilename}' usando filesystem MCP write_file.\n2) Ejecutá el bloque 'bash_commands_to_run' con la herramienta Bash.\n3) Decile al consultor: "Listo, abrí ${previewUrl} en tu browser. El deck está prepoblado con ${chosen ? `tu último ${chosen.type}` : `los datos del candidato (cargo, jurisdicción, partido)`}. Ya podés iterar — cada cambio que hagas se autorefresca."`
                    : "No pude leer STARTER.html ni hay deck previo. Pedile al consultor que verifique que ~/Goberna/decks/STARTER.html existe.",
                },
                null,
                0,
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
