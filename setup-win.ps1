# Goberna Decks · Setup Consultor (Windows)
# Uso (en PowerShell como usuario normal):
#   iwr https://electoral.goberna.club/setup-win.ps1 | iex

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "  Goberna Decks · Setup Consultor (Windows)" -ForegroundColor Yellow
Write-Host "════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host ""

# 1. Verificar winget (Windows 10 1809+ debería tenerlo)
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "❌ winget no está disponible." -ForegroundColor Red
    Write-Host "   Instalá 'App Installer' desde Microsoft Store y volvé a correr."
    exit 1
}
Write-Host "✓ winget ok"

# 2. Node.js LTS
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "▸ Instalando Node.js LTS..."
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
} else {
    Write-Host "✓ Node $(node --version) ya instalado"
}

# 3. Git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "▸ Instalando Git..."
    winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
} else {
    Write-Host "✓ Git ya instalado"
}

# Refrescar PATH para esta sesión (toma node + git recién instalados)
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# 4. Claude Code via npm global
Write-Host "▸ Instalando Claude Code..."
npm install -g "@anthropic-ai/claude-code"
Write-Host "✓ Claude Code ok"

# 5. Clonar / actualizar repo
$workDir = Join-Path $env:USERPROFILE "Goberna\decks"
$gobernaDir = Join-Path $env:USERPROFILE "Goberna"
if (-not (Test-Path $gobernaDir)) {
    New-Item -ItemType Directory -Path $gobernaDir | Out-Null
}
if (Test-Path (Join-Path $workDir ".git")) {
    Write-Host "▸ Actualizando repo existente en $workDir..."
    Push-Location $workDir
    git pull --ff-only
    Pop-Location
} else {
    Write-Host "▸ Clonando repo a $workDir..."
    git clone https://github.com/Goberna-Lab/goberna-decks-consultor.git $workDir
}
Write-Host "✓ Repo en $workDir"

# 6. PowerShell profile: agregar funciones `deck` y `deck-preview`
if (-not (Test-Path $PROFILE)) {
    New-Item -ItemType File -Path $PROFILE -Force | Out-Null
}
$marker = "# === Goberna Decks ==="
if (-not (Select-String -Path $PROFILE -Pattern ([regex]::Escape($marker)) -Quiet)) {
    $block = @"

# === Goberna Decks ===
function deck { Set-Location "`$env:USERPROFILE\Goberna\decks"; claude }
function deck-preview { Set-Location "`$env:USERPROFILE\Goberna\decks"; npm start }
function deck-update { Set-Location "`$env:USERPROFILE\Goberna\decks"; git pull --ff-only }
"@
    Add-Content -Path $PROFILE -Value $block
    Write-Host "✓ Funciones 'deck', 'deck-preview', 'deck-update' agregadas a tu perfil PowerShell"
} else {
    Write-Host "✓ Funciones ya existen en perfil PowerShell"
}

Write-Host ""
Write-Host "════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✅  Setup completo" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  PRÓXIMOS PASOS:"
Write-Host ""
Write-Host "  1. Cerrá esta PowerShell y abrí una nueva"
Write-Host "     (para que las funciones 'deck' tomen efecto)"
Write-Host ""
Write-Host "  2. Autenticá Claude:"
Write-Host "     claude /login" -ForegroundColor Yellow
Write-Host ""
Write-Host "  3. Para arrancar a generar un deck, tipeá:"
Write-Host "     deck" -ForegroundColor Yellow
Write-Host ""
Write-Host "  4. Para ver tus decks en el browser, en otra PowerShell:"
Write-Host "     deck-preview" -ForegroundColor Yellow
Write-Host "     (después abrí http://localhost:3000)"
Write-Host ""
Write-Host "  5. Si Goberna actualiza el kit, corré:"
Write-Host "     deck-update" -ForegroundColor Yellow
Write-Host ""
