import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";

import {
  api,
  jsonReply,
  errorReply,
  slugify,
  previewBashCommands,
} from "../lib/api.mjs";

const VALID_DECK_TYPES = ["diagnostico", "analisis", "plan", "episodico", "otro"];

export const schemas = [
  {
    name: "bootstrap_deck",
    description:
      "Crea o regenera el deck Goberna estándar (template Fase 2 con 6 slides) desde el onboarding del candidato + form opcional del consultor. Idempotente: si ya hay un draft del mismo (candidato, consultor, type), lo actualiza; si no, crea uno nuevo. Reemplaza al uso de STARTER.html local — el HTML lo arma el server con los datos reales del candidato. El form es opcional y se merge profundo (cualquier subset de los 5 secciones). Devuelve deck_id + html para que escribas en disco con filesystem MCP. SIEMPRE usá esto en lugar de generar HTML a mano. Si el consultor no pasó form aún, mandá form vacío y se crea el deck con placeholders [A completar] que el consultor puede llenar después con `update_deck_form`.",
    inputSchema: {
      type: "object",
      properties: {
        candidato_id: {
          type: "integer",
          description: "ID del candidato (requerido — FK enforced en backend).",
        },
        type: {
          type: "string",
          enum: VALID_DECK_TYPES,
          description: "Tipo de deck (default: diagnostico).",
        },
        form: {
          type: "object",
          description:
            "Form opcional del consultor con 5 secciones. Cualquier subset es válido — el backend hace merge.",
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
          enum: VALID_DECK_TYPES,
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
          description:
            "Título de la presentación (2–200 chars). Ej: 'Diagnóstico Inicial — Roberto Sánchez'",
        },
        type: {
          type: "string",
          enum: VALID_DECK_TYPES,
          description: "Tipo de deck",
        },
        description: {
          type: "string",
          description: "Resumen opcional (≤500 chars) para que admin entienda contexto",
        },
        html: {
          type: "string",
          description:
            "Contenido HTML completo del deck (self-contained: tailwind por CDN está OK). Máximo 5MB.",
        },
        structured: {
          type: "object",
          description:
            "OPCIONAL pero MUY recomendado: payload estructurado con los hallazgos/riesgos/recomendaciones del deck. Goberna lo guarda en su DB de análisis para alimentar benchmarks y futuros decks. Cero costo extra para el consultor — vos (Claude) lo construís a partir del mismo material que pusiste en el deck.",
          properties: {
            summary: { type: "string", description: "Abstract del deck (≤2000 chars), searchable" },
            fecha_corte: {
              type: "string",
              description: "YYYY-MM-DD — a qué fecha refiere el análisis",
            },
            hallazgos: {
              type: "array",
              description: "FODA + libre. Hechos detectados sobre candidato/territorio.",
              items: {
                type: "object",
                properties: {
                  categoria: {
                    type: "string",
                    enum: ["fortaleza", "debilidad", "oportunidad", "amenaza", "contexto"],
                  },
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
                  area: {
                    type: "string",
                    enum: [
                      "territorio",
                      "digital",
                      "datos",
                      "comunicacion",
                      "organizacion",
                      "financiamiento",
                      "legal",
                      "otro",
                    ],
                  },
                  plazo: {
                    type: "string",
                    enum: ["inmediato", "corto", "mediano", "largo"],
                  },
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

function tryReadStarter(ctx, preferType) {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const starterPath = pathResolve(here, "..", "..", "STARTER.html");
    if (!existsSync(starterPath)) return null;

    let starter = readFileSync(starterPath, "utf8");
    const fullName = ctx?.user?.full_name ?? "Candidato";
    const nameUpper = fullName.toUpperCase();
    const parts = nameUpper.split(/\s+/);
    const nameSplit =
      parts.length >= 2 ? `${parts[0]}<br/>${parts.slice(1).join(" ")}` : nameUpper;
    const jurisdiccionLabel =
      ctx?.jurisdiccion?.distrito?.nombre ??
      ctx?.jurisdiccion?.provincia?.nombre ??
      ctx?.jurisdiccion?.departamento?.nombre ??
      ctx?.jurisdiccion?.pais?.nombre ??
      "—";
    const partido = ctx?.organizacion_politica?.nombre ?? "[partido]";
    const tipoLabel = preferType.charAt(0).toUpperCase() + preferType.slice(1);
    const ambito = ctx?.cargo?.ambito;
    const eleccion =
      ambito === "pais"
        ? "GENERALES 2026"
        : ambito === "departamento"
          ? "REGIONALES 2026"
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
    return starter;
  } catch {
    return null;
  }
}

export const handlers = {
  async bootstrap_deck(args) {
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
    const fullName = deck.title ? deck.title.split("—")[1]?.trim() ?? "candidato" : "candidato";
    const slug = slugify(fullName);
    const localFilename = `${slug}-${deck.type ?? "diagnostico"}.html`;
    const previewUrl = `http://localhost:3000/output/${localFilename}`;
    return jsonReply({
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
      bash_commands_to_run: previewBashCommands(previewUrl),
      next_steps: `1) Escribí el HTML al archivo 'output/${localFilename}' usando filesystem MCP write_file.\n2) Corré el bloque bash_commands_to_run con la herramienta Bash.\n3) Avisá al consultor: "Deck Goberna desplegado en ${previewUrl}. Tiene los 6 slides estándar — los datos del onboarding ya están auto-poblados, los placeholders [A completar] son las secciones donde el form opcional puede sumar info (web, redes, denuncias, quién es). Decime qué querés llenar."`,
    });
  },

  async publish_deck(args) {
    const id = args.deck_id;
    if (typeof id !== "string" || id.length < 5) {
      throw new Error("deck_id debe ser un UUID");
    }
    try {
      const data = await api(`/api/consultor/decks/${encodeURIComponent(id)}/publish`, {
        method: "POST",
      });
      return jsonReply({
        ok: data.ok,
        deck_id: data.deck?.id,
        status: data.deck?.status,
        published_at: data.deck?.published_at,
        public_url: `https://electoral.goberna.club/candidatos/<slug>/digital/decks`,
        message: "✅ Deck publicado. Ya está visible en el portal del candidato.",
      });
    } catch (e) {
      if (
        String(e.message).includes("SELF_PUBLISH_NOT_ALLOWED") ||
        String(e.message).includes("403")
      ) {
        return errorReply(
          "No tenés permiso para autopublicar (te falta consultor_global_access). El deck quedó en draft — pedile a admin que lo publique en https://electoral.goberna.club/decks.",
        );
      }
      throw e;
    }
  },

  async fetch_deck_html(args) {
    const id = args.deck_id;
    if (typeof id !== "string" || id.length < 5) {
      throw new Error("deck_id debe ser un UUID");
    }
    const data = await api(`/api/consultor/decks/${encodeURIComponent(id)}`);
    return jsonReply(
      {
        ok: data.ok,
        deck: data.deck ?? null,
      },
      { pretty: true },
    );
  },

  async sync_candidate_workspace(args) {
    const cid = args.candidato_id;
    if (typeof cid !== "number" || !Number.isInteger(cid)) {
      throw new Error("candidato_id debe ser entero");
    }
    const preferType = args.prefer_type ?? "diagnostico";

    let ctx = null;
    try {
      ctx = await api(`/api/consultor/candidates/${cid}/context`);
    } catch {
      // ignore: seguimos sin contexto
    }

    const list = await api(`/api/consultor/decks?candidato_id=${cid}`);
    const decks = list.decks ?? [];
    const chosen = decks.find((d) => d.type === preferType) ?? decks[0] ?? null;

    const baseSlug = ctx?.campaign?.slug ?? slugify(chosen?.candidato_nombres ?? "candidato");
    const localFilename = `${baseSlug}-${preferType}.html`;

    let html = null;
    let source = null;
    if (chosen) {
      const data = await api(`/api/consultor/decks/${encodeURIComponent(chosen.id)}`);
      html = data.deck?.html ?? null;
      source = "existing_deck";
    }

    if (!html) {
      html = tryReadStarter(ctx, preferType);
      if (html) source = "starter_template";
    }

    const previewUrl = `http://localhost:3000/output/${localFilename}`;

    return jsonReply({
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
      bash_commands_to_run: previewBashCommands(previewUrl),
      next_steps: html
        ? `1) Escribí 'html' al archivo 'output/${localFilename}' usando filesystem MCP write_file.\n2) Ejecutá el bloque 'bash_commands_to_run' con la herramienta Bash.\n3) Decile al consultor: "Listo, abrí ${previewUrl} en tu browser. El deck está prepoblado con ${chosen ? `tu último ${chosen.type}` : `los datos del candidato (cargo, jurisdicción, partido)`}. Ya podés iterar — cada cambio que hagas se autorefresca."`
        : "No pude leer STARTER.html ni hay deck previo. Pedile al consultor que verifique que ~/Goberna/decks/STARTER.html existe.",
    });
  },

  async list_decks(args) {
    const id = args.candidato_id;
    if (typeof id !== "number" || !Number.isInteger(id)) {
      throw new Error("candidato_id debe ser un entero");
    }
    const data = await api(`/api/consultor/decks?candidato_id=${id}`);
    return jsonReply(
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
      { pretty: true },
    );
  },

  async upload_deck(args) {
    const { candidato_id, title, type, description, html, structured } = args;
    if (typeof candidato_id !== "number" || !Number.isInteger(candidato_id)) {
      throw new Error("candidato_id debe ser entero");
    }
    if (typeof title !== "string" || title.trim().length < 2) {
      throw new Error("title requerido (mín 2 chars)");
    }
    if (!VALID_DECK_TYPES.includes(type)) {
      throw new Error(`type debe ser uno de: ${VALID_DECK_TYPES.join(", ")}`);
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
    return jsonReply(
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
      { pretty: true },
    );
  },
};
