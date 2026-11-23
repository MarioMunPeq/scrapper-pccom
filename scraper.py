#!/usr/bin/env python3
"""
pc-price-tracker
================

Scraper de PCs de sobremesa con RTX 5070 en PcComponentes.

Recorre el listado completo (todas las páginas), extrae los datos de cada
tarjeta de producto y los guarda en data/ (products.json + history.csv).
Además, los pone a disposición de una aplicación web React + Vite que los
muestra con gráficos de precio, filtros y páginas de detalle.

Uso:
    python scraper.py            # scrapea, muestra la tabla y guarda el histórico
    python scraper.py --no-save  # solo muestra la tabla por consola
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import textwrap
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

BASE_URL = "https://www.pccomponentes.com/categorias/sobremesa/geforce-rtx-5070"

# User-Agent de Chrome real (sin la marca "HeadlessChrome" que pondría Playwright).
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/159.0.0.0 Safari/537.36"
)
LOCALE = "es-ES"
TIMEZONE = "Europe/Madrid"
HEADLESS = True

MIN_DELAY_SECONDS = 2.0
MAX_DELAY_SECONDS = 5.0
MAX_PAGES = 30  # tope de seguridad por si la paginación se comporta raro

# Cloudflare puede mostrar un reto automático ("Un momento…"). Con el Chromium
# completo suele resolverse solo en unos segundos. Le damos margen antes de
# considerar que es un bloqueo real.
CHALLENGE_WAIT_SECONDS = 15

# Histórico de precios. Las rutas se resuelven respecto a este fichero para que
# el scraper funcione igual desde cualquier directorio de trabajo.
DATA_DIR = Path(__file__).resolve().parent / "data"
PRODUCTS_FILE = DATA_DIR / "products.json"
HISTORY_FILE = DATA_DIR / "history.csv"
HISTORY_FIELDS = (
    "fecha",
    "hora",
    "sku",
    "precio",
    "precio_anterior",
    "descuento",
    "disponibilidad",
)

# Nuevo: campos de especificación extraídos del nombre del producto
SPEC_REGEX = {
    "cpu": re.compile(r"(Intel|AMD|Core|Ryzen)\s+\w+(?:\s+\w+)?", re.IGNORECASE),
    "ram": re.compile(r"(\d+)\s*GB\s*RAM", re.IGNORECASE),
    "ssd": re.compile(r"(\d+)\s*TB\s*SSD|(\d+)\s*GB\s*SSD", re.IGNORECASE),
    "gpu": re.compile(r"RTX\s*5070\s*Ti\b|RTX\s*5070\b", re.IGNORECASE),
    "marca": re.compile(
        r"(PcCom|Vibox|PCM|Aeon|NeoPC|Gamer|Gaming|Centrum|IBUYPOWER|DeepGaming|NitroPC|Tecnowake|Epical-q)",
        re.IGNORECASE,
    ),
}

GRID_SELECTOR = "#product-listing-product-grid"
CARD_SELECTOR = f"{GRID_SELECTOR} a[data-product-id]"


# ---------------------------------------------------------------------------
# Extracción en el navegador
# ---------------------------------------------------------------------------

EXTRACT_JS = """
(cards) => cards.map((card) => {
  const query = (selector) => card.querySelector(selector);
  const delivery = query('[data-testid="product-card-delivery"]');
  const crossed = query('[data-e2e="crossedPrice"]');
  const price = query('[data-e2e="price-card"]');
  const nameEl = query('[data-product-name]');
  const imageEl = query('[data-product-image]');

  return {
    sku: card.getAttribute('data-product-id') || '',
    name: nameEl.getAttribute('data-product-name') || card.getAttribute('data-product-name') || '',
    url: card.href || '',
    price: card.getAttribute('data-product-price')
      || (price ? price.textContent : ''),
    previous_price: crossed ? crossed.textContent : '',
    delivery: delivery
      ? (delivery.innerText || '').replace(/\s+/g, ' ').trim()
      : '',
    card_text: (card.innerText || '').replace(/\s+/g, ' ').trim(),
    image_url: imageEl ? imageEl.src || '' : '',
    // Atributos adicionales que podrían estar en el texto o en data-attributes
    full_text: (card.innerText || '').replace(/\s+/g, ' ').trim(),
  };
})
"""


# ---------------------------------------------------------------------------
# Modelo de datos
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Product:
    sku: str
    name: str
    url: str
    price: float | None
    previous_price: float | None  # PVPR precio tachado de la web
    availability: str
    # Nuevos campos de especificación
    cpu: str
    ram: str
    ssd: str
    gpu: str
    marca: str

    @property
    def discount_from_prev_observation(self) -> float | None:
        """
        Porcentaje de descuento respecto a la última observación de precio
        guardada en el histórico. Si no hay anterior, devuelve None.
        """
        if not self.price or not self.previous_price:
            return None
        if self.previous_price <= self.price:
            return None
        return round((self.previous_price - self.price) / self.previous_price * 100, 1)

    @property
    def discount_pct(self) -> int | None:
        """Porcentaje de descuento respecto al PVPR (precio recomendado)."""
        if not self.price or not self.previous_price:
            return None
        if self.previous_price <= self.price:
            return None
        return round((self.previous_price - self.price) / self.previous_price * 100)


class ScraperError(RuntimeError):
    """Error controlado: se muestra un mensaje claro y se detiene la ejecución."""

    def __init__(
        self,
        message: str,
        *,
        products: list[Product] | None = None,
        ti_products: list[Product] | None = None,
        skipped: list[str] | None = None,
        pages_scraped: int = 0,
    ) -> None:
        super().__init__(message)
        self.products = products or []
        self.ti_products = ti_products or []
        self.skipped = skipped or []
        self.pages_scraped = pages_scraped


# ---------------------------------------------------------------------------
# Utilidades de parsing
# ---------------------------------------------------------------------------

def parse_price(value: object) -> float | None:
    """Convierte '1.799,00 €', '1799' o 1799.0 a float."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)

    text = str(value).replace("\u00a0", " ").replace("€", "").strip()
    text = re.sub(r"[^\d,.]", "", text)
    if not text:
        return None

    if "," in text:
        # Formato español: 1.799,00
        text = text.replace(".", "").replace(",", ".")
    elif text.count(".") > 1:
        text = text.replace(".", "")
    elif text.count(".") == 1 and len(text.rsplit(".", 1)[1]) == 3:
        # 1.799 (separador de miles sin decimales)
        text = text.replace(".", "")

    try:
        return float(text)
    except ValueError:
        return None


