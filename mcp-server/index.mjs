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
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ── Config ──────────────────────────────────────────────────────────────
const API_URL = process.env.GOBERNA_API_URL ?? "https://electoral.goberna.club";
const TOKEN_PATH =
  process.env.GOBERNA_TOKEN_PATH ?? join(homedir(), ".config", "goberna", "token");

function readToken() {
  if (!existsSync(TOKEN_PATH)) {
    throw new Error(
      `NO_TOKEN: No estás logged in. Llamá la tool 'login' con tu email y password del portal Goberna (electoral.goberna.club) — la misma cuenta del consultor.`,
    );
  }
  return readFileSync(TOKEN_PATH, "utf8").trim();
}

function writeToken(token) {
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

function deleteToken() {
  if (existsSync(TOKEN_PATH)) {
    unlinkSync(TOKEN_PATH);
  }
}

/**
 * Versión sin token de api() — usada por login() porque todavía no hay token.
 */
async function apiNoAuth(path, init = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
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
    const code = typeof body === "object" && body?.code ? body.code : `HTTP_${res.status}`;
    const msg = typeof body === "object" && body?.message ? body.message : `HTTP ${res.status}`;
    const err = new Error(`Goberna API ${path} → ${msg}`);
    err.code = code;
    throw err;
  }
  return res.json();
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
  // ── Auth ──
  {
    name: "login",
    description:
      "Inicia sesión en Goberna con email + password (la misma cuenta del portal electoral.goberna.club). Guarda el JWT localmente para las siguientes llamadas. **LLAMAR AUTOMÁTICAMENTE cuando otra tool devuelva error NO_TOKEN, o cuando el consultor diga 'login' / 'iniciar sesión' / 'mi cuenta es ...'.** Si tu prompt actual no tiene credenciales, preguntale al consultor por su email y password antes de llamar — son los del portal Goberna.",
    inputSchema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "Email del consultor (o número de teléfono si así se registró). Lo que usa en electoral.goberna.club.",
        },
        password: {
          type: "string",
          description: "Password del portal Goberna.",
        },
      },
      required: ["email", "password"],
    },
  },
  {
    name: "logout",
    description:
      "Borra el token local. La próxima llamada va a pedir login. Usar si el consultor dice 'cerrar sesión' / 'logout' / 'cambiar de cuenta'.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "whoami",
    description:
      "Devuelve quién está logged-in actualmente (full_name, email, role, campaign asignada si existe). Llamar al inicio de cada conversación nueva para confirmar identidad antes de empezar a operar. Si no hay token, devuelve un mensaje sugiriendo `login`.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },

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
    name: "bootstrap_deck",
    description:
      "Crea o regenera el deck Goberna estándar (template Fase 2 con 6 slides) desde el onboarding del candidato + form opcional del consultor. Idempotente: si ya hay un draft del mismo (candidato, consultor, type), lo actualiza; si no, crea uno nuevo. Reemplaza al uso de STARTER.html local — el HTML lo arma el server con los datos reales del candidato. El form es opcional y se merge profundo (cualquier subset de los 5 secciones). Devuelve deck_id + html para que escribas en disco con filesystem MCP. SIEMPRE usá esto en lugar de generar HTML a mano. Si el consultor no pasó form aún, mandá form vacío y se crea el deck con placeholders [A completar] que el consultor puede llenar después con `update_deck_form`.",
    inputSchema: {
      type: "object",
      properties: {
        candidato_id: { type: "integer", description: "ID del candidato (requerido — FK enforced en backend)." },
        type: {
          type: "string",
          enum: ["diagnostico", "analisis", "plan", "episodico", "otro"],
          description: "Tipo de deck (default: diagnostico).",
        },
        form: {
          type: "object",
          description: "Form opcional del consultor con 5 secciones. Cualquier subset es válido — el backend hace merge.",
          properties: {
            intro: {
              type: "object",
              properties: {
                biografia_corta: { type: "string" },
                tagline: { type: "string" },
              },
            },
            partido_eg: {
              type: "object",
              description: "Cómo le fue al partido en EG 2026 en la zona.",
              properties: {
                como_le_fue_resumen: { type: "string" },
                costo_beneficio_acercamiento: { type: "string" },
                porcentaje_partido_zona: { type: "number" },
              },
            },
            historico_local: {
              type: "array",
              description: "Resultados del partido en últimas 3 elecciones locales (2022/2018/2014).",
              items: {
                type: "object",
                properties: {
                  anio: { type: "integer" },
                  candidato_partido: { type: "string" },
                  votos: { type: "integer" },
                  porcentaje: { type: "number" },
                  posicion: { type: "integer" },
                  observaciones: { type: "string" },
                },
                required: ["anio"],
              },
            },
            candidato_historial: {
              type: "object",
              description: "Lo que sale al googlear al candidato.",
              properties: {
                cargos_anteriores: { type: "array", items: { type: "string" } },
                pagina_web: { type: "string" },
                redes_sociales: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      plataforma: { type: "string" },
                      url: { type: "string" },
                    },
                    required: ["plataforma", "url"],
                  },
                },
                denuncias: { type: "array", items: { type: "string" } },
                info_relevante: { type: "string" },
                posicionamiento_google: { type: "string" },
              },
            },
            quien_es: {
              type: "object",
              description: "El elevator pitch del candidato — quién es, por qué postula.",
              properties: {
                texto_libre: { type: "string" },
                edad: { type: "integer" },
                profesion: { type: "string" },
                trayectoria: { type: "string" },
              },
            },
          },
        },
      },
      required: ["candidato_id"],
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

  // ── Fase 2 flow nuevo: editar consultor_form del candidato ────────────────

  {
    name: "open_fase2",
    description:
      "Abre el Fase 2 deck del candidato por slug de campaña. Devuelve snapshot del onboarding (candidato, cargo, jurisdicción, partido) + consultor_form actual (lo que ya está editado) + status del deck (draft/pending_review/published/rejected) + URL del admin review. Es el equivalente al 'arrancar-deck' del flujo Fase 2 — devuelve TODO el estado en una sola call. Usalo inmediatamente cuando el consultor diga 'abrí Fase 2 de [nombre]' o 'trabajemos Fase 2 de [slug]'.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description:
            "Slug de la campaña del candidato (ej: 'leonardo-jurado'). Si tenés solo el nombre, llamá primero list_candidates para mapear.",
        },
      },
      required: ["slug"],
    },
  },

  {
    name: "set_fase2_field",
    description:
      "Actualiza un campo (o varios) del consultor_form del Fase 2 deck. Hace deep-merge nivel-1: cualquier sección que vienen reemplaza la existente; lo que no mandás queda igual. Las secciones del form son:\n\n• ficha_basica: { dni?, edad?, profesion? }\n• rol_usuario: { filler_role?: 'consultor'|'cartografo'|'candidato'|'admin' }\n• analisis_electoral: { comentario_consultor?, ranking_partido_zona? }\n• votos_para_ganar: { votos_ganador_anterior?, padron_actual?, votos_meta?, fuente? }\n• partidos: { observaciones?, top_partidos?[] }\n• historial: { entries?[], nunca_postulo?, observaciones? }\n• formula_electoral: { presupuesto_total?, peso_aire?, peso_mar?, peso_tierra?, justificacion? }\n• recorrido_estrategico: { hitos?[] }\n• presencia_digital: { web_oficial?, google_results?, redes_verificadas?, info_clave?: 'ok'|'review'|'flag', notas? }\n• redes_sociales: { candidato?: {facebook?, instagram?, tiktok?, twitter?, youtube?, web_oficial?}, adversarios?[] }\n• debilidades: { fuentes?[{key:'denuncias'|'google'|'reputacion_redes'|'jne_observaciones', estado:'ok'|'review'|'flag', hallazgos?[]}], lista_libre?[] }\n• quien_es: { texto_libre?, trayectoria?, valores?[] }\n\nDespués de cada cambio importante, decile al consultor: 'Listo, actualizado en producción. Refrescá la pestaña del browser para ver.'",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Slug de la campaña del candidato",
        },
        patch: {
          type: "object",
          description:
            "Subset del consultor_form (cualquier combinación de secciones). El backend hace deep-merge.",
        },
      },
      required: ["slug", "patch"],
    },
  },

  // ── Tools por SECCIÓN — alternativa más guiada que set_fase2_field ────────
  // Cada una mapea 1:1 a una sección del consultor_form. Args tipados.
  // Si pasás un campo vacío (string vacía) lo borrás del form.

  {
    name: "set_ficha_basica",
    description:
      "Actualiza el slide Ficha Básica (Lámina 1) del Fase 2 deck. Args:\n• dni: string DNI peruano (8 dígitos)\n• edad: int 18..120\n• profesion: string\nCualquier campo omitido se ignora; campo en string vacía lo borra.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        dni: { type: "string" },
        edad: { type: "integer", minimum: 18, maximum: 120 },
        profesion: { type: "string" },
      },
      required: ["slug"],
    },
  },
  {
    name: "set_quien_es",
    description:
      "Actualiza el slide Quién es (Sección 9). Args:\n• texto_libre: bio del candidato (1-3 frases, idealmente <300 chars)\n• trayectoria: trayectoria profesional/política (1-2 frases)\n• valores: array de tags (3-5 valores como 'Honestidad', 'Estado de derecho')",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        texto_libre: { type: "string" },
        trayectoria: { type: "string" },
        valores: { type: "array", items: { type: "string" }, maxItems: 6 },
      },
      required: ["slug"],
    },
  },
  {
    name: "set_votos_para_ganar",
    description:
      "Actualiza el slide Votos para Ganar (Sección 3). Args:\n• votos_ganador_anterior: int (votos absolutos del ganador en la última elección de ese cargo)\n• padron_actual: int (electores hábiles según RENIEC)\n• votos_meta: int (objetivo del candidato — Goberna calcula con +5% margen sobre ganador anterior)\n• fuente: string (ej: 'ONPE 2021 · RENIEC 2026')",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        votos_ganador_anterior: { type: "integer", minimum: 0 },
        padron_actual: { type: "integer", minimum: 0 },
        votos_meta: { type: "integer", minimum: 0 },
        fuente: { type: "string" },
      },
      required: ["slug"],
    },
  },
  {
    name: "set_formula_electoral",
    description:
      "Actualiza el slide Fórmula Electoral (aire/mar/tierra). Args:\n• presupuesto_total: number (en soles PEN)\n• peso_aire/mar/tierra: porcentaje 0-100. La suma idealmente da 100\n• justificacion: por qué esa mezcla (1-3 frases)\n\nGuías:\n• Aire (TV/radio): caro pero alcance masivo. >30% solo en presidenciales o departamentales\n• Mar (digital/redes): siempre relevante, mínimo 25%\n• Tierra (territorio/brigadas): 30-50% en municipales, menos en presidencial",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        presupuesto_total: { type: "number", minimum: 0 },
        peso_aire: { type: "number", minimum: 0, maximum: 100 },
        peso_mar: { type: "number", minimum: 0, maximum: 100 },
        peso_tierra: { type: "number", minimum: 0, maximum: 100 },
        justificacion: { type: "string" },
      },
      required: ["slug"],
    },
  },
  {
    name: "set_redes_sociales",
    description:
      "Actualiza el slide Redes Sociales (Sección 7). Args:\n• candidato: handles propios — facebook, instagram, tiktok, twitter, youtube, web_oficial (URLs completas https://…)\n• adversarios: array de hasta 3 — {nombre, partido?, redes: {facebook?, instagram?, tiktok?, ...}}\n\nEjemplo: { slug:'leonardo', candidato:{facebook:'https://facebook.com/leo', instagram:'https://instagram.com/leo'}, adversarios:[{nombre:'Rival X', partido:'XYZ', redes:{tiktok:'https://tiktok.com/@rivalx'}}] }",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        candidato: {
          type: "object",
          properties: {
            facebook: { type: "string" },
            instagram: { type: "string" },
            tiktok: { type: "string" },
            twitter: { type: "string" },
            youtube: { type: "string" },
            web_oficial: { type: "string" },
          },
        },
        adversarios: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              nombre: { type: "string" },
              partido: { type: "string" },
              redes: {
                type: "object",
                properties: {
                  facebook: { type: "string" },
                  instagram: { type: "string" },
                  tiktok: { type: "string" },
                  twitter: { type: "string" },
                  youtube: { type: "string" },
                  web_oficial: { type: "string" },
                },
              },
              notas: { type: "string" },
            },
            required: ["nombre"],
          },
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "set_debilidades",
    description:
      "Actualiza el slide Debilidades / Auditoría de riesgos. Args:\n• fuentes: array — auditoría de las 4 fuentes estándar. Cada una: {key, estado, hallazgos?}\n  - key: 'denuncias' | 'google' | 'reputacion_redes' | 'jne_observaciones'\n  - estado: 'ok' | 'review' | 'flag' (ok=limpio, review=por auditar, flag=alto riesgo)\n  - hallazgos: array de strings con findings específicos\n• lista_libre: array de debilidades adicionales — {titulo, descripcion?, severidad: 'baja'|'media'|'alta'}",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        fuentes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: {
                type: "string",
                enum: ["denuncias", "google", "reputacion_redes", "jne_observaciones"],
              },
              estado: { type: "string", enum: ["ok", "review", "flag"] },
              hallazgos: { type: "array", items: { type: "string" } },
            },
            required: ["key", "estado"],
          },
        },
        lista_libre: {
          type: "array",
          items: {
            type: "object",
            properties: {
              titulo: { type: "string" },
              descripcion: { type: "string" },
              severidad: { type: "string", enum: ["baja", "media", "alta"] },
            },
            required: ["titulo", "severidad"],
          },
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "set_analisis_electoral",
    description:
      "Actualiza el slide Análisis Electoral (Sección 3). Args:\n• comentario_consultor: lectura de los resultados últimos (1-3 frases)\n• ranking_partido_zona: int — posición del partido en la zona (1=primero)",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        comentario_consultor: { type: "string" },
        ranking_partido_zona: { type: "integer", minimum: 1 },
      },
      required: ["slug"],
    },
  },

  {
    name: "record_note",
    description:
      "Agrega una nota libre a la bitácora del Fase 2 deck del candidato. La bitácora persiste entre sesiones — Claude la lee al abrir Fase 2 la próxima vez para tener contexto. Llamar cuando el consultor:\n• Comparte una observación que querés guardar: 'el rival X está bajando, tomá nota'\n• Decide algo no-trivial: 'definimos por ahora un budget de 80K'\n• Te pide al final de una sesión que dejes un resumen para el próximo agente\n\nLas notas son auditables (quedan con timestamp + autor) y permiten que el análisis del consultor se vaya enriqueciendo cada sesión. SIN esto, cada conversación arranca de cero.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Slug de la campaña" },
        nota: {
          type: "string",
          description: "Texto libre (2–2000 chars). Sé conciso pero específico — debe ser útil para el próximo agente.",
        },
      },
      required: ["slug", "nota"],
    },
  },

  {
    name: "submit_fase2_for_review",
    description:
      "Marca el Fase 2 deck del candidato como pending_review. Devuelve la URL admin (https://electoral.goberna.club/admin/fase2/<slug>) que el consultor copia/pega a proyecto@grupogoberna para que apruebe. Llamalo cuando el consultor diga 'manda a aprobación' / 'listo, a aprobar' / 'pasalo al admin' / similar. NO publica directamente — el admin tiene que abrir la URL y clickear Aprobar.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Slug de la campaña",
        },
      },
      required: ["slug"],
    },
  },
];

