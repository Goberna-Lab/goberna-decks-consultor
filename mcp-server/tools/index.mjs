import * as auth from "./auth.mjs";
import * as candidates from "./candidates.mjs";
import * as analytics from "./analytics.mjs";
import * as decks from "./decks.mjs";
import * as fase2 from "./fase2.mjs";

// Para agregar un grupo de tools nuevo, importá su módulo y agregalo a este array.
// Cada módulo exporta { schemas: [...], handlers: { name: async fn } }.
const MODULES = [auth, candidates, analytics, decks, fase2];

export const TOOLS = MODULES.flatMap((m) => m.schemas);

export const handlers = Object.assign({}, ...MODULES.map((m) => m.handlers));
