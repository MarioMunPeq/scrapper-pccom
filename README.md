# pc-price-tracker

Scraper sencillo en Python + Playwright que recorre el listado de **PCs de
sobremesa con RTX 5070** de PcComponentes y muestra los resultados por consola
en una tabla. Además, guarda un histórico de precios en `data/` y sirve los
datos a una aplicación web en React + Vite.

- Listado: <https://www.pccomponentes.com/categorias/sobremesa/geforce-rtx-5070>
- Extrae por producto: **nombre, URL, precio actual, precio anterior (PVPR),
  descuento y disponibilidad**.
- Recorre **todas las páginas** del listado con pausas aleatorias de 2 a 5
  segundos entre páginas.
- Usa el **SKU** (`data-product-id`) como identificador único.
- Si detecta un **bloqueo o captcha**, se detiene y avisa (no reintenta).
- Guarda un **histórico de precios** en `data/` (`products.json` y
  `history.csv`). Con `--no-save` solo imprime por consola.

## Requisitos

- Python 3.10 o superior.
- Playwright (se instala con `pip`) y su Chromium.
- Node.js 18+ y npm (para la aplicación web).

## Instalación

```powershell
cd pc-price-tracker

python -m venv .venv
.\.venv\Scripts\Activate.ps1

pip install -r requirements.txt
playwright install chromium

# Para la web (opcional):
cd web
npm install
```

> En macOS/Linux la activación del entorno virtual es
> `source .venv/bin/activate`.

> Si PowerShell bloquea la activación del entorno, ejecuta antes:
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.

## Uso

```powershell
python scraper.py            # scrapea, muestra la tabla y guarda el histórico
python scraper.py --no-save  # solo muestra la tabla por consola
```

Salida esperada (resumida):

```
pc-price-tracker · PCs de sobremesa con RTX 5070 · PcComponentes
Listado: https://www.pccomponentes.com/categorias/sobremesa/geforce-rtx-5070

[Página 1] Cargando https://www.pccomponentes.com/categorias/sobremesa/geforce-rtx-5070
    40 tarjetas, 40 nuevas con RTX 5070 (página 1 de 17)
    Pausa de 3.4 s antes de la siguiente página...
...
[Página 17] Cargando https://www.pccomponentes.com/categorias/sobremesa/geforce-rtx-5070?page=17
    6 tarjetas, 6 nuevas con RTX 5070 (página 17 de 17)

==============================================================================
RESUMEN
  Páginas recorridas:          17
  PCs con RTX 5070:            646
  RTX 5070 Ti (apartadas):     0
  Otros descartados:           0
  Tiempo total:                81.2 s
==============================================================================

RESULTADOS: 646 PCs de sobremesa con RTX 5070
```

Si el guardado está activado, al final se añade un bloque `HISTÓRICO GUARDADO`:

```
==============================================================================
HISTÓRICO GUARDADO
  Ficheros:                    data/products.json, data/history.csv
  Productos guardados hoy:     646
  Nuevos:                      0
  Desaparecidos:               0
  Cambios de precio:           12
  Catálogo acumulado:          651
==============================================================================
  Nuevos, desaparecidos y cambios se comparan con la ejecución anterior.
```

## Integración con GitHub Actions

Este proyecto incluye un workflow de GitHub Actions para ejecutar el scraper de
forma automática y repetida.

### Activarlo

1. Push o pull request este repositorio (o crear los archivos si es nuevo).
2. Entra en la pestaña **Actions** del repositorio en github.com.
3. Deberías ver el workflow **pc-price-tracker**. Si no aparece, haz clic en
   "I have a .github/workflows" o en "New workflow".
4. GitHub lo detectará automáticamente por el archivo
   `.github/workflows/scrape.yml`.

### Primeros pasos después de activarlo

- El workflow se ejecutará **diariamente a las 11:00 UTC** (horario de Madrid en
  invierno).
- La primera ejecución creará la carpeta `data/` en el repositorio y poblará
  `products.json` y `history.csv`.
- Las ejecuciones posteriores reemplazarán las filas del día actual en
  `history.csv`, manteniendo solo la última ejecución de cada día.

### Lanzarlo a mano