// ── Server setup ────────────────────────────────────────────────────────

const server = new Server(
  {
    name: "goberna-mcp",
    version: "0.7.0",
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

const EDITAR_FASE2_INSTRUCTIONS = `Sos el asistente de un consultor político de Goberna trabajando sobre el **Fase 2 deck** de un candidato. Tu rol es **enriquecer progresivamente el consultor_form** (el JSON editable del deck) y submitirlo a aprobación cuando el consultor lo decida.

## Reglas básicas
- Fase 1 = onboarding del consultor (ya hecho, no se toca). Fase 2 = deliverable del cliente.
- El deck Fase 2 vive en \`https://electoral.goberna.club/admin/fase2/<slug>\` (admin / consultor con global_access lo abren ahí).
- Tu trabajo: leer el form, preguntar por las secciones más impactantes vacías, editarlas vía \`set_fase2_field\`, y mandar a aprobación con \`submit_fase2_for_review\`.
- Idioma: **español peruano** (tú, tienes, dime). NO uses voseo argentino (vos, tenés).
- NO toques HTML. NO uses bootstrap_deck ni upload_deck. Esos eran del flujo legacy.

## Workflow

### Paso 0 — Auth
1. Llamá \`whoami\` para confirmar sesión activa.
2. Si devuelve "No hay sesión activa" o si cualquier tool falla con \`NO_TOKEN\`:
   - Pedile al consultor: "¿Cuál es tu email y password de electoral.goberna.club?"
   - Esperá las dos respuestas (una a una, sin presionar) y llamá \`login({email, password})\`.
   - Si \`login\` devuelve credenciales incorrectas, decile que verifique en el portal y vuelva a darte el password.

### Paso 1 — Identificar el candidato
1. Llamá \`list_candidates\` — devuelve los candidatos asignados al consultor logged-in.
2. Si el consultor te da un nombre, matchealo con \`campaign_slug\` o \`candidato_nombres\`. Si hay ambigüedad, mostrá las opciones con AskUserQuestion.
3. Llamá \`open_fase2({slug})\`. Devuelve: snapshot (cargo/jurisdicción/partido), consultor_form actual, **bitacora_recent (últimas 10 entradas)**, status del deck, URL admin.

### Paso 1.5 — Leer la bitácora ANTES de preguntar nada
Si \`bitacora_total_entries > 0\` y/o \`bitacora_recent\` tiene contenido:
- Leé las notas. Cada una es un \`{ts, accion, campos_tocados?, nota?}\`.
- **NO repreguntes** cosas que ya quedaron resueltas en sesiones previas.
- Si el consultor pregunta "¿dónde estábamos?", resumí lo último que se hizo en 2-3 líneas usando la bitácora.
- Si encontrás una nota del estilo "queda pendiente X" / "el próximo agente debería Y", arrancá por ahí.

### Paso 2 — Diagnóstico rápido al consultor
Decile en 2-3 líneas qué tiene y qué falta:
> "Abriendo Fase 2 de **<full_name>** (<cargo>, <jurisdiccion>, <partido>). Form actual: <sections_filled>. Status: <status>. ¿En qué slide te quieres enfocar?"

Si el form está vacío, sugerí 3 secciones de alto impacto: **redes_sociales**, **debilidades**, **votos_para_ganar**.

### Paso 3 — Edición focalizada
El consultor te dice "trabajemos las redes" o "agreguemos las debilidades" o "actualicemos el presupuesto". Vos:

1. Hacé preguntas **una a una** (no soltarle 10 juntas).
2. Después de cada respuesta, llamá \`set_fase2_field({slug, patch: {<seccion>: {...}}})\`.
3. Confirmá con una línea: "✅ Actualizado <seccion>. Refrescá <URL> para ver."

### Ejemplos de patches

**Redes sociales del candidato + 3 adversarios:**
\`\`\`json
{
  "redes_sociales": {
    "candidato": { "facebook": "https://facebook.com/leonardo.jurado", "instagram": "https://instagram.com/leojurado", "tiktok": "https://tiktok.com/@leojurado", "web_oficial": "https://leonardojurado.pe" },
    "adversarios": [
      { "nombre": "Rosa Bartra", "partido": "Avanza País", "redes": { "facebook": "https://facebook.com/rosabartra" } },
      { "nombre": "Hernando Cevallos", "partido": "Perú Libre", "redes": { "instagram": "https://instagram.com/hcevallos" } },
      { "nombre": "Lourdes Flores", "partido": "PPC", "redes": { "tiktok": "https://tiktok.com/@lflores" } }
    ]
  }
}
\`\`\`

**Debilidades (auditoría):**
\`\`\`json
{
  "debilidades": {
    "fuentes": [
      { "key": "denuncias", "estado": "flag", "hallazgos": ["Carpeta fiscal 2019 por difamación — archivada"] },
      { "key": "google", "estado": "review", "hallazgos": ["Primeros 3 resultados: nota La República 2022 positiva"] },
      { "key": "reputacion_redes", "estado": "ok" },
      { "key": "jne_observaciones", "estado": "ok" }
    ],
    "lista_libre": [
      { "titulo": "Falta web oficial", "descripcion": "Adversario 1 ya tiene", "severidad": "media" }
    ]
  }
}
\`\`\`

**Votos para ganar:**
\`\`\`json
{ "votos_para_ganar": { "votos_ganador_anterior": 12450, "padron_actual": 48200, "votos_meta": 18500, "fuente": "ONPE 2022 + RENIEC 2026" } }
\`\`\`

**Fórmula electoral (aire/mar/tierra):**
\`\`\`json
{ "formula_electoral": { "presupuesto_total": 120000, "peso_aire": 20, "peso_mar": 50, "peso_tierra": 30, "justificacion": "Provincia con alta penetración móvil — mar prima. Aire solo en cierre." } }
\`\`\`

### Paso 3.5 — Tomar notas para sesiones futuras
Durante la conversación, si el consultor comparte algo no-trivial que no calza en un campo del form (una observación, una decisión, una hipótesis), llamá \`record_note({slug, nota})\`. Ejemplos:
- "Anotá que el adversario X bajó 8 puntos en la última encuesta de IPSOS"
- "Quedamos en que el presupuesto se confirma con junta directiva el viernes"
- "Para el próximo agente: ya descartamos hacer aire en TV — solo radio AM regional"

Estas notas persisten en la bitácora y son lo que hace que el análisis del consultor **evolucione sesión tras sesión** en lugar de empezar de cero.

### Paso 4 — Mandar a aprobación
Cuando el consultor diga "listo, manda a aprobar" / "ya está, al admin" / "submit":
1. Llamá \`submit_fase2_for_review({slug})\`.
2. Devuelve admin_review_url. Pasásela al consultor explícita y resumida:

> ✅ Listo. El deck está en **Por aprobar**. Mandá esta URL a proyecto@grupogoberna:
> https://electoral.goberna.club/admin/fase2/<slug>

NO llames bootstrap_deck ni upload_deck nunca. Esos son legacy. **TODO el flujo Fase 2 pasa por open_fase2 + set_fase2_field + submit_fase2_for_review.**

Listo. Si el consultor ya dio un nombre, llamá \`list_candidates\` ahora; si no, preguntale "¿con qué candidato trabajamos?"`;

const PROMPTS = [
  {
    name: "arrancar-deck",
    description: "Inicia el flow Goberna: lista tus candidatos, elegí uno, armamos el deck con el formato y lo subimos al portal.",
    arguments: [],
  },
  {
    name: "editar-fase2",
    description: "Flujo Fase 2: edita el consultor_form de un candidato, manda a aprobación. Para uso continuo con un mismo candidato.",
    arguments: [],
  },
];

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: PROMPTS,
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const name = request.params.name;
  if (name === "arrancar-deck") {
    return {
      description: "Workflow legacy: HTML deck standalone (deprecado — usar editar-fase2)",
      messages: [
        { role: "user", content: { type: "text", text: ARRANCAR_DECK_INSTRUCTIONS } },
      ],
    };
  }
  if (name === "editar-fase2") {
    return {
      description: "Flujo Fase 2: editar consultor_form + mandar a aprobación admin",
      messages: [
        { role: "user", content: { type: "text", text: EDITAR_FASE2_INSTRUCTIONS } },
      ],
    };
  }
  throw new Error(`Prompt desconocido: ${name}`);
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      // ── Auth ────────────────────────────────────────────────────────

      case "login": {
        const email = args.email;
        const password = args.password;
        if (typeof email !== "string" || email.length < 3) {
          throw new Error("email requerido");
        }
        if (typeof password !== "string" || password.length < 1) {
          throw new Error("password requerido");
        }
        try {
          const data = await apiNoAuth("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ identifier: email, password }),
          });
          const token = data.access_token;
          if (typeof token !== "string" || token.length < 10) {
            throw new Error("login OK pero el server no devolvió access_token");
          }
          writeToken(token);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ok: true,
                    user: {
                      id: data.user?.id,
                      full_name: data.user?.full_name,
                      email: data.user?.email,
                      role: data.user?.role,
                    },
                    token_saved_to: TOKEN_PATH,
                    expires_in_seconds: data.expires_in ?? null,
                    message: `✅ Logged in como ${data.user?.full_name ?? data.user?.email}. Ya puedes usar las demás tools.`,
                  },
                  null,
                  0,
                ),
              },
            ],
          };
        } catch (e) {
          if (String(e.message).includes("AUTH_INVALID_CREDENTIALS") || String(e.message).includes("401")) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "❌ Credenciales incorrectas. Verificá email + password en https://electoral.goberna.club/login y volvé a intentar.",
                },
              ],
            };
          }
          throw e;
        }
      }

      case "logout": {
        const wasLoggedIn = existsSync(TOKEN_PATH);
        deleteToken();
        return {
          content: [
            {
              type: "text",
              text: wasLoggedIn
                ? "✅ Sesión cerrada. Llamá 'login' otra vez cuando quieras."
                : "No había sesión activa.",
            },
          ],
        };
      }

      case "whoami": {
        if (!existsSync(TOKEN_PATH)) {
          return {
            content: [
              {
                type: "text",
                text: "No hay sesión activa. Llamá la tool 'login' con email + password del portal Goberna (electoral.goberna.club).",
              },
            ],
          };
        }
        try {
          const data = await api("/api/auth/me");
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ok: true,
                    user: data.user ?? data,
                    message: `Logged in como ${data.user?.full_name ?? data.user?.email ?? "—"}.`,
                  },
                  null,
                  0,
                ),
              },
            ],
          };
        } catch (e) {
          if (String(e.message).includes("401")) {
            deleteToken();
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "Token expirado. Llamá 'login' otra vez.",
                },
              ],
            };
          }
          throw e;
        }
      }

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

      case "bootstrap_deck": {
        const { candidato_id, type, form } = args;
        if (typeof candidato_id !== "number" || !Number.isInteger(candidato_id)) {
          throw new Error("candidato_id debe ser entero");
        }
        const body = { candidato_id };
        if (type) body.type = type;
        if (form && typeof form === "object") body.form = form;
        const data = await api("/api/consultor/decks/bootstrap", {
          method: "POST",
          body: JSON.stringify(body),
        });
        const deck = data.deck ?? {};
        // Slug local recomendado
        const fullName = deck.title ? deck.title.split("—")[1]?.trim() ?? "candidato" : "candidato";
        const slug = fullName
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        const localFilename = `${slug}-${deck.type ?? "diagnostico"}.html`;
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
                  ok: data.ok,
                  replaced: data.replaced ?? false,
                  deck_id: deck.id,
                  type: deck.type,
                  title: deck.title,
                  status: deck.status,
                  consultor_form: deck.consultor_form ?? {},
                  local_filename: localFilename,
                  preview_url: previewUrl,
                  html: deck.html,
                  bash_commands_to_run: [
                    `pgrep -f "preview-server.js" >/dev/null 2>&1 || (cd ~/Goberna/decks && nohup npm start >/tmp/goberna-preview.log 2>&1 &) && sleep 1`,
                    openCmd,
                  ].join("\n"),
                  next_steps: `1) Escribí el HTML al archivo 'output/${localFilename}' usando filesystem MCP write_file.\n2) Corré el bloque bash_commands_to_run con la herramienta Bash.\n3) Avisá al consultor: "Deck Goberna desplegado en ${previewUrl}. Tiene los 6 slides estándar — los datos del onboarding ya están auto-poblados, los placeholders [A completar] son las secciones donde el form opcional puede sumar info (web, redes, denuncias, quién es). Decime qué querés llenar."`,
                },
                null,
                0,
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

      // ── Fase 2 flow nuevo ────────────────────────────────────────────

      case "open_fase2": {
        const slug = args.slug;
        if (typeof slug !== "string" || slug.length < 1) {
          throw new Error("slug requerido");
        }
        const data = await api(`/api/consultor/fase2/by-candidato/${encodeURIComponent(slug)}`);
        const snap = data.snapshot ?? {};
        const deck = data.deck ?? {};
        const form = deck.consultor_form ?? {};
        const adminUrl = `${API_URL}/admin/fase2/${encodeURIComponent(slug)}`;
        const formKeys = Object.keys(form).filter((k) => k !== "bitacora");
        // Bitácora: últimas 10 entradas para no inflar context
        const bitacoraFull = Array.isArray(form.bitacora) ? form.bitacora : [];
        const bitacoraRecent = bitacoraFull.slice(-10);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: data.ok,
                  candidato: {
                    user_id: snap.user?.id,
                    full_name: snap.user?.full_name,
                    foto_url: undefined, // omitido para no inflar context
                    campaign_slug: snap.campaign?.slug,
                    cargo: snap.cargo?.nombre,
                    cargo_codigo: snap.cargo?.codigo,
                    ambito: snap.cargo?.ambito,
                    jurisdiccion:
                      snap.jurisdiccion?.distrito?.nombre ??
                      snap.jurisdiccion?.provincia?.nombre ??
                      snap.jurisdiccion?.departamento?.nombre ??
                      snap.jurisdiccion?.pais?.nombre,
                    partido: snap.organizacion_politica?.nombre,
                  },
                  deck: {
                    id: deck.id,
                    status: deck.status,
                    submitted_for_review_at: deck.submitted_for_review_at,
                    published_at: deck.published_at,
                    rejection_reason: deck.rejection_reason,
                    updated_at: deck.updated_at,
                  },
                  consultor_form: form,
                  consultor_form_sections_filled: formKeys,
                  bitacora_total_entries: bitacoraFull.length,
                  bitacora_recent: bitacoraRecent,
                  admin_review_url: adminUrl,
                  hint:
                    formKeys.length === 0 && bitacoraFull.length === 0
                      ? "El form está vacío y no hay bitácora previa. Empezá preguntando al consultor por las secciones más prioritarias (sugerencia: redes_sociales y debilidades primero, después ficha_basica)."
                      : bitacoraFull.length > 0
                        ? `Form tiene data en ${formKeys.length} sección(es). Bitácora con ${bitacoraFull.length} entradas (te mando las últimas 10 — leelas antes de preguntarle al consultor para no repetir trabajo ya hecho).`
                        : `Form tiene data en ${formKeys.length} sección(es). Preguntá al consultor en qué slide quiere enfocarse.`,
                },
                null,
                0,
              ),
            },
          ],
        };
      }

      case "set_fase2_field": {
        const slug = args.slug;
        const patch = args.patch;
        if (typeof slug !== "string" || slug.length < 1) {
          throw new Error("slug requerido");
        }
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
          throw new Error("patch debe ser un objeto");
        }
        const data = await api(
          `/api/consultor/fase2/by-candidato/${encodeURIComponent(slug)}/form`,
          {
            method: "PATCH",
            body: JSON.stringify(patch),
          },
        );
        const sectionsTouched = Object.keys(patch);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: data.ok,
                  deck_id: data.deck?.id,
                  status: data.deck?.status,
                  sections_touched: sectionsTouched,
                  updated_at: data.deck?.updated_at,
                  message: `Actualizado: ${sectionsTouched.join(", ")}. El cambio ya está en producción — el consultor puede refrescar el browser para ver.`,
                },
                null,
                0,
              ),
            },
          ],
        };
      }

      // ── Per-section helpers ──────────────────────────────────────────
      case "set_ficha_basica":
      case "set_quien_es":
      case "set_votos_para_ganar":
      case "set_formula_electoral":
      case "set_analisis_electoral":
      case "set_redes_sociales":
      case "set_debilidades": {
        const sectionMap = {
          set_ficha_basica: "ficha_basica",
          set_quien_es: "quien_es",
          set_votos_para_ganar: "votos_para_ganar",
          set_formula_electoral: "formula_electoral",
          set_analisis_electoral: "analisis_electoral",
          set_redes_sociales: "redes_sociales",
          set_debilidades: "debilidades",
        };
        const section = sectionMap[name];
        const { slug, ...payload } = args;
        if (typeof slug !== "string" || slug.length < 1) {
          throw new Error("slug requerido");
        }
        // Limpiar undefined del payload (campos no pasados) y normalizar
        // strings vacíos: para top-level les damos undefined (el backend
        // los borra al hacer merge ya que jsonb || filtra null).
        const cleanPayload = {};
        for (const [k, v] of Object.entries(payload)) {
          if (v === undefined) continue;
          cleanPayload[k] = v;
        }
        const patch = { [section]: cleanPayload };
        const data = await api(
          `/api/consultor/fase2/by-candidato/${encodeURIComponent(slug)}/form`,
          {
            method: "PATCH",
            body: JSON.stringify(patch),
          },
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: data.ok,
                  section,
                  fields_updated: Object.keys(cleanPayload),
                  updated_at: data.deck?.updated_at,
                  message: `✅ ${section} actualizado (${Object.keys(cleanPayload).length} campos). El admin route refresca en ≤4s.`,
                },
                null,
                0,
              ),
            },
          ],
        };
      }

      case "record_note": {
        const slug = args.slug;
        const nota = args.nota;
        if (typeof slug !== "string" || slug.length < 1) {
          throw new Error("slug requerido");
        }
        if (typeof nota !== "string" || nota.length < 2) {
          throw new Error("nota requerida (mín 2 chars)");
        }
        const data = await api(
          `/api/consultor/fase2/by-candidato/${encodeURIComponent(slug)}/note`,
          {
            method: "POST",
            body: JSON.stringify({ nota }),
          },
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: data.ok,
                  deck_id: data.deck_id,
                  message: "📝 Nota agregada a la bitácora. La verás la próxima vez que abras este candidato.",
                },
                null,
                0,
              ),
            },
          ],
        };
      }

      case "submit_fase2_for_review": {
        const slug = args.slug;
        if (typeof slug !== "string" || slug.length < 1) {
          throw new Error("slug requerido");
        }
        try {
          const data = await api(
            `/api/consultor/fase2/by-candidato/${encodeURIComponent(slug)}/submit`,
            { method: "POST", body: "{}" },
          );
          const adminUrl = `${API_URL}/admin/fase2/${encodeURIComponent(slug)}`;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ok: data.ok,
                    deck_id: data.deck?.id,
                    status: data.deck?.status,
                    submitted_for_review_at: data.deck?.submitted_for_review_at,
                    admin_review_url: adminUrl,
                    message: `Mandado a aprobación. Decile al consultor: "✅ Listo, el deck pasó a status 'Por aprobar'. Mandá esta URL a proyecto@grupogoberna para que lo apruebe: ${adminUrl}"`,
                  },
                  null,
                  0,
                ),
              },
            ],
          };
        } catch (e) {
          if (String(e.message).includes("DECK_ALREADY_PENDING")) {
            return {
              content: [
                {
                  type: "text",
                  text: `Ya está en revisión. URL admin: ${API_URL}/admin/fase2/${encodeURIComponent(slug)}`,
                },
              ],
            };
          }
          if (String(e.message).includes("DECK_ALREADY_PUBLISHED")) {
            return {
              content: [
                {
                  type: "text",
                  text: `Ya está publicado. Visible en: ${API_URL}/candidatos/${encodeURIComponent(slug)}/digital/decks`,
                },
              ],
            };
          }
          throw e;
        }
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
