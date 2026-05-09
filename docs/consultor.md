# Goberna · Manual del consultor político

Tu setup en 5 minutos para crear, iterar y publicar presentaciones HTML para tus candidatos. Usás **Claude Desktop** + el MCP `goberna`.

---

## 1. Instalación (una sola vez)

Vas a recibir del admin de Goberna **dos cosas** por canal seguro (Signal, mail cifrado):

1. Un **token** que arranca con `eyJ...` (es tu llave de acceso).
2. La URL del script de instalación.

### Mac

Abrí Terminal (Spotlight → "Terminal") y pegá:

```bash
curl -fsSL https://electoral.goberna.club/setup-mac.sh | bash
```

### Windows

Abrí PowerShell (no la "cmd" vieja — buscá "PowerShell" en el menú inicio) y pegá:

```powershell
iwr https://electoral.goberna.club/setup-win.ps1 | iex
```

El script hace **todo solo**:

- Instala Node, Git, **Claude Desktop**.
- Clona el kit Goberna en `~/Goberna/decks`.
- Te pide pegar el **token**.
- Configura Claude Desktop para que cargue el MCP `goberna` (donde están las herramientas Goberna).

Cuando termine, **cerrá Claude Desktop completamente** (CMD+Q en Mac, "Salir" desde la barra en Windows) y volvelo a abrir. Esto es necesario para que cargue el nuevo MCP.

---

## 2. Empezar una presentación

Abrí Claude Desktop. Empezá un chat nuevo y escribí:

> **Listame mis candidatos de Goberna y armemos un diagnóstico para uno de ellos.**

(o tipeá `/arrancar-deck` y elegí el comando del menú — hace lo mismo.)

Claude va a:

1. **Listar tus candidatos** automáticamente (sale de la base Goberna).
2. Preguntarte cuál querés trabajar.
3. Cargar todo el contexto de ese candidato (cargo, jurisdicción, partido).
4. Mostrarte si hay **análisis previos** de candidatos similares para que arranques con contexto histórico.
5. Preguntarte qué tipo de deck (diagnóstico / análisis / plan / episódico).
6. Hacerte solo las preguntas que la base no responde sola (datos electorales, ideas fuerza, recomendaciones).
7. Mostrarte un outline antes de generar — vos confirmás.
8. **Generar la presentación HTML directamente en el chat** como un artifact (panel a la derecha donde la podés ver renderizada).

---

## 3. Iterar (cambiar lo que quieras)

En el mismo chat, decile a Claude qué cambiar:

> En el slide 4 cambiá el dato 60% por 65%
> El título del slide 7 que sea "Riesgos del territorio"
> Agregale una sección al final con 3 recomendaciones concretas
> El partido es Renovación Popular, no Avanza País

Claude actualiza el artifact y vos lo ves al instante.

> Tip: si querés ver el deck en pantalla completa, en el artifact hacé click en el ícono de "expandir".

---

## 4. Publicar al candidato

Cuando estés conforme, decile a Claude:

> **Subilo**

Claude llama al backend Goberna y deja la presentación como **borrador (draft)**. Admin la revisa y la publica.

Cuando admin publica, el candidato y su equipo la ven directamente en su dashboard, en `Digital → Presentaciones`. También pueden descargarla como `.html` o abrirla en pestaña nueva.

> Si admin **rechaza** una presentación, vas a ver el motivo la próxima vez que pidas listar los decks de ese candidato. Ajustá lo que diga y volvé a subir — re-subir reemplaza el draft anterior, no crea uno nuevo.

---

## 5. Reglas inviolables (para que se vea bien)

1. **Una presentación por archivo HTML**. No partir en varios.
2. **Paleta Goberna**: navy `#0a1f4a` / gold `#fbbf24` / rojo `#dc2626` / blanco. Nada más.
3. **Tipografía Montserrat** (Claude la carga automáticamente desde Google Fonts).
4. **Cada slide entra en una pantalla 16:9** — no scroll vertical infinito.
5. **Si falta un dato, marcalo `[A completar]`** y preguntá al consultor — no inventes números.

Estas reglas las maneja Claude automáticamente porque las tiene en sus instrucciones.

---

## 6. Si algo falla

| Síntoma | Solución |
|---|---|
| Claude no ve el MCP `goberna` | Cerrá Claude Desktop completamente y volvelo a abrir. Si sigue, pasame por mensaje el contenido de `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) o `%APPDATA%\Claude\claude_desktop_config.json` (Windows) |
| "No tengo acceso a tus candidatos" / 401 | Tu token expiró o no se guardó. Pedile al admin uno nuevo. Cuando lo tengas: `echo "tu-token" > ~/.config/goberna/token` |
| El artifact no muestra el HTML renderizado | Claude Desktop a veces necesita un click en el panel. Sino, copiá el contenido y abrilo en cualquier navegador. |
| "Tu cargo no aparece en la lista" | Está fuera de los catálogos actuales (Perú first). Avisale al admin. |
| Cualquier otra cosa | Mandame screenshot al admin Goberna. |

---

## 7. Buenas prácticas

- **Antes de subir**, dale una pasada visual al artifact. Cualquier número que no te suene → preguntale a Claude de dónde lo sacó.
- **Después de subir**, podés seguir conversando: "ahora armame un plan operativo para el mismo candidato basado en las recomendaciones del diagnóstico". Claude va a recordar el contexto.
- **Para empezar otro candidato**, abrí un chat nuevo. Cada conversación = un candidato (más limpio para Claude).
