# pc-price-tracker

Scraper sencillo en Python + Playwright que recorre el listado de **PCs de
sobremesa con RTX 5070** de PcComponentes y muestra los resultados por consola
en una tabla.

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

## Instalación

```powershell
cd pc-price-tracker

python -m venv .venv
.\.venv\Scripts\Activate.ps1

pip install -r requirements.txt
playwright install chromium
```

> En macOS/Linux la activación del entorno virtual es
> `source .venv/bin/activate`.
>
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
...
  #  SKU       Producto                           Precio       Antes (PVPR)  Dto.  Disponibilidad
---  --------  ---------------------------------  -----------  ------------  ----  --------------------------------
  1  11011276  PcCom Imperial AMD Ryzen 7 5700X /   1.799,00 €    2.299,00 €  -22%  Entrega mañana
              RTX 5070 / Windows 11 Home
              https://www.pccomponentes.com/pccom-imperial-...
```

Ejecución de referencia: **17 páginas y 646 productos** (el listado completo en el
momento de la prueba).

Si el guardado está activado, al final se añade:

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
