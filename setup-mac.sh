#!/bin/bash
# Goberna Decks · Setup Consultor (Mac · Claude Desktop)
# Uso: curl -fsSL https://electoral.goberna.club/setup-mac.sh | bash
#
# Hace todo en una sola corrida:
#   1. Homebrew, Node, Git
#   2. Instala Claude Desktop (cask)
#   3. Clona el kit de presentaciones
#   4. Instala el MCP server
#   5. Configura Claude Desktop para que cargue el MCP `goberna`
#   6. Te pide tu token y lo guarda
#   7. Te dice cómo arrancar

set -e

echo ""
echo "════════════════════════════════════════════════"
echo "  Goberna Decks · Setup Consultor (Mac)"
echo "════════════════════════════════════════════════"
echo ""

# 1. Xcode CLI tools
if ! xcode-select -p &>/dev/null; then
  echo "▸ Instalando Xcode Command Line Tools (puede tardar)..."
  xcode-select --install || true
  echo ""
  echo "  ⚠️  Cuando termine la instalación, volvé a correr este comando."
  exit 0
fi
echo "✓ Xcode CLI ok"

# 2. Homebrew
if ! command -v brew &>/dev/null; then
  echo "▸ Instalando Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
if [[ -f /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -f /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi
echo "✓ Homebrew ok"

# 3. Node + Git
echo "▸ Instalando Node.js + Git..."
brew install node git || true
echo "✓ Node $(node --version) · Git $(git --version | head -1)"

# 4. Claude Desktop (cask oficial Anthropic)
if [[ ! -d "/Applications/Claude.app" ]]; then
  echo "▸ Instalando Claude Desktop..."
  brew install --cask claude || {
    echo ""
    echo "  ⚠️  No pude instalar Claude Desktop automáticamente."
    echo "     Descargalo manualmente de https://claude.ai/download"
    echo "     Cuando lo tengas instalado, volvé a correr este script."
    open https://claude.ai/download
    exit 1
  }
fi
echo "✓ Claude Desktop instalado en /Applications/Claude.app"

# 5. Clonar / actualizar repo
WORKDIR="$HOME/Goberna/decks"
mkdir -p "$HOME/Goberna"
if [[ -d "$WORKDIR/.git" ]]; then
  echo "▸ Actualizando kit existente en $WORKDIR..."
  cd "$WORKDIR" && git pull --ff-only
else
  echo "▸ Clonando kit a $WORKDIR..."
  git clone https://github.com/Goberna-Lab/goberna-decks-consultor.git "$WORKDIR"
fi
echo "✓ Kit en $WORKDIR"

# 6. Instalar deps del MCP server
echo "▸ Instalando MCP server..."
(cd "$WORKDIR/mcp-server" && npm install --silent)
echo "✓ MCP server listo"

# 7. Token de Goberna
TOKEN_DIR="$HOME/.config/goberna"
TOKEN_FILE="$TOKEN_DIR/token"
mkdir -p "$TOKEN_DIR"
chmod 700 "$TOKEN_DIR"
if [[ ! -f "$TOKEN_FILE" ]] || [[ ! -s "$TOKEN_FILE" ]]; then
  echo ""
  echo "════════════════════════════════════════════════"
  echo "  TOKEN GOBERNA"
  echo "════════════════════════════════════════════════"
  echo ""
  echo "  Pegá el token que te dio el admin (vas a verlo escondido)."
  echo "  Termina con Enter:"
  echo ""
  read -rsp "  Token: " GOBERNA_TOKEN
  echo ""
  if [[ -n "$GOBERNA_TOKEN" ]]; then
    echo "$GOBERNA_TOKEN" > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
    echo "✓ Token guardado"
  else
    echo "⚠️  Sin token. Pegalo manualmente después en: $TOKEN_FILE"
  fi
else
  echo "✓ Token ya existe en $TOKEN_FILE"
fi

# 8. Configurar Claude Desktop para cargar el MCP `goberna`
CLAUDE_CFG_DIR="$HOME/Library/Application Support/Claude"
CLAUDE_CFG="$CLAUDE_CFG_DIR/claude_desktop_config.json"
mkdir -p "$CLAUDE_CFG_DIR"

# Patch idempotente: agregamos/reemplazamos solo la entry `goberna`
# Pre-crear folder de output para filesystem MCP
OUTPUT_DIR="$WORKDIR/output"
mkdir -p "$OUTPUT_DIR"

node --experimental-vm-modules - <<NODE
const fs = require('node:fs');
const path = ${JSON.stringify("$CLAUDE_CFG")};
const mcpPath = ${JSON.stringify("$WORKDIR/mcp-server/index.mjs")};
const tokenPath = ${JSON.stringify("$TOKEN_FILE")};
const outputDir = ${JSON.stringify("$OUTPUT_DIR")};

let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(path, 'utf8'));
} catch { /* archivo nuevo */ }

cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers.goberna = {
  command: 'node',
  args: [mcpPath],
  env: {
    GOBERNA_API_URL: 'https://electoral.goberna.club',
    GOBERNA_TOKEN_PATH: tokenPath,
  },
};
// Filesystem MCP: acceso de lectura/escritura SOLO al folder
// Goberna/decks/output. Ahí guardamos cada deck que el consultor
// trabaja para iterar entre sesiones.
cfg.mcpServers['goberna-files'] = {
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', outputDir],
};

fs.writeFileSync(path, JSON.stringify(cfg, null, 2));
console.log('✓ MCPs goberna + goberna-files registrados en', path);
NODE

# 9. Final
echo ""
echo "════════════════════════════════════════════════"
echo "  ✅  TODO LISTO"
echo "════════════════════════════════════════════════"
echo ""
echo "  PASOS PARA ARRANCAR:"
echo ""
echo "  1. Cerrá Claude Desktop completamente (CMD+Q, no solo cerrar la ventana)"
echo ""
echo "  2. Abrí Claude Desktop de nuevo"
echo ""
echo "  3. Empezá un chat nuevo y escribí esto:"
echo ""
echo "     ────────────────────────────────────────"
echo "     Listame mis candidatos de Goberna y"
echo "     armemos un diagnóstico para uno de ellos."
echo "     ────────────────────────────────────────"
echo ""
echo "  Claude va a usar el MCP \`goberna\` para traer tu cartera"
echo "  de candidatos. Vas a poder verlos en la lista, elegir uno"
echo "  y trabajar la presentación."
echo ""
echo "  Si necesitás más detalle, abrí: $WORKDIR/docs/consultor.md"
echo ""
