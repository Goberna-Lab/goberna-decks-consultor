import { api, API_URL, jsonReply, textReply } from "../lib/api.mjs";

export const schemas = [
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
      "Actualiza un campo (o varios) del consultor_form del Fase 2 deck. Hace deep-merge nivel-1: cualquier sección que vienen reemplaza la existente; lo que no mandás queda igual. Las secciones del form son:\n\n• ficha_basica: { dni?, edad?, profesion? }\n• rol_usuario: { filler_role?: 'consultor'|'cartografo'|'candidato'|'admin' }\n• analisis_electoral: { comentario_consultor?, ranking_partido_zona? }\n• votos_para_ganar: { votos_ganador_anterior?, padron_actual?, votos_meta?, fuente? }\n• partidos: { observaciones?, top_partidos?[] }\n• historial: { entries?[], nunca_postulo?, observaciones? }\n• formula_electoral: { presupuesto_total?, peso_aire?, peso_mar?, peso_tierra?, justificacion? }\n• recorrido_estrategico: { hitos?[] }\n• presencia_digital: { web_oficial?, google_results?, redes_verificadas?, info_clave?: 'ok'|'review'|'flag', notas? }\n• redes_sociales: { candidato?: {facebook?, instagram?, tiktok?, twitter?, youtube?, web_oficial?}, adversarios?[] }\n• debilidades: { fuentes?[{key:'denuncias'|'google'|'reputacion_redes'|'jne_observaciones', estado:'ok'|'review'|'flag', hallazgos?[]}], lista_libre?[] }\n• quien_es: { texto_libre?, trayectoria?, valores?[] }\n• text_overrides: { '<slide>.<field>': '<texto>' } — overrides arbitrarios de cualquier texto hardcoded del deck (cover.title, capacidad-goberna.pilares.X.titulo, etc).\n\nDespués de cada cambio importante, decile al consultor: 'Listo, actualizado en producción. Refrescá la pestaña del browser para ver.'",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Slug de la campaña del candidato" },
        patch: {
          type: "object",
          description:
            "Subset del consultor_form (cualquier combinación de secciones). El backend hace deep-merge.",
        },
      },
      required: ["slug", "patch"],
    },
  },
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
      "Actualiza el slide Redes Sociales (Sección 7). Args:\n• candidato: handles propios — facebook, instagram, tiktok, twitter, youtube, web_oficial (URLs completas https://…)\n• adversarios: array de hasta 3 — {nombre, partido?, redes: {facebook?, instagram?, tiktok?, ...}}",
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
          description:
            "Texto libre (2–2000 chars). Sé conciso pero específico — debe ser útil para el próximo agente.",
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

// Mapeo set_<section> → nombre de sección en consultor_form
const SECTION_BY_TOOL = {
  set_ficha_basica: "ficha_basica",
  set_quien_es: "quien_es",
  set_votos_para_ganar: "votos_para_ganar",
  set_formula_electoral: "formula_electoral",
  set_analisis_electoral: "analisis_electoral",
  set_redes_sociales: "redes_sociales",
  set_debilidades: "debilidades",
};

function requireSlug(args) {
  const slug = args.slug;
  if (typeof slug !== "string" || slug.length < 1) {
    throw new Error("slug requerido");
  }
  return slug;
}

async function patchFase2Form(slug, patch) {
  return api(`/api/consultor/fase2/by-candidato/${encodeURIComponent(slug)}/form`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

async function setSectionHandler(toolName, args) {
  const section = SECTION_BY_TOOL[toolName];
  const slug = requireSlug(args);
  const { slug: _slug, ...payload } = args;
  // Limpiar undefined (campos no pasados)
  const cleanPayload = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined) continue;
    cleanPayload[k] = v;
  }
  const patch = { [section]: cleanPayload };
  const data = await patchFase2Form(slug, patch);
  return jsonReply({
    ok: data.ok,
    section,
    fields_updated: Object.keys(cleanPayload),
    updated_at: data.deck?.updated_at,
    message: `✅ ${section} actualizado (${Object.keys(cleanPayload).length} campos). El admin route refresca en ≤4s.`,
  });
}

