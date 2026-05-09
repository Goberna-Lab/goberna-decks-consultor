# Goberna · Sistema de Diseño para Decks

## Paleta de colores

| Token | Hex | Uso |
|---|---|---|
| `navy` | `#0a1f4a` | Header bands, fondo de hero cards |
| `navy-deep` | `#061633` | Fondo de slide divisores |
| `navy-mid` | `#1a2c5e` | Gradiente con navy |
| `gold` | `#fbbf24` | Acento principal, highlights, números |
| `gold-deep` | `#f59e0b` | Gradiente con gold, hover |
| `red` | `#dc2626` | Riesgos, alertas, badges negativos |
| `red-soft` | `#fecaca` | Backgrounds suaves de riesgo |
| `ink` | `#0f172a` | Texto principal en body blanco |
| Gray-700 | `#334155` | Texto secundario |
| Gray-500 | `#64748b` | Texto terciario |
| White | `#ffffff` | Body de slides de contenido |

**Regla**: nunca uses azules celestes, rosas, verdes, morados. Solo los anteriores.

## Tipografía

**Familia**: Montserrat (Google Fonts)
**Pesos**: 400, 500, 600, 700, 800, 900

| Elemento | Tamaño | Peso |
|---|---|---|
| Headline gigante (cover, divider) | text-7xl/8xl | 900 (black) |
| Header band title | text-4xl/6xl | 900 (black) |
| Hero card title | text-2xl/3xl | 700 (bold) |
| Card title | text-lg/xl | 700 (bold) |
| Body text | text-sm/base | 400/500 |
| Kicker (uppercase tracking-widest) | text-xs/[10px] | 700/900 |

**Reglas**:
- Titulares siempre `uppercase tracking-tight leading-[0.95]`
- Kickers (microtitulares): `uppercase tracking-[0.3em] font-bold`
- Body: case mixto, `leading-relaxed` para texto largo

## Patrones de slide

### 1. Cover slide

Pantalla completa navy con cielo nublado, foto del candidato (si hay), nombre gigante uppercase blanco, tagline en boxes amarillos rotados (-2deg).

```
┌──────────────────────────────────┐
│ [cielo nublado navy]             │
│                                  │
│   ROBERTO SÁNCHEZ                │  ← text-8xl black white
│   ─────                          │
│   [foto]   RUMBO                 │
│            A LA   ← box gold     │
│            SEGUNDA               │
│            VUELTA ← box white    │
│                                  │
└──────────────────────────────────┘
```

### 2. Section divider

Pantalla completa navy + cielo, número de sección + kicker pequeño + pregunta gigante uppercase, parte highlight en gold.

```
┌──────────────────────────────────┐
│   01 ──── ANÁLISIS ELECTORAL     │
│                                  │
│   ¿CÓMO LE FUE A                 │
│   RENOVACIÓN POPULAR             │  ← gold highlight
│   EN CAÑETE?                     │
│                                  │
│   ────                           │
└──────────────────────────────────┘
```

### 3. Slide de contenido (estándar)

Header navy + body blanco + barra dorada inferior.

```
┌──────────────────────────────────┐
│ ░ NAVY HEADER · WHITE TITLE      │
│ ════════════════════════════ gold│
│                                  │
│ [body blanco con cards]          │
│                                  │
│                                  │
└──────────────────────────────────┘
```

### 4. Hero card (idea fuerza)

Card navy gradient con borde gold izquierdo, número badge gold, texto blanco grande con highlights gold.

### 5. Risk card

Blanca con borde rojo izquierdo (4px → 6px en hover), letter badge rojo sólido, texto dark.

### 6. Reco card

Blanca con barra gold izquierda, número badge navy/gold, ícono Lucide en gris translúcido.

### 7. Big number

Número gigante (text-8xl/9xl) en gold con label uppercase pequeño debajo.

## Iconos

Usar **Lucide** (https://lucide.dev) inline como SVG. Nunca emojis en los slides finales (ok en kickers ocasionalmente).

Set recomendado:
- `landmark` — Goberna logo
- `map-pin` — territorial
- `bar-chart-3` — análisis
- `users` — competencia / electores
- `file-search` — INFOGOB / historial
- `search` — Google / buscadores
- `globe` — digital
- `wallet` — presupuesto
- `shield` — seguridad / cierre
- `arrow-right` — CTA
- `check-circle-2` — recomendaciones
- `alert-triangle` — riesgos críticos

## Espaciado

- Slide padding: `px-6 sm:px-12 py-8 sm:py-14`
- Header band padding: `px-6 sm:px-12 py-6 sm:py-8`
- Card padding: `p-5 sm:p-6`
- Hero card padding: `p-6 sm:p-10`

## Bordes y sombras

- Cards: `rounded-2xl border border-gray-200`
- Hover: `transform: translateY(-3px); shadow-lg con tinte`
- Hero / final cards: `rounded-2xl shadow-2xl`
- Border accent (left): 4-6px del color del tipo de card

## Footer nav

Siempre presente. Contiene:
- Logo Goberna mini (G en círculo gold)
- Texto: "Goberna · [Candidato] [Tipo]"
- Dot indicator de slides
- Contador "1 / N"
- Botones prev/next (next es gold sólido)

## Anti-patrones

- ❌ Slides con scroll infinito
- ❌ Body navy con texto blanco (eso es solo para covers/divisores)
- ❌ Texto chico debajo de 14px
- ❌ Más de 5-7 cards por slide (si hay más, partir en 2 slides)
- ❌ Tablas sin header gold o navy
- ❌ Imágenes sin tratamiento (siempre `rounded-xl` mínimo)
- ❌ Mixing colors fuera de paleta
