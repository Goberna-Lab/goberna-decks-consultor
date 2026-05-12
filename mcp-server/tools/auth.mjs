import {
  api,
  apiNoAuth,
  hasToken,
  writeToken,
  deleteToken,
  TOKEN_PATH,
  jsonReply,
  textReply,
  errorReply,
} from "../lib/api.mjs";

export const schemas = [
  {
    name: "login",
    description:
      "Inicia sesión en Goberna con email + password (la misma cuenta del portal electoral.goberna.club). Guarda el JWT localmente para las siguientes llamadas. **LLAMAR AUTOMÁTICAMENTE cuando otra tool devuelva error NO_TOKEN, o cuando el consultor diga 'login' / 'iniciar sesión' / 'mi cuenta es ...'.** Si tu prompt actual no tiene credenciales, preguntale al consultor por su email y password antes de llamar — son los del portal Goberna.",
    inputSchema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description:
            "Email del consultor (o número de teléfono si así se registró). Lo que usa en electoral.goberna.club.",
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
];

export const handlers = {
  async login(args) {
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
      return jsonReply({
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
      });
    } catch (e) {
      if (
        String(e.message).includes("AUTH_INVALID_CREDENTIALS") ||
        String(e.message).includes("401")
      ) {
        return errorReply(
          "❌ Credenciales incorrectas. Verificá email + password en https://electoral.goberna.club/login y volvé a intentar.",
        );
      }
      throw e;
    }
  },

  async logout() {
    const wasLoggedIn = hasToken();
    deleteToken();
    return textReply(
      wasLoggedIn
        ? "✅ Sesión cerrada. Llamá 'login' otra vez cuando quieras."
        : "No había sesión activa.",
    );
  },

  async whoami() {
    if (!hasToken()) {
      return textReply(
        "No hay sesión activa. Llamá la tool 'login' con email + password del portal Goberna (electoral.goberna.club).",
      );
    }
    try {
      const data = await api("/api/auth/me");
      return jsonReply({
        ok: true,
        user: data.user ?? data,
        message: `Logged in como ${data.user?.full_name ?? data.user?.email ?? "—"}.`,
      });
    } catch (e) {
      if (String(e.message).includes("401")) {
        deleteToken();
        return errorReply("Token expirado. Llamá 'login' otra vez.");
      }
      throw e;
    }
  },
};
