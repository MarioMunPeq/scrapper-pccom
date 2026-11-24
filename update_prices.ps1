# update_prices.ps1
# Script para ejecutar el scraper de forma manual en la PC.
# No hace commit ni push; solo muestra los comandos que el usuario debe lanzar.

# 1. Crear/activar .venv e instalar dependencias si hace falta
$venv_path = Join-Path -Path . -ChildPath ".venv"
$python_path = Join-Path -Path $venv_path -ChildPath "Scripts\python.exe"

if (-Not (Test-Path $python_path)) {
    Write-Host "🔧 Creando entorno virtual .venv..."
    python -m venv $venv_path
}

Write-Host "🔧 Instalizando dependencias..."
& $python_path -m pip install --upgrade pip
& $python_path -m pip install -r requirements.txt

# Activamos el venv para la sesión actual
& $venv_path\Scripts\Activate.ps1

# 2. Ejecutar el scraper
Write-Host "▶️ Ejecutando scraper..." -ForegroundColor Cyan
python scraper.py
$scraper_exit_code = $LASTEXITCODE

if $scraper_exit_code -ne 0 {
    Write-Host "❌ El scraper terminó con código de salida: $scraper_exit_code" -ForegroundColor Red
    exit $scraper_exit_code
}

# 3. Si el scraper terminó bien, mostrar resumen y comandos para el usuario
Write-Host "✅ Scraper finalizado correctamente" -ForegroundColor Green
Write-Host ""
Write-Host "Ahora ejecuta estos comandos manualmente:"
Write-Host "  git add data"
Write-Host "  git commit -m ""data: precios $(Get-Date -Format 'yyyy-MM-dd')"""
Write-Host "  git pull --rebase"
Write-Host "  git push"
Write-Host ""
Write-Host "Nota: El script no realiza el commit ni el push automáticamente."