#!/usr/bin/env python3
"""
pc-price-tracker
================

Scraper de PCs de sobremesa con RTX 5070 en PcComponentes.

Recorre el listado completo (todas las páginas), extrae los datos de cada
tarjeta de producto y los imprime por consola en una tabla. No guarda nada.

Uso:
    python scraper.py
"""

from __future__ import annotations

import random
import re
import sys
import textwrap
import time
from dataclasses import dataclass

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

GRID_SELECTOR = "#product-listing-product-grid"
CARD_SELECTOR = f"{GRID_SELECTOR} a[data-product-id]"

# "RTX 5070" pero no "RTX 5070 Ti" (con o sin espacio antes de Ti) ni "50700".
RTX_5070_RE = re.compile(r"RTX\s*5070(?!\s*Ti\b)(?!\d)", re.IGNORECASE)
RTX_5070_TI_RE = re.compile(r"RTX\s*5070\s*Ti\b", re.IGNORECASE)

OUT_OF_STOCK_RE = re.compile(
    r"agotado|sin stock|no disponible|pr[oó]ximamente", re.IGNORECASE
)

# Marcadores típicos de páginas de bloqueo / captcha.
BLOCK_MARKERS = (
    "captcha",
    "pardon our interruption",
    "access denied",
    "unusual traffic",
    "verify you are human",
    "verifying you are human",
    "just a moment",
    "verificación de seguridad",
    "verificacion de seguridad",
    "security verification",
    "attention required",
    "cf-chl",
    "datadome",
    "request blocked",
)

# ---------------------------------------------------------------------------
# Extracción en el navegador
# ---------------------------------------------------------------------------

