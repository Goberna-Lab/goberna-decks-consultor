import { api, jsonReply } from "../lib/api.mjs";

export const schemas = [
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
        exclude_candidato: {
          type: "integer",
          description: "candidato_id a excluir (típicamente el actual)",
        },
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
];

export const handlers = {
  async find_similar_analisis(args) {
    const params = new URLSearchParams();
    if (args.cargo) params.set("cargo", String(args.cargo));
    if (args.ambito) params.set("ambito", String(args.ambito));
    if (args.partido) params.set("partido", String(args.partido));
    if (args.exclude_candidato) params.set("exclude_candidato", String(args.exclude_candidato));
    if (args.limit) params.set("limit", String(args.limit));
    const data = await api(`/api/consultor/analisis/similar?${params.toString()}`);
    return jsonReply(
      {
        ok: data.ok,
        count: data.items?.length ?? 0,
        items: data.items ?? [],
      },
      { pretty: true },
    );
  },

  async get_benchmarks(args) {
    const params = new URLSearchParams();
    if (args.cargo) params.set("cargo", String(args.cargo));
    if (args.ambito) params.set("ambito", String(args.ambito));
    const data = await api(`/api/consultor/benchmarks?${params.toString()}`);
    const count = data.items?.length ?? 0;
    return jsonReply(
      {
        ok: data.ok,
        count,
        items: data.items ?? [],
        note:
          count === 0
            ? "Aún no hay benchmarks históricos para este corte. La DB se irá llenando con cada deck que el consultor suba con structured payload."
            : null,
      },
      { pretty: true },
    );
  },
};