export const handlers = {
  async open_fase2(args) {
    const slug = requireSlug(args);
    const data = await api(`/api/consultor/fase2/by-candidato/${encodeURIComponent(slug)}`);
    const snap = data.snapshot ?? {};
    const deck = data.deck ?? {};
    const form = deck.consultor_form ?? {};
    const adminUrl = `${API_URL}/admin/fase2/${encodeURIComponent(slug)}`;
    const formKeys = Object.keys(form).filter((k) => k !== "bitacora");
    const bitacoraFull = Array.isArray(form.bitacora) ? form.bitacora : [];
    const bitacoraRecent = bitacoraFull.slice(-10);
    return jsonReply({
      ok: data.ok,
      candidato: {
        user_id: snap.user?.id,
        full_name: snap.user?.full_name,
        foto_url: undefined,
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
    });
  },

  async set_fase2_field(args) {
    const slug = requireSlug(args);
    const patch = args.patch;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new Error("patch debe ser un objeto");
    }
    const data = await patchFase2Form(slug, patch);
    const sectionsTouched = Object.keys(patch);
    return jsonReply({
      ok: data.ok,
      deck_id: data.deck?.id,
      status: data.deck?.status,
      sections_touched: sectionsTouched,
      updated_at: data.deck?.updated_at,
      message: `Actualizado: ${sectionsTouched.join(", ")}. El cambio ya está en producción — el consultor puede refrescar el browser para ver.`,
    });
  },

  // Per-section helpers — todos comparten misma lógica
  set_ficha_basica: (args) => setSectionHandler("set_ficha_basica", args),
  set_quien_es: (args) => setSectionHandler("set_quien_es", args),
  set_votos_para_ganar: (args) => setSectionHandler("set_votos_para_ganar", args),
  set_formula_electoral: (args) => setSectionHandler("set_formula_electoral", args),
  set_analisis_electoral: (args) => setSectionHandler("set_analisis_electoral", args),
  set_redes_sociales: (args) => setSectionHandler("set_redes_sociales", args),
  set_debilidades: (args) => setSectionHandler("set_debilidades", args),

  async record_note(args) {
    const slug = requireSlug(args);
    const nota = args.nota;
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
    return jsonReply({
      ok: data.ok,
      deck_id: data.deck_id,
      message:
        "📝 Nota agregada a la bitácora. La verás la próxima vez que abras este candidato.",
    });
  },

  async submit_fase2_for_review(args) {
    const slug = requireSlug(args);
    try {
      const data = await api(
        `/api/consultor/fase2/by-candidato/${encodeURIComponent(slug)}/submit`,
        { method: "POST", body: "{}" },
      );
      const adminUrl = `${API_URL}/admin/fase2/${encodeURIComponent(slug)}`;
      return jsonReply({
        ok: data.ok,
        deck_id: data.deck?.id,
        status: data.deck?.status,
        submitted_for_review_at: data.deck?.submitted_for_review_at,
        admin_review_url: adminUrl,
        message: `Mandado a aprobación. Decile al consultor: "✅ Listo, el deck pasó a status 'Por aprobar'. Mandá esta URL a proyecto@grupogoberna para que lo apruebe: ${adminUrl}"`,
      });
    } catch (e) {
      if (String(e.message).includes("DECK_ALREADY_PENDING")) {
        return textReply(
          `Ya está en revisión. URL admin: ${API_URL}/admin/fase2/${encodeURIComponent(slug)}`,
        );
      }
      if (String(e.message).includes("DECK_ALREADY_PUBLISHED")) {
        return textReply(
          `Ya está publicado. Visible en: ${API_URL}/candidatos/${encodeURIComponent(slug)}/digital/decks`,
        );
      }
      throw e;
    }
  },
};
