# Goberna · Manual del consultor político

Tu setup en 5 minutos para crear, iterar y publicar presentaciones HTML para tus candidatos.

---

## 1. Instalación (una sola vez)

Vas a recibir del admin de Goberna **dos cosas** por canal seguro (Signal, mail cifrado):

1. Un **token** que arranca con `eyJ...` (es tu llave de acceso).
2. La URL del script de instalación.

### Mac

Abrí Terminal y pegá:

```bash
curl -fsSL https://electoral.goberna.club/setup-mac.sh | bash
```

### Windows

Abrí PowerShell (no la cmd vieja) y pegá:

```powershell
iwr https://electoral.goberna.club/setup-win.ps1 | iex
```

El script te va a:

- Verificar / instalar Node, Git y Claude Code.
- Clonar `~/goberna-decks/` con todo el kit (plantillas, prompts, MCP).
- Pedirte que pegues el **token** — se guarda en `~/.config/goberna/token`.
- Registrar el MCP server `goberna` en Claude Code (te conecta automáticamente con la base de datos de candidatos).
- Crear los atajos `deck` y `deck-preview`.

Cuando termine, cerrá y reabrí la terminal para que los atajos tomen efecto.

---

## 2. Crear una presentación

Vas a tener **dos terminales abiertas** mientras trabajás:

### Terminal A — Claude Code (donde "conversás")

```
deck
```

(o `cd ~/goberna-decks && claude`)

Claude va a leer las instrucciones del kit y arrancar. **Decile**:

> Quiero armar un deck

Claude te va a:

1. **Listar tus candidatos** automáticamente (sale de la base de Goberna).
2. Preguntarte cuál querés trabajar.
3. Cargar todo el contexto de ese candidato (cargo, jurisdicción, partido).
4. Preguntarte qué tipo de deck (diagnóstico / análisis / plan / episódico).
5. Hacerte solo las preguntas que la base no responde sola (datos electorales, ideas fuerza, recomendaciones).
6. Mostrarte un outline antes de generar — vos confirmás.
7. Escribir el archivo en `output/<candidato>-<tipo>.html`.

### Terminal B — Servidor de preview

```
deck-preview
```

Abrí el navegador en **http://localhost:3000** y vas a ver el listado de tus decks. Click → la presentación.

---

## 3. Iterar (cambiar lo que quieras)

Volvé a la **Terminal A** y simplemente decile a Claude qué cambiar:

> En el slide 4 cambiá el dato 60% por 65%
> El título del slide 7 que sea "Riesgos del territorio"
> Agregale una sección al final con 3 recomendaciones concretas
> El partido es Renovación Popular, no Avanza País

Claude edita el archivo. **El navegador se recarga solo** — verás el cambio en menos de un segundo.

> Tip: si arruinás algo y querés volver, las versiones anteriores quedan en `output/.history/` con timestamp.

---

## 4. Publicar al candidato

Cuando estés conforme, decile a Claude:

> Subilo

Claude llama al backend Goberna y deja la presentación como **borrador (draft)**. Admin la revisa y la publica.

Cuando admin publica, el candidato y su equipo la ven directamente en su dashboard, en `Digital → Presentaciones`. También pueden descargarla como `.html` o abrirla en pestaña nueva.

> Si admin **rechaza** una presentación, vas a ver el motivo la próxima vez que llames `list_decks` desde Claude. Ajustá lo que diga y volvé a subir — re-subir reemplaza el draft anterior, no crea uno nuevo.

---

## 5. Comandos rápidos de referencia

| Comando | Qué hace |
|---|---|
| `deck` | Entrar a Claude Code en el folder del kit |
| `deck-preview` | Levantar el servidor en :3000 con hot-reload |
| `deck-update` | Bajar la última versión del kit (plantillas, prompts) |
| `cd ~/goberna-decks` | Ir al folder del kit |
| `cat ~/.config/goberna/token` | Ver tu token (no lo compartas) |

Decile a Claude:

| Frase | Resultado |
|---|---|
| "Listame mis candidatos" | Llama `list_candidates` |
| "Trabajemos con [nombre]" | Carga su contexto |
| "Cambiá [X] en el slide N" | Edita el archivo |
| "Subilo" | Sube como draft al portal Goberna |
| "Mostrame los decks de [candidato]" | Lista historial |

---

## 6. Reglas inviolables (para que se vea bien)

1. **Una presentación por archivo HTML**. No partir en varios.
2. **Paleta Goberna**: navy `#0a1f4a` / gold `#fbbf24` / rojo `#dc2626` / blanco. Nada más.
3. **Tipografía Montserrat** (ya viene cargada via Google Fonts).
4. **Cada slide entra en una pantalla 16:9** — no scroll vertical infinito.
5. **Si falta un dato, marcá `[A completar]`** y preguntá al consultor — no inventes números.

Estas reglas las maneja Claude automáticamente porque las tiene en `CLAUDE.md`.

---

## 7. Si algo falla

| Síntoma | Solución |
|---|---|
| Claude dice "MCP no disponible" | Cerrá y reabrí Claude Code. Si sigue, verificá `cat ~/.config/goberna/token` (no debe estar vacío) |
| `deck-preview` falla con "EADDRINUSE" | El puerto 3000 ya está usado. Matá el proceso anterior o usá `PORT=3001 deck-preview` |
| El navegador no recarga al editar | Verificá que estés en `localhost:3000` y no en `file://` |
| "Token expirado" | Pedile al admin un token nuevo (los tokens duran 365 días) |

Cualquier otra cosa, escribile al admin.
