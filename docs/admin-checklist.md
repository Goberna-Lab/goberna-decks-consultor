# Goberna · Checklist del admin para onboardear un consultor

Esto lo hacés vos (admin) para que un consultor político empiece a usar el kit Goberna en su Mac/Windows.

## Por consultor — 4 pasos (~10 minutos)

### 1. Crearle su user en Goberna (DB)

Abrí la consola del VPS y corré:

```sql
INSERT INTO public.users (email, full_name, phone, role, status)
VALUES ('mariana@grupogoberna.com', 'Mariana Rojas', NULL, 'consultor', 'active');
```

(Sin password — login por OTP/Firebase si necesita acceder al portal web. Para el MCP solo necesita el token.)

> Si querés que vea TODOS los candidatos (presentes y futuros), también hacé:
> ```sql
> INSERT INTO public.consultor_global_access (consultor_user_id, granted_by, notes)
> SELECT u.id, (SELECT id FROM public.users WHERE role='admin' LIMIT 1), 'Onboarding 2026'
> FROM public.users u WHERE u.email = 'mariana@grupogoberna.com';
> ```

Si preferís asignaciones puntuales: andate a https://electoral.goberna.club/consultores → click en el consultor → seleccioná candidatos uno a uno.

### 2. Generarle el token MCP

Andá a https://electoral.goberna.club/consultores como admin:

1. Click en el row del consultor.
2. Sección "Token MCP" → click **Generar token**.
3. Copiá el access_token completo (empieza con `eyJ...`, dura 365 días).
4. **No lo compartas por canal inseguro.** Mandalo por Signal, mail cifrado, o chat 1:1 dentro de Goberna Club.

### 3. (Opcional) Invitarlo a la org GitHub

Si querés que pueda contribuir al repo del kit (mejoras de prompts, nuevos templates):

1. https://github.com/orgs/Goberna-Lab/people → **Invite member**.
2. Username GitHub del consultor.
3. Rol: `Member`.
4. (No es necesario para usar el kit — el repo es público.)

### 4. Mandarle el mensaje de bienvenida

Plantilla (copiá y editá):

```
Hola {{nombre}},

Te dejo todo lo que necesitás para empezar a generar presentaciones de
candidatos con Claude + el kit Goberna.

──────────────────────────────────────────
1. INSTALACIÓN (5 minutos)

Mac → abrí Terminal y pegá:
  curl -fsSL https://electoral.goberna.club/setup-mac.sh | bash

Windows → abrí PowerShell (no cmd) y pegá:
  iwr https://electoral.goberna.club/setup-win.ps1 | iex

El script va a instalar Claude Desktop, configurar todo, y pedirte el
TOKEN. Pegá este (NO lo compartas):

{{token_aquí}}

──────────────────────────────────────────
2. EMPEZAR

Cuando termine la instalación:
  • Cerrá Claude Desktop completamente y volvelo a abrir
  • Empezá un chat nuevo
  • Escribí: "listame mis candidatos de Goberna y armemos un diagnóstico"

Claude te lista tu cartera y arrancan.

──────────────────────────────────────────
3. AYUDA

Manual completo: ~/Goberna/decks/docs/consultor.md
(después de instalar, en tu PC)

Cualquier cosa, escribime.

— {{tu_nombre}}
```

---

## Después que el consultor sube su primer deck

1. Andá a https://electoral.goberna.club/decks como admin.
2. Tab **Pendientes** → click en el deck.
3. SlideOver con preview iframe + dos botones:
   - **Publicar** → status = `published`, queda visible al candidato en `/candidatos/<slug>/digital/decks`.
   - **Rechazar + motivo** → status = `rejected`, el consultor ve el motivo cuando vuelva a listar.

## Si tenés que revocar acceso a un consultor

Andá a `/consultores` → click → quitar global access (si tenía) y/o remover asignaciones puntuales. Para invalidar el token activo:

```sql
-- Cambiar JWT_SECRET ROTA TODOS los tokens. Solo en emergencia.
-- Mejor: dejar que expire (365d) o bajar role a 'agente_campo'.
UPDATE public.users SET role = 'agente_campo' WHERE email = 'mariana@grupogoberna.com';
```

## Métricas: ver cuánto está creciendo la DB de análisis

```sql
-- Decks por status × consultor
SELECT u.full_name, d.status, COUNT(*) AS n
FROM public.decks d
JOIN public.users u ON u.id = d.uploaded_by_user_id
GROUP BY u.full_name, d.status
ORDER BY n DESC;

-- Hallazgos por categoría agregados
SELECT categoria, COUNT(*) AS n_total
FROM analisis.hallazgos
GROUP BY categoria
ORDER BY n_total DESC;

-- Riesgos más frecuentes por cargo
SELECT cg.codigo AS cargo, r.severidad, COUNT(*) AS n
FROM analisis.riesgos r
JOIN analisis.analisis a ON a.id = r.analisis_id
JOIN candidatos.postulacion p ON p.id_candidato = a.candidato_id
JOIN catalogos.cargo_gobierno cg ON cg.id = p.id_cargo_gobierno
GROUP BY cg.codigo, r.severidad
ORDER BY n DESC LIMIT 30;
```