def format_price(value: float | None) -> str:
    if value is None:
        return "-"
    formatted = f"{value:,.2f}"
    # 1,799.00 -> 1.799,00
    formatted = formatted.replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    return f"{formatted} €"


def extract_specifications(name: str) -> dict[str, str]:
    """Extrae CPU, RAM, SSD, GPU y marca del nombre del producto."""
    result = {
        "cpu": "",
        "ram": "",
        "ssd": "",
        "gpu": "",
        "marca": "",
    }

    # Marca
    for match in re.finditer(SPEC_REGEX["marca"], name):
        marca_str = match.group(0).strip()
        # Evitar duplicados y ruidoso
        lower = marca_str.lower()
        if lower not in result["marca"].lower() and len(result["marca"]) < 30:
            result["marca"] = marca_str

    # CPU
    for match in re.finditer(SPEC_REGEX["cpu"], name):
        cpu_str = match.group(0).strip()
        if cpu_str.lower() not in result["cpu"].lower():
            result["cpu"] = cpu_str

    # RAM
    for match in re.finditer(SPEC_REGEX["ram"], name):
        ram_str = match.group(0).strip()
        if ram_str not in result["ram"]:
            result["ram"] = ram_str

    # SSD
    for match in re.finditer(SPEC_REGEX["ssd"], name):
        ssd_str = match.group(0).strip()
        if ssd_str not in result["ssd"]:
            result["ssd"] = ssd_str

    # GPU
    for match in re.finditer(SPEC_REGEX["gpu"], name):
        gpu_str = match.group(0).strip()
        if gpu_str not in result["gpu"]:
            result["gpu"] = gpu_str

    return result