1. Ve a la pestaña **Actions** en github.com.
2. Haz clic en el workflow **pc-price-tracker**.
3. En la parte superior derecha, pulka en **"Run workflow"** (el botón verde).
4. Opcionalmente, añade un motivo en el campo "Enter a reason for the run".
5. Pulka en **Run workflow**. La ejecución aparecerá en tiempo real.

### Si Cloudflare bloquea en CI

El workflow está preparado para lidiar con los retos de Cloudflare de la
siguiente manera:

- El scraper usa el **Chromium completo** (`playwright install --with-deps
  chromium`) y el argumento `--disable-blink-features=AutomationControlled`.
- Si la página devuelve `403`/`429` con la pantalla "Un momento…", el script
  espera hasta **15 s** a que el reto se resuelva automáticamente. Si no se
  resuelve, el job de GitHub Actions **fallará** con código de salida `2` y un
  mensaje claro en los logs.
- **No se reintenta**: tal y como dice el requisito, ante un bloqueo real se
  detiene y avisa. No hay bucle de reintentos infinitos.

### Si el job falla y no quieres que commitee data/

- El workflow solo commiteará `data/` si el scraper termina exitosamente (código
  de salida `0`) **y** hay cambios detectados en la carpeta `data/`.
- Si el scraper falla (bloqueo, error de red, etc.), el job fallará y **no se
  commiteará nada** en `data/`. El estado quedará como "failed" en la pestaña
  Actions, y los logs mostrarán el motivo (por ejemplo, "Posible bloqueo o
  captcha detectado").

### Solución de problemas

- **Job queda parado o lento**: las pausas aleatorias de 2-5 s entre páginas pueden
  hacer que tarde más de 2 minutos. El workflow tiene `timeout-minutes: 120` de
  seguridad.
- **No se crean ficheros data/**: asegúrate de estar usando `python scraper.py`
  (sin `--no-save`) en el workflow; el modo `--no-save` no escribe nada en disco.
- **Error de permisos**: el workflow tiene `permissions: contents: write` para
  poder commitear `data/`. Si aún así falla, revisa que la cuenta o bot tiene
  permisos de escritura en el repositorio.

## Histórico de precios

La primera ejecución crea automáticamente la carpeta `data/`:

- **`data/products.json`**: catálogo acumulado, con un registro por SKU:

  ```json
  {
    "11011276": {
      "name": "PcCom Imperial AMD Ryzen 7 5700X / RTX 5070 / Windows 11 Home",
      "url": "https://www.pccomponentes.com/pccom-imperial-..."
    }
  }
  ```

  Si cambian el nombre o la URL de un producto, se actualizan. Los productos
  que dejan de aparecer **no se borran**: simplemente no tendrán fila ese día.

- **`data/history.csv`**: formato largo, una fila por producto y día:

  ```csv
  fecha,hora,sku,precio,precio_anterior,descuento,disponibilidad
  2026-11-23,09:10:55,10650846,2489.00,3659.00,32,"Entrega a partir del martes, 24 de noviembre"
  ```

  - `fecha` (`YYYY-MM-DD`) y `hora` (`HH:MM:SS`) usan la hora local del equipo.
  - `precio` y `precio_anterior` son números (punto decimal, sin `€` ni
    separador de miles); quedan vacíos si no hay dato.
  - `precio_anterior` es el **PVPR** (precio tachado), no siempre un precio
    anterior real.
  - `descuento` es el porcentaje entero respecto al PVPR (`32` = 32 %); vacío
    si no hay descuento.
  - El fichero se guarda en UTF-8 y el texto se entrecomilla solo cuando hace
    falta (por ejemplo, disponibilidad con comas).

**Varias ejecuciones el mismo día**: antes de escribir, se eliminan las filas
de la fecha actual y se añaden las de esta ejecución, de modo que solo queda la
última del día (sin duplicados). El resto de fechas se conserva.

**Bloqueos**: si el scraper se detiene por captcha o bloqueo, muestra los
resultados parciales por consola pero **no escribe nada** en el histórico, para
no guardar datos incompletos.

Las escrituras son atómicas (fichero temporal + reemplazo) para no corromper el
histórico si el proceso se interrumpe.

## Aplicación web React + Vite

Este repositorio incluye una aplicación web en el directorio `web/` que
visualiza el historial de precios generado por el scraper.

### Estética

- **Oscura y técnica**, tipo terminal de trading.
- Tipografía mono (`Fira Code`) para el cuerpo y una display con carácter para
  títulos.
- Un solo color de acento: verde técnico (`#00d4aa`), sin gradientes morados
  genéricos.
- Sin diseños complejos: solo lo esencial, alto contraste.

### Estructura

```
web/
  index.html       Punto de entrada HTML con base `/scrapper-pccom/` para GitHub Pages
  vite.config.ts   Configuración de Vite (base, plugins React)
  tsconfig.json    TypeScript configurado
  src/
    main.tsx       Punto de entrada React
    App.tsx        Componente principal con todas las secciones
    style.css      Estilos CSS oscuro, mono, un acento
  scripts/
    build-prices.js Script de Node que lee ../data/history.csv y products.json
                   y genera web/public/data/prices.json
    package.json   Dependencias mínima (sin chart librerías pesadas)
  public/
    data/
      prices.json   Generado por el script de build (serie por SKU + estadísticas)
```

### Script de build (`web/scripts/build-prices.js`)

El script se ejecuta en **prebuild** y realiza las siguientes tareas:

1. Lee `../data/history.csv` y `products.json` desde la raíz del repositorio.
2. Genera `web/public/data/prices.json` con la serie de precios por SKU y las
   siguientes estadísticas:
   - `currentPrice`: precio actual (el más reciente en el histórico).
   - `previousPrice`: precio anterior en el histórico.
   - `discount`: porcentaje de descuento respecto al PVPR (máximo histórico).
   - `minPriceHistorico`: precio mínimo histórico.
   - `maxPriceHistorico`: precio máximo histórico.
   - `variation7d`: variación porcentual simulada en 7 días.
   - `totalRegistros`: número de días con datos en el histórico.
   - `attributes`: objeto con campos extraídos del nombre por regex:
     `cpu`, `ram`, `ssd`, `marca`.
   - `hito`: etiqueta si la última fecha coincide con Black Friday,
     Cyber Monday, Navidad, Reyes o rebajas de enero.
   - `esMuestra`: `true` si hay menos de 3 días de histórico.
   - `motivoMuestra`: mensaje explicando por qué se usan datos de muestra.
2. Si el histórico tiene **menos de 3 días**, usa datos de muestra deterministas
   y marca `esMuestra: true` con un `motivoMuestra` claro:
   `"DATOS DE EJEMPLO: histórico con menos de 3 días. Se muestran datos
   deterministas para demostrar la funcionalidad."`.
3. Extrae atributos del nombre del producto usando regex:
   - `CPU`: busca `Intel`, `AMD`, `Core`, `Ryzen`.
   - `RAM`: busca patrones `16GB`, `32GB`, etc.
   - `SSD`: busca `1TB SSD`, `512GB SSD`, etc.
   - `Marca`: busca `PcCom`, `Vibox`, `PCM`, `NeoPC`, `Gamer`, `Gaming`, `Centrum`.
4. No usa librerías de gráficas pesadas; los gráficos de precio en la vista de
   detalle se generan con SVG propio.
5. El script se ejecuta con `npm run build` o `node web/scripts/build-prices.js`.

### Secciones de la aplicación

La aplicación tiene las siguientes vistas/secciones:

**Hero con KPIs globales**

- Número total de PCs en el histórico.
- Precio medio, precio máximo y precio mínimo.
- Porcentaje de mayor bajada observada.

**Listado filtrable y ordenable**

- **Búsqueda**: filtrado por texto en el nombre del producto.
- **Rango de precio**: filtro de precio mínimo/máximo.
- **Marca CPU**: filtro por `Intel` o `AMD`.
- **RAM**: filtro por `16GB`, `32GB`, etc.
- **Solo con descuento**: muestra solo los productos que tienen descuento.
- **Ordenable** por nombre, precio o descuento.

**Ranking de mayores bajadas**

- Lista de los 5 productos con mayor porcentaje de descuento respecto al PVPR.
- Muestra el nombre (recortado) y el porcentaje.

**Ranking de mínimos históricos**

- Lista de los precios más bajos observados por producto.

**Vista de detalle por PC**

- Gráfico de precio en SVG propio (línea temporal con marcadores).
- Marcadores verticales para hitos clave:
  - **Black Friday** (27/11)
  - **Cyber Monday** (30/11)
  - **Navidad** (25/12)
  - **Reyes** (6/1)
  - **Rebajas de enero** (a partir del 5/1)
- Tabla de atributos extraídos (CPU, RAM, SSD, Marca).
- Botón/enlace al producto en PcComponentes ( usando el SKU como identificador).
- Indicador si el precio actual es un mínimo histórico.

**Routing por hash**

- `#/pc/SKU` para ver la detalle de un producto concreto.
- Base configurada para GitHub Pages en `/scrapper-pccom/`.

### Despliegue en GitHub Pages

Hay un workflow separado que despliega la aplicación web:

```yaml
name: Deploy Web

on:
  push:
    paths:
      - web/**      # any change under web/
      - .github/workflows/scrape.yml  # después de un run de scrape
  workflow_dispatch:
  workflow_run:
    workflows: ["pc-price-tracker"]  # espera a que termine el scraper
    types: [completed]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run build script
        run: npm run build

      - name: Deploy to GitHub Pages
        uses: actions/deploy-pages@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          folder: web/dist
          pages-command: npm run build
          keep-history: false
```

- Si el scraper falló, la web se despliega igualmente con los datos existentes
  (los que haya en `data/prices.json` generados en ejecuciones anteriores o
  datos de muestra).
- Permissions necesarias: `contents: write`, `id-token: write` para
  `actions/deploy-pages`.
- La URL del sitio será `https://<usuario>.github.io/<repo>/` (ajustado por la
  base `/scrapper-pccom/`).

## Notas

- **Precio anterior / PVPR**: PcComponentes muestra como precio tachado el
  **PVPR** (precio de venta recomendado), no siempre un precio anterior real.
  Se extrae de `data-e2e="crossedPrice"` y solo se muestra si es mayor que el
  precio actual.
- **Filtro RTX 5070**: se aceptan nombres con `RTX 5070`, `RTX5070`, etc. Las
  variantes **RTX 5070 Ti** se excluyen de la tabla principal y se muestran
  aparte, al final. Cualquier otro producto del listado que no mencione RTX
  5070 en el nombre se descarta y se cuenta en el resumen.
- **Disponibilidad**: se toma del texto de entrega de la propia tarjeta
  ("Entrega mañana", "Entrega a partir del…"). Si la tarjeta indica agotado o
  sin stock, se muestra como tal.
- **Paginación**: se sigue el enlace "página siguiente" del listado; si no
  existe pero se conoce el total de páginas, se usa `?page=N`. Incluye un tope
  de 30 páginas y una comprobación para no repetir productos.
- **Anti-bloqueo**: User-Agent de Chrome real, `locale` `es-ES`, zona horaria
  `Europe/Madrid`, una sola sesión secuencial y esperas aleatorias de 2 a 5 s
  entre páginas. Se usa el binario completo de Chromium en modo headless nuevo
  (`channel="chromium"`), porque el "headless shell" por defecto es detectado
  por Cloudflare.
- **Retos de Cloudflare**: el sitio puede devolver un `429`/`403` con la
  pantalla "Un momento…". El script espera hasta **15 s** a que ese reto
  automático se resuelva; si no se resuelve, termina con código de salida `2`
  y un mensaje claro. No reintenta indefinidamente.
- **Resultados parciales**: si se detiene por bloqueo, muestra igualmente los
  productos que ya había recogido, indicando que son parciales, pero **no
  escribe en el histórico**.
- **Rutas del histórico**: `data/` se resuelve respecto a `scraper.py`, no al
  directorio desde el que se ejecuta el comando.
- El navegador se ejecuta en modo *headless* por defecto. Para verlo, cambia
  `HEADLESS = True` a `False` en `scraper.py`.
- Si PcComponentes cambia el HTML, los selectores a revisar están agrupados al
  principio de `scraper.py` (`GRID_SELECTOR`, `CARD_SELECTOR`) y en `EXTRACT_JS`.
- Uso personal/educativo: respeta los términos de uso y el `robots.txt` del
  sitio, y no ejecutes el scraper en bucle ni en paralelo.

## Licencia

Uso personal/educativo.