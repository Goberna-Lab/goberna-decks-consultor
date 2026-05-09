# Goberna Decks · Kit del Consultor

Genera presentaciones HTML modernas para tus candidatos usando Claude. El output es un archivo `.html` standalone que subís al portal admin de Goberna.

## Setup inicial (1 sola vez)

### Mac

Abrí Terminal y pegá:

```bash
curl -fsSL https://electoral.goberna.club/setup-mac.sh | bash
```

### Windows

Abrí PowerShell y pegá:

```powershell
iwr https://electoral.goberna.club/setup-win.ps1 | iex
```

Después del setup, **abrí una terminal nueva** y autenticá Claude:

```
claude /login
```

Listo. Ya podés arrancar.

## Workflow diario

```
1. Tipea: deck
2. Claude Code arranca con el contexto del kit
3. Conversá: "Armame un deck Diagnóstico Inicial para [candidato] en [zona]"
4. Claude genera output/<nombre>.html
5. Tipea: deck-preview
6. Browser abre localhost:3000 → revisá el deck
7. Si OK → subí el .html al portal admin
```

## Tipos de deck disponibles

Los prompts tipo en `prompts/` te dan estructura:

- **Diagnóstico Inicial** — `prompts/diagnostico-inicial.md`
  Cover, contexto jurisdicción, análisis electoral, competencia, ¿quién es?, conclusiones, recomendaciones.
- **Análisis Episódico** — `prompts/analisis-episodico.md`
  Para post-debate, post-encuesta, hot-takes.
- **Plan Operativo** — `prompts/plan-operativo.md`
  Acciones por mes, KPIs, presupuesto.

## Diseño

Todos los decks deben respetar la paleta y patrones de `DESIGN-SYSTEM.md`. Claude lo lee automáticamente. Si querés ver cómo se ve, abrí `ejemplos/roberto-sanchez-conclusiones.html`.

## ¿Algo no funciona?

- **`claude` no se reconoce**: cerrá la terminal y abrí una nueva.
- **`deck` no se reconoce**: lo mismo, terminal nueva.
- **El npm start tira error**: corré `npm install` desde `~/Goberna/decks`.
- **Claude no me responde**: validá tu cuenta con `claude /login`.