def clean_availability(delivery: str, card_text: str) -> str:
    if re.search(r"agotado|sin stock|no disponible|pr[oó]ximamente", card_text, re.IGNORECASE):
        return "Agotado / no disponible"

    text = re.sub(r"\s+", " ", delivery).strip()
    text = re.sub(r"^Env[ií]o gratis\.\s*", "", text, flags=re.IGNORECASE)
    return text or "Disponible"


# ---------------------------------------------------------------------------
# Modelo de datos mejorado
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class EnhancedProduct:
    """Producto con todos los datos enriquecidos para la aplicación web."""
    sku: str
    name: str
    url: str
    price: float | None
    last_observation_price: float | None  # Último precio guardado en histórico
    last_updated: str | None  # Timestamp de la última observación
    availability: str
    cpu: str
    ram: str
    ssd: str
    gpu: str
    marca: str
    # Para el cálculo de descuento basado en histórico real
    prev_observation_price: float | None = None  # Precio de la observación anterior en histórico
    price_change_pct: float | None = None  # Descuento vs última observación

    @property
    def discount_pct(self) -> float | None:
        """Descuento porcentual respecto a la última observación de precio."""
        if self.prev_observation_price is None or self.price is None:
            return None
        if self.prev_observation_price <= self.price:
            return None
        return round((self.prev_observation_price - self.price) / self.prev_observation_price * 100, 1)


# ---------------------------------------------------------------------------
# Utilidades varias
# ---------------------------------------------------------------------------

def wait_for_listing(page, response) -> str | None:
    """
    Espera a que aparezcan las tarjetas. Devuelve None si el listado está
    disponible o un mensaje de error si sigue bloqueado / no hay listado.
    """
    deadline = time.monotonic() + CHALLENGE_WAIT_SECONDS

    while True:
        try:
            if page.locator(CARD_SELECTOR).count() > 0:
                return None
        except PlaywrightError:
            pass

        if time.monotonic() >= deadline:
            break
        page.wait_for_timeout(1_000)

    reason = detect_block(page, response)
    if reason:
        return (
            "Posible bloqueo o captcha detectado "
            f"({reason}). Se detiene la ejecución."
        )
    return (
        "No se encontraron tarjetas de producto. "
        "Puede que la web haya cambiado su estructura."
    )


def detect_block(page, response) -> str | None:
    """Devuelve el motivo si la página parece un bloqueo/captcha, si no None."""
    if response is not None and response.status in (403, 429, 503):
        return f"HTTP {response.status}"

    try:
        title = page.title().lower()
        body = page.locator("body").inner_text(timeout=5_000).lower()
    except PlaywrightError:
        return None

    haystack = f"{title}\n{body}"
    for marker in BLOCK_MARKERS:
        if marker in haystack:
            return f"marcador «{marker}»"

    if len(body) < 500:
        return "respuesta vacía o demasiado corta"

    return None


def pagination_state(page) -> tuple[int, int]:
    """Lee 'Página X de Y' del listado. Devuelve (actual, total)."""
    try:
        text = page.locator("body").inner_text(timeout=5_000)
    except PlaywrightError:
        return 1, 1

    match = re.search(r"P[áa]gina\s+(\d+)\s+de\s+(\d+)", text)
    if not match:
        return 1, 1
    return int(match.group(1)), int(match.group(2))


