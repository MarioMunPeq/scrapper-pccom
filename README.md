# pc-price-tracker

Scraper sencillo en Python + Playwright que recorre el listado de **PCs de
sobremesa con RTX 5070** de PcComponentes y muestra los resultados por consola
en una tabla. Además, guarda un histórico de precios en `data/` y sirve los
datos a una aplicación web React + Vite que los muestra con gráficos de precio,
filtros y páginas de detalle.

## Flujo de trabajo diario (manual)

Este scraper se ejecuta **SIEMPRE a mano** en tu PC con Chrome visible. No usa
GitHub Actions ni cron Jobs.

### Ejecución diaria

1. Abre una terminal (PowerShell o terminal normal) en la carpeta del proyecto
2. Ejecuta:
   ```powershell
   python scraper.py
   ```
   - Se abrirá Chrome visible con tu perfil persistente
   - Se visitará la página de inicio de PcComponentes y luego el listado de RTX 5070
   - Si aparece un reto de Cloudflare/Turnstile, verás un mensaje: **"Resuelve la verificación en la ventana de Chrome"**
   - El script esperará hasta 5 minutos a que el listado cargue
   - Los resultados se mostrarán por consola con hora en cada fase
3. Si el scrapeo termina exitosamente, se mostrará un resumen con los productos encontrados

### Comandos posteriores (tú los lanzas manualmente)

Si el scraper termina sin errores, ejecuta estos comandos en tu terminal:

```powershell
git add data
git commit -m "data: precios AAAA-MM-DD"
git pull --rebase
git push
```

> **Nota**: El script `update_prices.ps1` puede ayudarte a automatizar la activación
> del entorno virtual y la ejecución, pero los commits y pushes los debes lanzar tú.

### Opciones de línea de argumentos

```powershell
python scraper.py                    # Modo normal: Chrome visible, guarda histórico
python scraper.py --no-save          # Solo muestra tabla por consola, no guarda historial
python scraper.py --headless         # Modo headless (sin interfaz gráfica)
```

### Salida esperada (resumida)

```
pc-price-tracker · PCs de sobremesa con RTX 5070 · PcComponentes
Listado: https://www.pccomponentes.com/categorias/sobremesa/geforce-rtx-5070

[2026-01-15...] 🏠 Visitando página de inicio: https://www.pccomponentes.com
[2026-01-15...] ⏳ Pausa en home 4.2 s
[2026-01-15...] 📄 Cargando página principal: https://www.pccomponentes.com/categorias/sobremesa/geforce-rtx-5070
[2026-01-15...] ⏳ Esperando a que aparezca el listado de productos...
[2026-01-15...] ✅ Listado apareció después del desafío
[2026-01-15...] 📄 Página principal cargada, listo para recorrer páginas
[2026-01-15...] 📄 Cargando página 2
[2026-01-15...] ⏳ Pausa entre páginas 5.1 s
...
[2026-01-15...] ✅ Scraper finalizado correctamente
```

### Solución de problemas

- **Desafío de Turnstile**: Si aparece "Verificación de seguridad en curso" o un iframe de Turnstile, el script imprimirá **"Resuelve la verificación en la ventana de Chrome"** y esperará hasta 5 minutos. Resuelve el desafío en la ventana de Chrome y el script continuará automáticamente.
- **Perfil bloqueado**: Si otro Chrome usa el mismo perfil, el script avisará y saldrá con código 2. Cierra la otra instancia de Chrome.
- **Timeout de 5 minutos**: Si pasado 5 minutos el listado no aparece, el script guardará captura y HTML en `debug/` y saldrá con código 2 sin escribir nada en `data/`.

## Estructura del proyecto

```
scraper.py        # Motor principal del scraper
update_prices.ps1 # Script auxiliar para activar venv y ejecutar el scraper
data/             # Historial de precios generado (products.json + history.csv)
debug/            # Capturas y HTML para depuración (solo si hay bloqueos)
web/              # Aplicación web React + Vite
.github/workflows/ # Workflows de GitHub Actions (deploy-web.yml solo)
README.md         # Este archivo
```

## Verificación estática solo

El proyecto incluye validación estática para asegurar que el código está correcto
sin necesidad de ejecutar el scraper contra la web:

- `py_compile`: compila `scraper.py` sin errores de sintaxis
- `pyflakes`: revisa errores básicos en `scraper.py`
- Validación YAML: comprueba que los workflows de GitHub son válidos

Estas verificaciones se pueden lanzar manualmente:
```powershell
py -m pyflakes scraper.py
py -m py_compile scraper.py
```

## Licencia

Uso personal/educativo.