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
import re
import random
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError
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

# --- Nuevas configuraciones ---
SETUP_MODE = False  # se pone a True cuando se pasa --setup
PROFILE_DIR = ".browser-profile"  # perfil persistente de Chrome
HOMEPAGE_DELAY = (3, 6)  # segundos aleatorios en la página de inicio
PAGE_DELAY = (4, 9)  # segundos aleatorios entre páginas
CHALLENGE_TIMEOUT = 30  # s máximo esperando listado tras detectar reto

# Chrome real instalado en el PC (fallback a Chromium si no existe).
# Se usa launch_persistent_context con un perfil conservador de cookies.
# Se usa launch_persistent_context con un perfil conservador de cookies.
CHROME_CHANNEL = "chrome"  # "chrome" o "chromium"; usa el installed Chrome si está disponible.

# Cloudflare puede mostrar un reto automático ("Un momento..."). Esperamos hasta 45 s
# a que se resuelva solo (título "Just a moment" / "Un momento" que desaparece, o
# aparece #product-listing-product-grid). Solo es bloqueo real si pasado ese tiempo
# sigue el reto.
CHALLENGE_WAIT_SECONDS = 45

# Marcadores de bloqueo/captcha que aparecen en el título o cuerpo de la página.
# Se utilizan en detect_block() para identificar páginas de Cloudflare o errores.
BLOCK_MARKERS = (
    "cloudflare",
    "verificación de seguridad",
    "protección de Cloudflare",
    "solicitud denied",
    "intenta más tarde",
    "capcha",
    "robot",
    "automatizado",
)

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

# Nuevo: campos de especificaciones extraídos del nombre del producto
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