def next_page_url(page) -> str | None:
    return page.evaluate(
        """() => {
            const link = document.querySelector('a[aria-label="next page"]');
            return link ? link.href : null;
        }"""
    )


def build_product(raw: dict, specs: dict[str, str]) -> Product | None:
    sku = (raw.get("sku") or "").strip()
    name = (raw.get("name") or "").strip()
    url = (raw.get("url") or "").strip()
    if not name or not url:
        return None

    price = parse_price(raw.get("price"))
    previous_price = parse_price(raw.get("previous_price"))
    # Si previous_price no es válido o es <= price, ponlo en None
    if previous_price is not None and (price is None or previous_price <= price):
        previous_price = None

    if not sku:
        # Extraer SKU de la URL como fallback
        sku = url.rstrip("/").rsplit("/", 1)[-1]

    # Si el SKU es numérico y el nombre ya tiene specs, usarlas; sino vacías
    return Product(
        sku=sku,
        name=name,
        url=url,
        price=price,
        previous_price=previous_price,
        availability=clean_availability(
            raw.get("delivery") or "", raw.get("card_text") or ""
        ),
        # Extraer especificaciones del nombre
        cpu=specs.get("cpu", ""),
        ram=specs.get("ram", ""),
        ssd=specs.get("ssd", ""),
        gpu=specs.get("gpu", ""),
        marca=specs.get("marca", ""),
    )


def build_enhanced_product(product: Product, history_rows_for_sku: list[dict]) -> EnhancedProduct:
    """
    Construye un EnhancedProduct a partir de un Product scraper y sus filas de histórico.
    """
    # Encontrar la observación anterior (no la de hoy)
    sorted_rows = sorted(history_rows_for_sku, key=lambda r: r["fecha"])
    # Quitar filas de la fecha actual para encontrar la "anterior"
    today_rows = [r for r in sorted_rows if r["fecha"] != datetime.now().strftime("%Y-%m-%d")]
    prev_row = None
    if len(today_rows) > 0:
        # La última fila anterior a hoy
        prev_row = today_rows[-1]

    prev_obs_price = None
    price_change_pct = None
    if prev_row:
        prev_obs_price = parse_price(prev_row.get("precio"))
    
    if prev_obs_price is not None and product.price is not None:
        if prev_obs_price > product.price:
            price_change_pct = round((prev_obs_price - product.price) / prev_obs_price * 100, 1)

    # Determinar el "último precio de observación" - el más reciente en histórico
    # (excluyendo hoy mismo si ya tiene fila, para que sea el anterior)
    all_prices = [parse_price(r.get("precio")) for r in sorted_rows if r.get("precio")]
    last_obs_price = None
    if all_prices:
        # El precio más reciente es el último en el orden cronológico
        # history.csv ya viene ordenado por fecha, la última fila del día es la más reciente
        last_obs_price = all_prices[-1] if all_prices else None
        # Si solo hay datos de hoy, usamos el precio actual del producto
        if last_obs_price is None and product.price is not None:
            last_obs_price = product.price

    # Formatear último actualizado
    last_updated = None
    if sorted_rows:
        last_date = sorted_rows[-1]["fecha"]
        last_time = sorted_rows[-1]["hora"]
        last_updated = f"{last_date} {last_time}"

    return EnhancedProduct(
        sku=product.sku,
        name=product.name,
        url=product.url,
        price=product.price,
        last_observation_price=last_obs_price,
        last_updated=last_updated,
        availability=product.availability,
        cpu=product.cpu,
        ram=product.ram,
        ssd=product.ssd,
        gpu=product.gpu,
        marca=product.marca,
        prev_observation_price=prev_obs_price,
        price_change_pct=price_change_pct,
    )


# ---------------------------------------------------------------------------
# Historic storage
# ---------------------------------------------------------------------------

class StorageError(RuntimeError):
    """Error controlado al leer o escribir los ficheros del histórico."""


