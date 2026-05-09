# Goberna Decks · Setup Consultor (Windows · Claude Desktop)
# Uso (PowerShell, NO la cmd vieja):
#   iwr https://electoral.goberna.club/setup-win.ps1 | iex

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Goberna Decks · Setup Consultor (Windows)" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

function Have($cmd) {
  return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

# 1. winget (debería venir con Windows 10/11)
if (-not (Have "winget")) {
  Write-Host "  ⚠️  winget no está disponible. Actualizá Windows o instalá App Installer desde la Microsoft Store."
  exit 1
}
Write-Host "✓ winget ok"

# 2. Git
if (-not (Have "git")) {
  Write-Host "▸ Instalando Git..."
  winget install --silent --id Git.Git --accept-source-agreements --accept-package-agreements
  $env:PATH = "$env:ProgramFiles\Git\cmd;" + $env:PATH
}
Write-Host "✓ Git ok"

# 3. Node.js
if (-not (Have "node")) {
  Write-Host "▸ Instalando Node.js LTS..."
  winget install --silent --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  $env:PATH = "$env:ProgramFiles\nodejs;" + $env:PATH
}
Write-Host "✓ Node $(node --version)"

# 4. Claude Desktop
$claudeExe = "$env:LOCALAPPDATA\AnthropicClaude\Claude.exe"
if (-not (Test-Path $claudeExe)) {
  Write-Host "▸ Instalando Claude Desktop..."
  winget install --silent --id Anthropic.Claude --accept-source-agreements --accept-package-agreements
  if (-not (Test-Path $claudeExe)) {
    Write-Host ""
    Write-Host "  ⚠️  No pude instalar Claude Desktop automáticamente."
    Write-Host "     Descargalo de https://claude.ai/download"
    Start-Process "https://claude.ai/download"
    exit 1
  }
}
Write-Host "✓ Claude Desktop instalado"

# 5. Clonar / actualizar repo
$workDir = "$HOME\Goberna\decks"
New-Item -ItemType Directory -Force -Path "$HOME\Goberna" | Out-Null
if (Test-Path "$workDir\.git") {
  Write-Host "▸ Actualizando kit existente en $workDir..."
  Push-Location $workDir
  git pull --ff-only
  Pop-Location
} else {
  Write-Host "▸ Clonando kit a $workDir..."
  git clone https://github.com/Goberna-Lab/goberna-decks-consultor.git $workDir
}
Write-Host "✓ Kit en $workDir"

# 6. Instalar deps del MCP server
Write-Host "▸ Instalando MCP server..."
Push-Location "$workDir\mcp-server"
npm install --silent 2>&1 | Out-Null
Pop-Location
Write-Host "✓ MCP server listo"

# 7. Token de Goberna
$tokenDir = "$HOME\.config\goberna"
$tokenFile = "$tokenDir\token"
New-Item -ItemType Directory -Force -Path $tokenDir | Out-Null
if (-not (Test-Path $tokenFile) -or ((Get-Item $tokenFile).Length -eq 0)) {
  Write-Host ""
  Write-Host "════════════════════════════════════════════════" -ForegroundColor Cyan
  Write-Host "  TOKEN GOBERNA" -ForegroundColor Cyan
  Write-Host "════════════════════════════════════════════════" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  Pegá el token que te dio el admin (no se va a ver mientras lo escribís)."
  $token = Read-Host -AsSecureString "  Token"
  $tokenPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($token)
  )
  if ($tokenPlain) {
    Set-Content -Path $tokenFile -Value $tokenPlain -NoNewline
    Write-Host "✓ Token guardado"
  } else {
    Write-Host "⚠️  Sin token. Pegalo manualmente en: $tokenFile"
  }
} else {
  Write-Host "✓ Token ya existe"
}

# 8. Configurar Claude Desktop
$claudeCfgDir = "$env:APPDATA\Claude"
$claudeCfg = "$claudeCfgDir\claude_desktop_config.json"
New-Item -ItemType Directory -Force -Path $claudeCfgDir | Out-Null

$mcpPathJson = ($workDir.Replace('\', '/') + '/mcp-server/index.mjs')
$tokenPathJson = ($tokenFile.Replace('\', '/'))

if (Test-Path $claudeCfg) {
  try {
    $cfg = Get-Content $claudeCfg -Raw | ConvertFrom-Json
  } catch {
    $cfg = [PSCustomObject]@{}
  }
} else {
  $cfg = [PSCustomObject]@{}
}

if (-not $cfg.PSObject.Properties['mcpServers']) {
  $cfg | Add-Member -MemberType NoteProperty -Name 'mcpServers' -Value ([PSCustomObject]@{})
}

# Pre-creamos el folder local donde el filesystem MCP va a guardar los decks
$outputDir = "$workDir\output"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$outputDirJson = $outputDir.Replace('\', '/')

$entry = [PSCustomObject]@{
  command = "node"
  args    = @($mcpPathJson)
  env     = [PSCustomObject]@{
    GOBERNA_API_URL    = "https://electoral.goberna.club"
    GOBERNA_TOKEN_PATH = $tokenPathJson
  }
}

# Filesystem MCP: da a Claude Desktop acceso de lectura/escritura SOLO al
# folder Goberna/decks/output. Ahí guardamos cada deck que el consultor
# trabaja para poder iterar entre sesiones.
$fsEntry = [PSCustomObject]@{
  command = "npx"
  args    = @("-y", "@modelcontextprotocol/server-filesystem", $outputDirJson)
}

if ($cfg.mcpServers.PSObject.Properties['goberna']) {
  $cfg.mcpServers.goberna = $entry
} else {
  $cfg.mcpServers | Add-Member -MemberType NoteProperty -Name 'goberna' -Value $entry
}
if ($cfg.mcpServers.PSObject.Properties['goberna-files']) {
  $cfg.mcpServers.'goberna-files' = $fsEntry
} else {
  $cfg.mcpServers | Add-Member -MemberType NoteProperty -Name 'goberna-files' -Value $fsEntry
}

$cfg | ConvertTo-Json -Depth 10 | Set-Content $claudeCfg
Write-Host "✓ MCP goberna registrado en $claudeCfg"

# 9. Final
Write-Host ""
Write-Host "════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✅  TODO LISTO" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  PASOS PARA ARRANCAR:"
Write-Host ""
Write-Host "  1. Cerrá Claude Desktop completamente (botón derecho en"
Write-Host "     la barra de tareas → Salir, no solo minimizar)"
Write-Host ""
Write-Host "  2. Abrí Claude Desktop de nuevo"
Write-Host ""
Write-Host "  3. Empezá un chat nuevo y escribí:"
Write-Host ""
Write-Host "     ────────────────────────────────────────" -ForegroundColor Yellow
Write-Host "     Listame mis candidatos de Goberna y" -ForegroundColor Yellow
Write-Host "     armemos un diagnóstico para uno de ellos." -ForegroundColor Yellow
Write-Host "     ────────────────────────────────────────" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Claude va a usar el MCP goberna para traer tu cartera"
Write-Host "  de candidatos. Si necesitás más detalle, abrí:"
Write-Host "  $workDir\docs\consultor.md"
Write-Host ""