EXTRACT_JS = r"""
(cards) => cards.map((card) => {
  const query = (selector) => card.querySelector(selector);
  const delivery = query('[data-testid="product-card-delivery"]');
  const crossed = query('[data-e2e="crossedPrice"]');
  const price = query('[data-e2e="price-card"]');
  const nameEl = query('[data-product-name]');
  const imageEl = query('[data-product-image]');

  return {
    sku: card.getAttribute('data-product-id') || '',
    name: nameEl?.getAttribute('data-product-name') || card.getAttribute('data-product-name') || '',
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

    text = str(value).replace("\u00a0", " ").strip()
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
    if re.search(r"agotado|sin stock|no disponible|próximamente", card_text, re.IGNORECASE):
        return "Agotado / no disponible"

    text = re.sub(r"\s+", " ", delivery).strip()
    text = re.sub(r"^Envío gratis\.\s*", "", text, flags=re.IGNORECASE)
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

def detect_block(page, response) -> str | None:
    """Devuelve el motivo si la página parece un bloqueo/captcha, si no None."""
    # Bloqueo por código HTTP
    if response is not None and response.status in (403, 429, 503):
        return f"HTTP {response.status}"

    try:
        title = page.title().lower()
    except PlaywrightError:
        return None

    # Si el grid de productos ya está visible, no es un bloqueo aunque haya marcos de Cloudflare
    try:
        grid_visible = page.locator(CARD_SELECTOR).count() > 0
    except PlaywrightError:
        grid_visible = False

    if grid_visible:
        return None  # El listado está presente, no hay bloqueo

    # Desafío de Cloudflare: intentar resolución automática (ya hizo _resolve_cloudflare_challenge arriba)
    # Si aún aparece como título de desafío tras el timeout, tratarlo como bloqueo
    challenge_titles = ["just a moment", "attention required", "un momento"]
    title_lower = title.strip().lower()
    is_challenge_title = any(t in title_lower for t in challenge_titles)

    if is_challenge_title:
        # Guardar captura y HTML para depuración
        try:
            debug_dir = Path("debug")
            debug_dir.mkdir(exist_ok=True)
            timestamp = time.strftime("%Y%m%d-%H%M%S")
            page.screenshot(path=debug_dir / f"block-{timestamp}.png")
            (debug_dir / f"block-{timestamp}.html").write_text(
                page.content(), encoding="utf-8", newline=""
            )
        except Exception:
            pass
        return "desafío de Cloudflare / captcha detectado"

    # Fallback: revisar marcadores clásicos solo si no hay grid
    try:
        body = page.locator("body").inner_text(timeout=5_000).lower()
    except PlaywrightError:
        return None

    haystack = f"{title}\n{body}"
    for marker in BLOCK_MARKERS:
        if marker in haystack:
            # Guardar captura y HTML para depuración
            try:
                debug_dir = Path("debug")
                debug_dir.mkdir(exist_ok=True)
                timestamp = time.strftime("%Y%m%d-%H%M%S")
                page.screenshot(path=debug_dir / f"block-{timestamp}.png")
                (debug_dir / f"block-{timestamp}.html").write_text(
                    page.content(), encoding="utf-8", newline=""
                )
            except Exception:
                pass
            return f"marcador de bloqueo «{marker}»"

    if len(body) < 500:
        return "respuesta vacía o demasiado corta"

    return None


def _detect_turnstile_challenge(page) -> str | None:
    """
    Detecta el reto de Turnstile de Cloudflare.
    Devuelve None si no hay desafío, o un mensaje si se detecta.
    Los desafíos detectados:
      - Texto "Verificación de seguridad en curso"
      - Iframe de Turnstile
    Si se detecta un desafío, espera hasta CHALLENGE_TIMEOUT s a que aparezca el listado.
    Si el listado aparece, devuelve None. Si no, guarda debug y devuelve mensaje.
    """

    # Marcadores de búsqueda del desafío
    challenge_text_markers = ["verificación de seguridad en curso", "turnstile"]
    challenge_iframes = page.locator("iframe[title*='turnstile'], iframe[src*='turnstile']")

    # Verificar si aparece el texto de desafío en el body o título
    try:
        body_text = page.locator("body").inner_text(timeout=3_000).lower()
        title = page.title().lower()
    except Exception:
        body_text = ""
        title = ""

    hay_desafío_texto = any(marker in body_text or marker in title for marker in challenge_text_markers)
    hay_iframe_turnstile = challenge_iframes.count() > 0

    if not hay_desafío_texto and not hay_iframe_turnstile:
        return None  # No hay desafío

    # Desafío detectado: esperar hasta CHALLENGE_TIMEOUT s a que aparezca el listado
    print(f"[{time.strftime('%H:%M:%S')}] 🛡️ Desafío de Turnstile detectado, esperando lista hasta {CHALLENGE_TIMEOUT} s...")
    deadline = time.monotonic() + CHALLENGE_TIMEOUT

    while time.monotonic() < deadline:
        try:
            if page.locator(CARD_SELECTOR).count() > 0:
                print(f"[{time.strftime('%H:%M:%S')}] ✅ Listado apareció después del desafío")
                return None
        except Exception:
            pass

        page.wait_for_timeout(1000)

    # Timeout: el grid no apareció en 30 s
    print(f"[{time.strftime('%H:%M:%S')}] ⏰ Timeout de {CHALLENGE_TIMEOUT} s sin listado después del desafío")
    # Guardar captura y HTML para depuración
    try:
        debug_dir = Path("debug")
        debug_dir.mkdir(exist_ok=True)
        timestamp = time.strftime("%Y%m%d-%H%M%S")
        page.screenshot(path=debug_dir / f"turnstile-block-{timestamp}.png")
        (debug_dir / f"turnstile-block-{timestamp}.html").write_text(
            page.content(), encoding="utf-8", newline=""
        )
    except Exception:
        pass
    return f"Desafío de Turnstile detectado y no resuelto tras {CHALLENGE_TIMEOUT} s"


def _resolve_cloudflare_challenge(page, response) -> str | None:
    """
    Resuelve el reto de Cloudflare automáticamente.
    Devuelve None si el listado quedó disponible, o un mensaje de error si sigue bloqueado.

    Lógica:
    - Si aparece #product-listing-product-grid → no hay bloqueo, devuelve None
    - Si el título es "Just a moment" / "Un momento" y luego desaparece → no hay bloqueo, devuelve None
    - Si passed el timeout y sigue el título de reto → es bloqueo real, guarda debug y devuelve mensaje
    """
    deadline = time.monotonic() + CHALLENGE_WAIT_SECONDS

    while time.monotonic() < deadline:
        try:
            if page.locator(CARD_SELECTOR).count() > 0:
                return None
        except PlaywrightError:
            pass

        if time.monotonic() >= deadline:
            break

    # Ya no llamamos a detect_block aquí porque detect_block ya maneja el caso
    # de "grid presente = no hay bloqueo". Si llegamos aquí, es que el grid
    # aún no apareció; consultamos detect_block para decidir si es bloqueo real.
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


def wait_for_listing(page, response) -> str | None:
    """
    Espera a que aparezcan las tarjetas. Devuelve None si el listado está
    disponible o un mensaje de error si sigue bloqueado / no hay listado.
    """
    # --- NUEVO: Detectar desafío de Turnstile antes de la resolución automática ---
    turnstile_result = _detect_turnstile_challenge(page)
    if turnstile_result is not None:
        # Se detectó un desafío y no se resolvió a tiempo → salir con código 2
        raise ScraperError(
            turnstile_result,
            products=[],
            ti_products=[],
            skipped=[],
            pages_scraped=0,
        )
    # --- Fin detección Turnstile ---

    # Primero, intentar resolver el reto de Cloudflare automáticamente por hasta 45 s
    result = _resolve_cloudflare_challenge(page, response)
    if result is not None:
        # Desafío no resuelto tras el timeout → bloqueo real
        raise ScraperError(result)

    # Si llegamos aquí, el listado ya apareció o se resolvió solo
    # Ahora esperar confirmación del grid (debe aparecer casi inmediatamente)
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        try:
            if page.locator(CARD_SELECTOR).count() > 0:
                return None
        except PlaywrightError:
            pass
        page.wait_for_timeout(500)

    # Ya no llamamos a detect_block aquí porque detect_block ya maneja el caso
    # de "grid presente = no hay bloqueo". Si llegamos aquí, es que el grid
    # aún no apareció; consultamos detect_block para decidir si es bloqueo real.
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


def _launch_browser(p) -> tuple:
    """Lanza el navegador y devuelve (browser, context, page)."""
    if CHROME_CHANNEL == "chrome":
        browser = p.chromium.launch(headless=HEADLESS)
    else:
        browser = p.chromium.launch(headless=HEADLESS, channel="chromium")

    context = browser.new_context(
        user_agent=USER_AGENT,
    )
    page = context.new_page()
    return browser, context, page


def setup_mode(page, base_url: str) -> None:
    """
    Modo setup: abre Chrome visible con perfil persistente, carga el listado
    y espera hasta 5 minutos a que aparezca #product-listing-product-grid.
    El usuario marca la casilla a mano. Al aparecer el listado o al cerrar la
    ventana, imprime el resultado y sale.
    """
    from pathlib import Path

    print(f"[{time.strftime('%H:%M:%S')}] 🪟 Modo setup: Chrome visible con perfil persistente")
    print(f"[{time.strftime('%H:%M:%S')}] 📄 Cargando: {base_url}")

    # Navegar a la página principal
    page.goto(base_url, timeout=60_000)

    # Esperar a que aparezca el grid o hasta 5 minutos
    grid_selector = "#product-listing-product-grid"
    deadline = time.monotonic() + 300  # 5 minutos

    while time.monotonic() < deadline:
        try:
            if page.locator(grid_selector).count() > 0:
                print(f"[{time.strftime('%H:%M:%S')}] ✅ Listado detectado después de {int(time.monotonic() - deadline + 300)} s")
                # Captura de pantalla para confirmación
                try:
                    debug_dir = Path("debug")
                    debug_dir.mkdir(exist_ok=True)
                    timestamp = time.strftime("%Y%m%d-%H%M%S")
                    page.screenshot(path=debug_dir / f"setup-{timestamp}.png")
                except Exception:
                    pass
                print(f"[{time.strftime('%H:%M:%S')}] 👋 Cierra la ventana del navegador para salir del modo setup")
                # Esperar a que el usuario cierre la ventana
                page.wait_for_event("close")
                print(f"[{time.strftime('%H:%M:%S')}] 👋 Modo setup finalizado")
                return
        except Exception:
            pass

        remaining = int(deadline - time.monotonic())
        if remaining % 30 == 0 or remaining <= 30:
            print(f"[{time.strftime('%H:%M:%S')}] ⏳ Esperando listado... falta {remaining}s (máx 5 min)")

        page.wait_for_timeout(1000)

    # Timeout: el grid no apareció en 5 minutos
    print(f"[{time.strftime('%H:%M:%S')}] ⏰ Timeout de 5 minutos sin detectar el listado")
    print(f"[{time.strftime('%H:%M:%S')}] 👋 Cierra la ventana del navegador para salir del modo setup")
    try:
        page.wait_for_event("close")
    except Exception:
        pass
    print(f"[{time.strftime('%H:%M:%S')}] 👋 Modo setup finalizado (timeout)")


def build_product(card_data, specs: dict[str, str]) -> Product | None:
    """Build a Product object from card data and extracted specifications."""
    try:
        price = parse_price(card_data.get('price') or card_data.get('previous_price'))
        previous_price = parse_price(card_data.get('previous_price'))

        # Build Product object
        product = Product(
            sku=card_data.get('sku', '') or '',
            name=card_data.get('name') or '',
            url=card_data.get('url') or '',
            price=price,
            previous_price=previous_price,
            availability=clean_availability(
                card_data.get('delivery', '') or '',
                card_data.get('card_text', '') or '',
            ),
            cpu=specs.get('cpu', ''),
            ram=specs.get('ram', ''),
            ssd=specs.get('ssd', ''),
            gpu=specs.get('gpu', ''),
            marca=specs.get('marca', ''),
        )
        return product
    except Exception:
        return None


def load_history() -> list[dict]:
    """Carga el histórico de precios desde el fichero CSV."""
    import csv
    history = []
    if HISTORY_FILE.exists():
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f, fieldnames=HISTORY_FIELDS)
                for row in reader:
                    history.append(row)
        except Exception:
            pass
    return history


def save_run(products_with_history: list[tuple[Product, list[dict]]]) -> dict:
    """Guarda el historial de la corrida actual."""
    from datetime import datetime

    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)

        # Leer histórico existente
        history = load_history()

        # Añadir nuevas observaciones
        ahora = datetime.now()
        fecha_str = ahora.strftime("%Y-%m-%d")
        hora_str = ahora.strftime("%H:%M:%S")

        for product, _ in products_with_history:
            # Buscar si ya existe una fila para este SKU en la fecha de hoy
            hoy_exists = any(
                row.get("sku") == product.sku and row.get("fecha") == fecha_str
                for row in history
            )
            if not hoy_exists:
                history.append({
                    "fecha": fecha_str,
                    "hora": hora_str,
                    "sku": product.sku,
                    "precio": product.price if product.price is not None else "",
                    "precio_anterior": product.previous_price if product.previous_price is not None else "",
                    "descuento": "",
                    "disponibilidad": product.availability,
                })

        # Escribir historial actualizado
        with open(HISTORY_FILE, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=HISTORY_FIELDS)
            writer.writerows(history)

        # Return summary
        return {
            "total_products": len(products_with_history),
            "new_entries": sum(
                1 for _, _ in products_with_history
                if any(row.get("sku") == product.sku and row.get("fecha") == fecha_str
                       for row in history)
                for product in [product for product, _ in products_with_history]
            ),
            "date": fecha_str,
        }
    except Exception as e:
        raise OSError(f"Error guardando el historial: {e}")


def print_results(products, ti_products, skipped, pages_scraped, elapsed, partial: bool = False) -> None:
    """Imprime los resultados del scrapeo en la consola."""
    # Header
    print("pc-price-tracker · PCs de sobremesa con RTX 5070 · PcComponentes")
    print(f"Listado: {BASE_URL}")
    print(f"Guardado: {'desactivado (--no-save)' if partial else 'activado (data/)'}")
    print()

    # Summary
    total = len(products) + len(ti_products)
    print(f"Total: {total} PCs")
    print(f"Ofertas TI: {len(ti_products)}")
    print(f"Productos normales: {len(products)}")
    print(f"Páginas recorridas: {pages_scraped}")
    print(f"Tiempo: {elapsed:.1f} s")
    print()

    # Products table
    print("-" * 100)
    print(f"{'SKU':<15} {'Nombre':<40} {'Precio':<12} {'Disponibilidad':<20}")
    print("-" * 100)

    for product in products:
        print(f"{product.sku:<15} {product.name[:38]:<40} {str(product.price):<12} {product.availability[:18]:<20}")

    for product in ti_products:
        print(f"{product.sku:<15} {product.name[:38]:<40} {str(product.price):<12} {product.availability[:18]:<20} ***TI***")

    print("-" * 100)
    print(f"SKU skippeados: {len(skipped)}")
    if skipped:
        for sku in skipped[:10]:
            print(f"  - {sku}")
        if len(skipped) > 10:
            print(f"  - ... y {len(skipped) - 10} más")


def print_save_summary(summary: dict) -> None:
    """Imprime un resumen del guardado."""
    print()
    print("-" * 50)
    print("Resumen de guardado")
    print("-" * 50)
    print(f"Fecha: {summary.get('date', 'N/A')}")
    print(f"Productos totales: {summary.get('total_products', 0)}")
    print(f"Nuevas entradas: {summary.get('new_entries', 0)}")
    print("Historial guardado en: data/history.csv")


# ---------------------------------------------------------------------------
# Punto de entrada principal
# ---------------------------------------------------------------------------

def scrape():
    """Ejecuta el scrapeo completo de la lista de productos de RTX 5070.

    Navega por todas las páginas de PcComponentes, extrae los datos de
    cada tarjeta de producto y devuelve la lista de productos, productos
    Ti, los SKU skippeados y el número de páginas recorridas.

    Returns:
        tuple: (products, ti_products, skipped, pages_scraped)
    """
    products = []
    ti_products = []
    skipped = []
    pages_scraped = 0

    with sync_playwright() as p:
        browser, context, page = _launch_browser(p)
        start_time = time.monotonic()

        print(f"[{time.strftime('%H:%M:%S')}] ✅ Navegador abierto headless")

        # Visitar la página de inicio antes de empezar (modo normal solo)
        if not SETUP_MODE:
            print(f"[{time.strftime('%H:%M:%S')}] 🏠 Visitando página de inicio: https://www.pccomponentes.com")
            page.goto("https://www.pccomponentes.com", timeout=30_000)
            # Pausa aleatoria 3-6 s para que cargen las cookies/perfil
            page.wait_for_timeout(int(random.uniform(*HOMEPAGE_DELAY) * 1000))

        try:
            print(f"[{time.strftime('%H:%M:%S')}] 📄 Cargando página principal: {BASE_URL}")
            page.goto(BASE_URL, timeout=45_000)
            # Esperar a que aparezcan las tarjetas o que haya bloqueo
            if time.monotonic() - start_time > 480:
                print(f"[{time.strftime('%H:%M:%S')}] ⏰ Límite global de 8 minutos alcanzado")
                # Guardar debug antes de detener
                try:
                    debug_dir = Path("debug")
                    debug_dir.mkdir(exist_ok=True)
                    ts = time.strftime("%Y%m%d-%H%M%S")
                    page.screenshot(path=debug_dir / f"block-{ts}.png")
                    (debug_dir / f"block-{ts}.html").write_text(
                        page.content(), encoding="utf-8", newline=""
                    )
                except Exception:
                    pass
                raise ScraperError(
                    "Límite global de 8 minutos alcanzado",
                    products=products,
                    ti_products=ti_products,
                    skipped=skipped,
                    pages_scraped=pages_scraped,
                )

            result = wait_for_listing(page, None)
            if result is not None:
                raise ScraperError(result)

            print(f"[{time.strftime('%H:%M:%S')}] 📄 Página principal cargada, esperando reto")

            pages_scraped = 1

            while pages_scraped < MAX_PAGES:
                # Extraer productos de la página actual usando el JS de extracción
                cards = page.locator(CARD_SELECTOR).element_handles()
                card_count = len(cards)
                if card_count == 0:
                    break

                # Ejecutar extracción en todas las tarjetas a la vez
                card_data_list = page.evaluate(EXTRACT_JS, cards)

                for i in range(card_count):
                    card_data = card_data_list[i]
                    try:
                        # Build specifications from name
                        specs = extract_specifications(card_data.get('card_text') or '')

                        # Build Product object
                        product = build_product(card_data, specs)

                        if product is not None:
                            if product.name.lower().find('ti') >= 0 or product.gpu.lower().find('ti') >= 0:
                                ti_products.append(product)
                            else:
                                products.append(product)
                    except Exception:
                        skipped.append(card_data.get('sku', 'unknown') or f'card-{i}')
                        continue

                    # Intentar navegar a la siguiente página
                    next_url = next_page_url(page)
                    if next_url is None:
                        break

                    if time.monotonic() - start_time > 480:
                        print(f"[{time.strftime('%H:%M:%S')}] ⏰ Límite global de 8 minutos alcanzado")
                        # Guardar debug antes de detener
                        try:
                            debug_dir = Path("debug")
                            debug_dir.mkdir(exist_ok=True)
                            ts = time.strftime("%Y%m%d-%H%M%S")
                            page.screenshot(path=debug_dir / f"block-{ts}.png")
                            (debug_dir / f"block-{ts}.html").write_text(
                                page.content(), encoding="utf-8", newline=""
                            )
                        except Exception:
                            pass
                        raise ScraperError(
                            "Límite global de 8 minutos alcanzado",
                            products=products,
                            ti_products=ti_products,
                            skipped=skipped,
                            pages_scraped=pages_scraped,
                        )

                    print(f"[{time.strftime('%H:%M:%S')}] 📄 Cargando página {pages_scraped + 1}")
                    page.goto(next_url, timeout=45_000)
                    pages_scraped += 1

                    # Pausa aleatoria entre páginas: 4-9 s
                    page_delay = random.uniform(*PAGE_DELAY)
                    print(f"[{time.strftime('%H:%M:%S')}] ⏳ Pausa entre páginas {page_delay:.1f} s")
                    page.wait_for_timeout(int(page_delay * 1000))

                    # Verificar bloqueo en la siguiente página
                    result = wait_for_listing(page, None)
                    if result is not None:
                        raise ScraperError(result)

        except ScraperError:
            raise
        except Exception as e:
            # Si hay error inesperado, guardar debug antes de cerrar
            try:
                debug_dir = Path("debug")
                debug_dir.mkdir(exist_ok=True)
                timestamp = time.strftime("%Y%m%d-%H%M%S")
                page.screenshot(path=debug_dir / f"block-{timestamp}.png")
                (debug_dir / f"block-{timestamp}.html").write_text(
                    page.content(), encoding="utf-8", newline=""
                )
            except Exception:
                pass
            raise ScraperError(
                f"Error durante el scrapeo: {e}",
                products=products,
                ti_products=ti_products,
                skipped=skipped,
                pages_scraped=pages_scraped,
            )
        finally:
            try:
                browser.close()
            except Exception:
                pass

    return products, ti_products, skipped, pages_scraped


def next_page_url(page) -> str | None:
    """Obtiene la URL de la siguiente página, o None si no hay más."""
    try:
        next_btn = page.locator(".next-page, a.next, span.next")
        if next_btn.count() > 0 and next_btn.is_visible():
            href = next_btn.get_attribute("href")
            if href:
                from urllib.parse import urljoin
                return urljoin(BASE_URL, href)
    except Exception:
        pass
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Scraper de PCs de sobremesa con RTX 5070 en PcComponentes, "
            "con históríco de precios en data/."
        )
    )
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="No guarda el históríco en data/: solo muestra la tabla por consola.",
    )
    parser.add_argument(
        "--setup",
        action="store_true",
        help="Abre Chrome visible con perfil persistente (.browser-profile/), carga el listado y espera hasta 5 minutos a que aparezca #product-listing-product-grid. Marca la casilla a mano. Al aparecer el listado o al cerrar la ventana, imprime el resultado y sale. Sirve para que las cookies de verificación queden en el perfil que luego usa el modo normal.",
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
            "\n[AVISO] No hay productos con RTX 5070; no se guarda el históríco.",
            file=sys.stderr,
        )
        return 0

    # Build the data for save_run: pair each product with its historical rows
    history = load_history()
    
    # Para cada producto, encontrar sus filas históríricas
    products_with_history = []
    for product in products:
        # Encontrar todas las filas de histórírico para este SKU
        sku_history = [row for row in history if row["sku"] == product.sku]
        products_with_history.append((product, sku_history))
    
    try:
        summary = save_run(products_with_history)
    except (OSError, ) as exc:
        print(
            f"\n[ERROR] No se pudo guardar el históríco: {exc}",
            file=sys.stderr,
        )
        return 1

    print_save_summary(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())