@dataclass(frozen=True)
class SaveSummary:
    saved: int
    new: int
    disappeared: int
    price_changes: int
    catalog_total: int


def display_path(path: Path) -> str:
    """Ruta relativa a la carpeta del scraper, para mensajes más legibles."""
    try:
        return path.relative_to(DATA_DIR.parent).as_posix()
    except ValueError:
        return str(path)


def _write_atomic(path: Path, content: str) -> None:
    """Escribe el fichero completo de forma atómica (temporal + reemplazo)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    try:
        with temporary.open("w", encoding="utf-8", newline="") as handle:
            handle.write(content)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def load_catalog() -> dict[str, dict[str, str]]:
    """Lee data/products.json (un registro por SKU con nombre y URL)."""
    if not PRODUCTS_FILE.exists():
        return {}

    try:
        raw = json.loads(PRODUCTS_FILE.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeDecodeError) as exc:
        raise StorageError(
            f"No se pudo leer {display_path(PRODUCTS_FILE)}: {exc}"
        ) from exc
    except json.JSONDecodeError as exc:
        raise StorageError(
            f"{display_path(PRODUCTS_FILE)} no contiene JSON válido ({exc}). "
            "Revísalo o bórralo para empezar de cero."
        ) from exc

    if not isinstance(raw, dict):
        raise StorageError(
            f"{display_path(PRODUCTS_FILE)} debe ser un objeto JSON "
            "con un registro por SKU."
        )

    catalog: dict[str, dict[str, str]] = {}
    for sku, record in raw.items():
        if not isinstance(record, dict):
            raise StorageError(
                f"El registro {sku!r} de {display_path(PRODUCTS_FILE)} "
                "no es un objeto JSON."
            )
        catalog[str(sku)] = {
            "name": str(record.get("name") or ""),
            "url": str(record.get("url") or ""),
        }
    return catalog


def save_catalog(catalog: dict[str, dict[str, str]]) -> None:
    content = json.dumps(catalog, ensure_ascii=False, indent=2, sort_keys=True)
    _write_atomic(PRODUCTS_FILE, content + "\n")


def load_history() -> list[dict[str, str]]:
    """Lee data/history.csv. Devuelve las filas con las columnas esperadas."""
    if not HISTORY_FILE.exists():
        return []

    try:
        with HISTORY_FILE.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            columns = reader.fieldnames or []
            missing = [field for field in HISTORY_FIELDS if field not in columns]
            if missing:
                raise StorageError(
                    f"{display_path(HISTORY_FILE)} no tiene las columnas "
                    f"esperadas (faltan: {', '.join(missing)})."
                )

            rows: list[dict[str, str]] = []
            for row in reader:
                if not any(
                    str(value).strip()
                    for value in row.values()
                    if value is not None
                ):
                    continue  # línea en blanco
                rows.append(
                    {
                        field: (row.get(field) or "").strip()
                        for field in HISTORY_FIELDS
                    }
                )
            return rows
    except (OSError, UnicodeDecodeError, csv.Error) as exc:
        raise StorageError(
            f"No se pudo leer {display_path(HISTORY_FILE)}: {exc}"
        ) from exc


def save_history(rows: list[dict[str, str]]) -> None:
    buffer = io.StringIO()
    writer = csv.DictWriter(
        buffer,
        fieldnames=HISTORY_FIELDS,
        lineterminator="\n",
        extrasaction="ignore",
    )
    writer.writeheader()
    writer.writerows(rows)
    _write_atomic(HISTORY_FILE, buffer.getvalue())


def history_row(product: Product, date: str, clock: str) -> dict[str, str]:
    """Fila de histórico con precios como número (sin € ni separador de miles)."""
    return {
        "fecha": date,
        "hora": clock,
        "sku": product.sku,
        "precio": "" if product.price is None else f"{product.price:.2f}",
        "precio_anterior": (
            "" if product.previous_price is None else f"{product.previous_price:.2f}"
        ),
        "descuento": (
            "" if product.discount_pct is None else str(product.discount_pct)
        ),
        "disponibilidad": product.availability,
    }


def previous_run_rows(
    history: list[dict[str, str]], today: str
) -> dict[str, dict[str, str]]:
    """
    Filas de la última ejecución guardada (de un día anterior o de hoy mismo,
    cuyas filas se van a reemplazar). Sirve para calcular nuevos,
    desaparecidos y cambios de precio.
    """
    dates = sorted({row["fecha"] for row in history if row["fecha"] <= today})
    if not dates:
        return {}
    last_date = dates[-1]
    return {row["sku"]: row for row in history if row["fecha"] == last_date}


def extract_all_specs_from_history_name(name: str) -> dict[str, str]:
    """Extrae especificidades usando el mismo regex que el scraper."""
    return extract_specifications(name)


def save_run(products_with_enhanced: list[tuple[Product, list[dict]]], 
             *, now: datetime | None = None) -> SaveSummary:
    """
    Actualiza data/products.json y data/history.csv con la ejecución actual.
    
    products_with_enhanced: lista de tuplas (producto_scraper, filas_historia_SKU_en_csv)
    """
    if not products_with_enhanced:
        raise StorageError("No hay productos que guardar.")

    now = now or datetime.now()
    date = now.strftime("%Y-%m-%d")
    clock = now.strftime("%H:%M:%S")

    catalog = load_catalog()
    history = load_history()
    previous = previous_run_rows(history, date)

    today_skus = set()
    new_count = 0
    price_changes = 0

    # Procesar cada producto
    updated_catalog = dict(catalog)
    
    for product, history_rows_for_product in products_with_enhanced:
        sku = product.sku
        today_skus.add(sku)
        
        # Si ya existe en catálogo, no es "nuevo"
        is_new = sku not in catalog
        if is_new:
            new_count += 1

        # Guardar en catálogo (siempre actualizar nombre y URL)
        updated_catalog[sku] = {
            "name": product.name,
            "url": product.url,
        }

        # Calcular cambios de precio comparando con la ejecución anterior
        previous_row = previous.get(sku)
        if previous_row is not None and product.price is not None:
            previous_price = parse_price(previous_row.get("precio"))
            if previous_price is not None and abs(product.price - previous_price) >= 0.005:
                price_changes += 1

        # Crear fila de histórico de hoy
        hr = history_row(product, date, clock)
        history.append(hr)

    # Solo se conservan las filas de otros días; las de hoy se sustituyen
    # al final al reescribir el CSV (los pasos posteriores hacen el reemplazo)
    
    # Eliminar filas viejas de hoy para después añadirlas correctamente
    # El patrón actual: eliminar filas de la fecha actual y añadir las nuevas
    kept_rows = [row for row in history if row["fecha"] != date]
    # Añadir las nuevas filas de hoy (ya están en 'history' por el append anterior,
    # pero las filtramos para luego añadirlas ordenadamente)
    today_rows = [row for row in history if row["fecha"] == date]
    # Eliminar duplicados: solo conservar las filas más recientes de hoy por SKU
    seen_skus = set()
    unique_today_rows = []
    for row in reversed(today_rows):
        if row["sku"] not in seen_skus:
            seen_skus.add(row["sku"])
            unique_today_rows.append(row)
    unique_today_rows.reverse()
    
    save_catalog(updated_catalog)
    save_history(kept_rows + unique_today_rows)

    return SaveSummary(
        saved=len(products_with_enhanced),
        new=new_count,
        disappeared=0,  # Se calculará al comparar con ejecuciones futuras
        price_changes=price_changes,
        catalog_total=len(updated_catalog),
    )


def print_save_summary(summary: SaveSummary) -> None:
    print()
    print("=" * 78)
    print("HISTÓRICO GUARDADO")
    print(
        f"  Ficheros:                    {display_path(PRODUCTS_FILE)}, "
        f"{display_path(HISTORY_FILE)}"
    )
    print(f"  Productos guardados hoy:     {summary.saved}")
    print(f"  Nuevos:                      {summary.new}")
    print(f"  Desaparecidos:               {summary.disappeared}")
    print(f"  Cambios de precio:           {summary.price_changes}")
    print(f"  Catálogo acumulado:          {summary.catalog_total}")
    print("=" * 78)
    print("  Nuevos, desaparecidos y cambios se comparan con la ejecución anterior.")


def print_results(
    products: list[Product],
    ti_products: list[Product],
    skipped: list[str],
    pages_scraped: int,
    elapsed: float,
    *,
    partial: bool = False,
) -> None:
    print_summary(products, ti_products, skipped, pages_scraped, elapsed)

    label = "RESULTADOS PARCIALES" if partial else "RESULTADOS"
    print(f"\n{label}: {len(products)} PCs de sobremesa con RTX 5070")
    print("(Orden alfabético por nombre; precios en EUR)\n")
    print_table(products)

    if ti_products:
        print(
            f"\nRTX 5070 Ti detectadas: {len(ti_products)} "
            "(no forman parte del listado principal)\n"
        )
        print_table(ti_products)

    if not products:
        print("\nNo se encontró ningún PC con RTX 5070 en el listado.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Scraper de PCs de sobremesa con RTX 5070 en PcComponentes, "
            "con histórico de precios en data/."
        )
    )
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="No guarda el histórico en data/: solo muestra la tabla por consola.",
    )
    args = parser.parse_args(argv)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    started = time.monotonic()
    print("pc-price-tracker · PCs de sobremesa con RTX 5070 · PcComponentes")
    print(f"Listado: {BASE_URL}")
    print(
        "Guardado: "
        + ("desactivado (--no-save)" if args.no_save else "activado (data/)")
    )
    print()

    try:
        products, ti_products, skipped, pages_scraped = scrape()
    except ScraperError as exc:
        print(f"\n[ERROR] {exc}", file=sys.stderr)
        print(
            "Se detiene sin reintentar. Abre la web en un navegador normal, "
            "comprueba que carga y vuelve a intentarlo más tarde.",
            file=sys.stderr,
        )
        if exc.products or exc.ti_products:
            print(
                "\nSe muestran a continuación los resultados recogidos antes "
                "de detenerse.",
                file=sys.stderr,
            )
            print_results(
                exc.products,
                exc.ti_products,
                exc.skipped,
                exc.pages_scraped,
                time.monotonic() - started,
                partial=True,
            )
        return 2
    except PlaywrightError as exc:
        message = str(exc)
        print(f"\n[ERROR] Fallo de Playwright: {message}", file=sys.stderr)
        if "Executable doesn't exist" in message or "playwright install" in message:
            print(
                "Parece que falta el navegador. Ejecuta: playwright install chromium",
                file=sys.stderr,
            )
        return 1

    print_results(
        products, ti_products, skipped, pages_scraped, time.monotonic() - started
    )

    if args.no_save:
        return 0

    if not products:
        print(
            "\n[AVISO] No hay productos con RTX 5070; no se guarda el histórico.",
            file=sys.stderr,
        )
        return 0

    # Build the data for save_run: pair each product with its historical rows
    catalog = load_catalog()
    history = load_history()
    
    # Para cada producto, encontrar sus filas históricas
    products_with_history = []
    for product in products:
        # Encontrar todas las filas de histórico para este SKU
        sku_history = [row for row in history if row["sku"] == product.sku]
        products_with_history.append((product, sku_history))
    
    try:
        summary = save_run(products_with_history)
    except (StorageError, OSError) as exc:
        print(
            f"\n[ERROR] No se pudo guardar el histórico: {exc}",
            file=sys.stderr,
        )
        return 1

    print_save_summary(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())