# Se ejecuta dentro de la página. Devuelve una entrada por tarjeta de producto.
EXTRACT_JS = """
(cards) => cards.map((card) => {
  const query = (selector) => card.querySelector(selector);
  const delivery = query('[data-testid="product-card-delivery"]');
  const crossed = query('[data-e2e="crossedPrice"]');
  const price = query('[data-e2e="price-card"]');

  return {
    sku: card.getAttribute('data-product-id') || '',
    name: card.getAttribute('data-product-name') || '',
    url: card.href || '',
    price: card.getAttribute('data-product-price')
      || (price ? price.textContent : ''),
    previous_price: crossed ? crossed.textContent : '',
    delivery: delivery
      ? (delivery.innerText || '').replace(/\\s+/g, ' ').trim()
      : '',
    card_text: (card.innerText || '').replace(/\\s+/g, ' ').trim(),
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
    previous_price: float | None
    availability: str

    @property
    def discount_pct(self) -> int | None:
        """Porcentaje de descuento respecto al precio anterior/PVPR."""
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
# Utilidades
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


def clean_availability(delivery: str, card_text: str) -> str:
    if OUT_OF_STOCK_RE.search(card_text):
        return "Agotado / no disponible"

    text = re.sub(r"\s+", " ", delivery).strip()
    # "Envío gratis" es información de envío, no de disponibilidad.
    text = re.sub(r"^Env[ií]o gratis\.\s*", "", text, flags=re.IGNORECASE)
    return text or "Disponible"


def classify_gpu(name: str) -> str | None:
    """
    Devuelve 'ti' para RTX 5070 Ti, '5070' para RTX 5070 y None para el resto.
    """
    if RTX_5070_TI_RE.search(name):
        return "ti"
    if RTX_5070_RE.search(name):
        return "5070"
    return None


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


def build_product(raw: dict) -> Product | None:
    sku = (raw.get("sku") or "").strip()
    name = (raw.get("name") or "").strip()
    url = (raw.get("url") or "").strip()
    if not name or not url:
        return None

    price = parse_price(raw.get("price"))
    previous_price = parse_price(raw.get("previous_price"))
    if previous_price is not None and (price is None or previous_price <= price):
        previous_price = None

    if not sku:
        sku = url.rstrip("/").rsplit("/", 1)[-1]

    return Product(
        sku=sku,
        name=name,
        url=url,
        price=price,
        previous_price=previous_price,
        availability=clean_availability(
            raw.get("delivery") or "", raw.get("card_text") or ""
        ),
    )


# ---------------------------------------------------------------------------
# Presentación
# ---------------------------------------------------------------------------


def print_table(products: list[Product]) -> None:
    if not products:
        print("  (sin resultados)")
        return

    name_width = 52
    avail_width = 32
    header = (
        f"{'#':>3}  {'SKU':<9}  {'Producto':<{name_width}}  "
        f"{'Precio':>11}  {'Antes (PVPR)':>12}  {'Dto.':>5}  "
        f"{'Disponibilidad':<{avail_width}}"
    )
    print(header)
    print("-" * len(header))

    for index, product in enumerate(products, start=1):
        name_lines = textwrap.wrap(product.name, name_width) or [""]
        avail_lines = textwrap.wrap(product.availability, avail_width) or [""]
        price = format_price(product.price)
        previous = format_price(product.previous_price)
        discount = (
            f"-{product.discount_pct}%" if product.discount_pct is not None else "-"
        )

        for line_number in range(max(len(name_lines), len(avail_lines))):
            name_part = name_lines[line_number] if line_number < len(name_lines) else ""
            avail_part = (
                avail_lines[line_number] if line_number < len(avail_lines) else ""
            )
            if line_number == 0:
                print(
                    f"{index:>3}  {product.sku:<9}  {name_part:<{name_width}}  "
                    f"{price:>11}  {previous:>12}  {discount:>5}  "
                    f"{avail_part:<{avail_width}}"
                )
            else:
                print(
                    f"{'':>3}  {'':<9}  {name_part:<{name_width}}  "
                    f"{'':>11}  {'':>12}  {'':>5}  {avail_part:<{avail_width}}"
                )

        # URL completa en una línea propia para no truncarla.
        print(f"{'':>3}  {'':<9}  {product.url}")


def print_summary(
    products: list[Product],
    ti_products: list[Product],
    skipped: list[str],
    pages_scraped: int,
    elapsed: float,
) -> None:
    print()
    print("=" * 78)
    print("RESUMEN")
    print(f"  Páginas recorridas:          {pages_scraped}")
    print(f"  PCs con RTX 5070:            {len(products)}")
    print(f"  RTX 5070 Ti (apartadas):     {len(ti_products)}")
    print(f"  Otros descartados:           {len(skipped)}")
    print(f"  Tiempo total:                {elapsed:.1f} s")
    print("=" * 78)

    if skipped:
        print("\nProductos descartados (no llevan RTX 5070 según el nombre):")
        for name in skipped[:10]:
            print(f"  - {name}")
        if len(skipped) > 10:
            print(f"  ... y {len(skipped) - 10} más")


# ---------------------------------------------------------------------------
# Scraping
# ---------------------------------------------------------------------------


def scrape() -> tuple[list[Product], list[Product], list[str], int]:
    products: dict[str, Product] = {}
    ti_products: dict[str, Product] = {}
    skipped: list[str] = []

    pages_scraped = 0
    url: str | None = BASE_URL
    first_skus: set[str] = set()
    page_number = 1
    total_pages = 1

    def fail(message: str) -> None:
        """Lanza ScraperError conservando lo recogido hasta el momento."""
        raise ScraperError(
            message,
            products=sorted(
                products.values(), key=lambda product: product.name.lower()
            ),
            ti_products=sorted(
                ti_products.values(), key=lambda product: product.name.lower()
            ),
            skipped=list(skipped),
            pages_scraped=pages_scraped,
        )

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=HEADLESS,
            # "chromium" usa el binario completo en modo headless nuevo. El
            # "headless shell" por defecto es detectado por Cloudflare en
            # cuanto se navega a una segunda página.
            channel="chromium",
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(
            user_agent=USER_AGENT,
            locale=LOCALE,
            timezone_id=TIMEZONE,
            viewport={"width": 1440, "height": 900},
            extra_http_headers={"Accept-Language": "es-ES,es;q=0.9,en;q=0.8"},
        )
        page = context.new_page()
        referer: str | None = None

        try:
            while url and pages_scraped < MAX_PAGES:
                print(f"[Página {page_number}] Cargando {url}", flush=True)
                try:
                    response = page.goto(
                        url,
                        wait_until="domcontentloaded",
                        timeout=60_000,
                        referer=referer,
                    )
                except PlaywrightTimeoutError:
                    fail("Se agotó el tiempo de espera al cargar la página.")
                except PlaywrightError as exc:
                    fail(f"Error de navegación: {exc}")

                problem = wait_for_listing(page, response)
                if problem:
                    fail(problem)

                raw_items = page.eval_on_selector_all(CARD_SELECTOR, EXTRACT_JS)
                if not raw_items:
                    fail(
                        "El listado apareció vacío. "
                        "Puede que la web haya cambiado su estructura."
                    )

                referer = page.url

                # Protección contra paginaciones que no avanzan.
                current_first_sku = (raw_items[0].get("sku") or "").strip()
                if page_number > 1 and current_first_sku in first_skus:
                    fail(
                        "La paginación no avanza (se repiten los mismos productos). "
                        "Se detiene la ejecución."
                    )
                first_skus.add(current_first_sku)

                page_number, total_pages = pagination_state(page)
                pages_scraped += 1

                new_on_page = 0
                for raw in raw_items:
                    product = build_product(raw)
                    if product is None:
                        continue
                    if product.sku in products or product.sku in ti_products:
                        continue

                    gpu = classify_gpu(product.name)
                    if gpu == "5070":
                        products[product.sku] = product
                        new_on_page += 1
                    elif gpu == "ti":
                        ti_products[product.sku] = product
                    else:
                        skipped.append(product.name)

                print(
                    f"    {len(raw_items)} tarjetas, {new_on_page} nuevas con RTX 5070 "
                    f"(página {page_number} de {total_pages})",
                    flush=True,
                )

                if page_number >= total_pages:
                    break

                next_url = next_page_url(page)
                if not next_url:
                    next_url = f"{BASE_URL}?page={page_number + 1}"

                delay = random.uniform(MIN_DELAY_SECONDS, MAX_DELAY_SECONDS)
                print(f"    Pausa de {delay:.1f} s antes de la siguiente página...")
                time.sleep(delay)

                url = next_url
                page_number += 1

            if pages_scraped >= MAX_PAGES:
                print(
                    f"    Aviso: alcanzado el tope de {MAX_PAGES} páginas; "
                    "se detiene el recorrido.",
                    flush=True,
                )
        finally:
            context.close()
            browser.close()

    return (
        sorted(products.values(), key=lambda product: product.name.lower()),
        sorted(ti_products.values(), key=lambda product: product.name.lower()),
        skipped,
        pages_scraped,
    )


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


# ---------------------------------------------------------------------------
# Punto de entrada
# ---------------------------------------------------------------------------


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    started = time.monotonic()
    print("pc-price-tracker · PCs de sobremesa con RTX 5070 · PcComponentes")
    print(f"Listado: {BASE_URL}")
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
