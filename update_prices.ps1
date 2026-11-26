Set-Location -Path $PSScriptRoot

$port = 9222
$profileDir = Join-Path $env:LOCALAPPDATA "pc-price-tracker\chrome-profile"
$listUrl = "https://www.pccomponentes.com/categorias/sobremesa/geforce-rtx-5070"
$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

function Test-DebugPort {
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:$port/json/version" -UseBasicParsing -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        return $false
    }
}

# 1. Entorno Python
if (-not (Test-Path $python)) {
    Write-Host "Creando entorno virtual..."
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { Write-Host "No se pudo crear el .venv" -ForegroundColor Red; exit 1 }
    & $python -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { Write-Host "Fallo instalando dependencias" -ForegroundColor Red; exit 1 }
}

# 2. Chrome con puerto de depuracion y perfil propio
if (Test-DebugPort) {
    Write-Host "Chrome ya esta abierto con el puerto $port."
} else {
    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    $chrome = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $chrome) { Write-Host "No encuentro chrome.exe" -ForegroundColor Red; exit 1 }

    Write-Host "Abriendo Chrome con perfil propio..."
    Start-Process -FilePath $chrome -ArgumentList @(
        "--remote-debugging-port=$port",
        "--user-data-dir=`"$profileDir`"",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
        $listUrl
    )

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        if (Test-DebugPort) { $ready = $true; break }
    }
    if (-not $ready) {
        Write-Host "Chrome no abrio el puerto $port en 30 s" -ForegroundColor Red
        exit 1
    }
}

# 3. Espera a que resuelvas la verificacion y veas el listado
Write-Host ""
Write-Host "En la ventana de Chrome comprueba que se ve el listado (si sale la verificacion, resuelvela ahi)." -ForegroundColor Yellow
Read-Host "Cuando veas el listado cargado, pulsa Enter"

# 4. Scraper
$env:PYTHONIOENCODING = "utf-8"
& $python -u scraper.py
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Write-Host ""
    Write-Host "El scraper termino con codigo $exitCode. No se ha guardado nada. Mira debug\ si existe." -ForegroundColor Red
    exit $exitCode
}

$today = Get-Date -Format "yyyy-MM-dd"
Write-Host ""
Write-Host "Scrape completado. Para subir los datos, ejecuta:" -ForegroundColor Green
Write-Host "  git add data"
Write-Host "  git commit -m `"data: precios $today`""
Write-Host "  git pull --rebase"
Write-Host "  git push"