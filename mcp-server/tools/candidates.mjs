import { api, jsonReply } from "../lib/api.mjs";

export const schemas = [
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
];

export const handlers = {
  async list_candidates() {
    const data = await api("/api/consultor/candidates");
    // Slim: omitir foto_url (puede ser base64 grande) + ids redundantes.
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
    return jsonReply({
      ok: data.ok,
      count: slim.length,
      admin_all: data.admin_all ?? false,
      candidates: slim,
    });
  },

  async get_candidate_context(args) {
    const id = args.candidato_id;
    if (typeof id !== "number" || !Number.isInteger(id)) {
      throw new Error("candidato_id debe ser un entero");
    }
    const data = await api(`/api/consultor/candidates/${id}/context`);
    return jsonReply(data, { pretty: true });
  },
};
