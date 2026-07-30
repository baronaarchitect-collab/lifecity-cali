# =============================================================================
#  LifeCity Local · Empaquetador (lo corres TÚ, una vez, para distribuir)
# -----------------------------------------------------------------------------
#  Genera LifeCity-Local.zip con lo que el instalador necesita en el PC:
#    package\ai\        -> backend (ai\server.py + módulos) = proxy GPU /detect
#    package\detector\  -> repo 68 (PointNet++ + checkpoints entrenados)
#
#  Luego sube ese zip como Release en GitHub (o Drive con enlace directo) y
#  pon la URL en install.ps1 ($PackageUrl). O deja el zip junto a install.ps1.
# =============================================================================
$ErrorActionPreference = 'Stop'

# ---- Rutas de origen (ajusta si difieren) ----------------------------------
$RepoRoot    = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)  # ...\44. Visor
$AiSrc       = Join-Path $RepoRoot 'ai'
$DetectorSrc = 'G:\Mi unidad\6. REPOS\68 RED NEURONAL + NUBE DE PUNTOS'
# ----------------------------------------------------------------------------

$Out  = Join-Path $env:TEMP 'lifecity-package'
$Pkg  = Join-Path $Out 'package'
$Zip  = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'LifeCity-Local.zip'

function Say($m,$c='Cyan'){ Write-Host "  $m" -ForegroundColor $c }

if (Test-Path $Out) { Remove-Item $Out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Pkg | Out-Null

# --- Backend (ai\) — sin secretos ni caché ---------------------------------
Say "Copiando backend (ai\)..." 'Yellow'
$aiDst = Join-Path $Pkg 'ai'
New-Item -ItemType Directory -Force -Path $aiDst | Out-Null
Get-ChildItem $AiSrc -Force | Where-Object {
  $_.Name -notin @('__pycache__','keys.bat','data') -and $_.Name -notlike '*.log'
} | ForEach-Object { Copy-Item $_.FullName (Join-Path $aiDst $_.Name) -Recurse -Force }
# keys.bat NO se distribuye (secretos). El proxy GPU no necesita NVIDIA.

# --- Detector (repo 68) — incluye checkpoints -------------------------------
if (Test-Path $DetectorSrc) {
  Say "Copiando detector (repo 68 + modelo)..." 'Yellow'
  $detDst = Join-Path $Pkg 'detector'
  New-Item -ItemType Directory -Force -Path $detDst | Out-Null
  Get-ChildItem $DetectorSrc -Force | Where-Object {
    $_.Name -notin @('__pycache__','.git','.venv','venv','node_modules') -and $_.Name -notlike '*.log'
  } | ForEach-Object { Copy-Item $_.FullName (Join-Path $detDst $_.Name) -Recurse -Force }
  if (-not (Test-Path (Join-Path $detDst 'server.py'))) {
    Say "AVISO: no encontré detector\server.py. Ajusta el módulo uvicorn en start-lifecity-local.ps1 al entrypoint real del repo 68." 'Red'
  }
} else {
  Say "AVISO: no existe $DetectorSrc. El zip irá SIN detector; ajusta \$DetectorSrc." 'Red'
}

# --- Saneo de seguridad: quita secretos y basura en CUALQUIER nivel ---------
# Copy-Item -Recurse arrastra .env, .claude, __pycache__ anidados, etc. Los
# eliminamos aquí para NO distribuir credenciales (NVIDIA_API_KEY, R2, tokens).
Say "Saneando (quitando secretos/basura)..." 'Yellow'
$dropDirs  = @('__pycache__','.git','.github','.claude','.venv','venv','env','node_modules','.ipynb_checkpoints','data')
$dropFiles = @('.env','keys.bat','.env.local','secrets.json','settings.local.json')
Get-ChildItem $Pkg -Recurse -Force -Directory |
  Where-Object { $dropDirs -contains $_.Name } |
  ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
Get-ChildItem $Pkg -Recurse -Force -File |
  Where-Object { $dropFiles -contains $_.Name -or $_.Name -like '*.log' -or $_.Name -like '*.pyc' -or $_.Extension -in '.key','.pem','.pfx' } |
  ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
# Verificación dura: aborta si algún .env sobrevive.
$leak = Get-ChildItem $Pkg -Recurse -Force -File | Where-Object { $_.Name -eq '.env' }
if ($leak) { Say "ERROR: quedó un .env en el paquete ($($leak.FullName)). Abortando." 'Red'; exit 1 }
Say "Saneo OK (sin .env ni secretos)." 'Green'

# --- Comprimir --------------------------------------------------------------
Say "Comprimiendo -> $Zip" 'Yellow'
if (Test-Path $Zip) { Remove-Item $Zip -Force }
Compress-Archive -Path (Join-Path $Pkg '*') -DestinationPath $Zip -Force
$mb = [math]::Round((Get-Item $Zip).Length / 1MB, 1)
Say "LISTO: $Zip ($mb MB)" 'Green'
Say "Súbelo como Release y pon la URL en install.ps1 (\$PackageUrl), o déjalo aquí junto a install.ps1." 'Cyan'
