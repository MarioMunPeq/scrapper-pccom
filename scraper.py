#!/usr/bin/env python3
"""
pc-price-tracker
================

Scraper de PCs de sobremesa con RTX 5070 en PcComponentes.

Uso (modo manual diario):
    python scraper.py                  # scrapea con Chrome visible, perfil persistente
    python scraper.py --headless       # modo headless (Chrome o Chromium)

El scraper se ejecuta SIEMPRE a mano en la PC con Chrome visible. No usa GitHub
Actions ni cron. Los resultados se muestran por consola y, si se consigue,
los datos se guardan en data/.
"""

from __future__ import annotations

import argparse
import csv
import re
import random
import sys
import time
import os
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

# --- Modo y perfil ---
HEADLESS = False  #Visible por defecto; --headless invierte este valor

# Canal de Chrome: "chrome" usa el Chrome instalado, "chromium" usa Chromium
CHROME_CHANNEL = "chrome"  # "chrome" o "chromium"; usa el installed Chrome si está disponible

# Perfil de Chrome persistente, configurable mediante PCT_PROFILE_DIR
PCT_PROFILE_DIR = os.environ.get(
    "PCT_PROFILE_DIR",
    os.path.join(os.environ.get("LOCALAPPDATA", ""), "pc-price-tracker", "browser-profile"),
)
PROFILE_DIR = PCT_PROFILE_DIR  # Ya resuelto al importar

# --- Retos de Cloudflare / Turnstile ---
# Espera máxima tras detectar desafío de Turnstile: 5 minutos a que aparezca el listado
CHALLENGE_TIMEOUT = 300  # s (5 minutos)

# Marcadores de bloqueo/captcha que aparecen en el título o cuerpo de la página.
# Estos se usan como respaldo si el grid no aparece dentro del timeout.
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

# Nuevo: campos de especificaciones extraídas del nombre del producto
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
# Utilidades varias
# ---------------------------------------------------------------------------

def profile_is_locked(profile_path: str) -> bool:
    """Comprueba si el perfil de Chrome ya está en uso (archivo de bloqueo)."""
    import msvcrt
    lock_file = os.path.join(profile_path, "Singleton", "Lock")
    try:
        # Intentar abrir el archivo de bloqueo; si falla, el perfil está libre
        f = open(lock_file, "r")
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLOCK, 1)
        f.close()
        return False
    except (FileNotFoundError, OSError):
        return True


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
# Punto de entrada y flujo principal
# ---------------------------------------------------------------------------

def _check_profile_lock(profile_path: str) -> bool:
    """
    Intenta lanzar un contexto de Chrome con ese perfil.
    Si falla por bloqueo de perfil, devuelve True.
    Playwright levantará un error si el perfil está bloqueado.
    """
    # En Windows, Chrome crea un archivo de bloqueo en el directorio del perfil
    # Comprobación simple: mirar si existe el archivo Singleton/Lock
    lock_path = os.path.join(profile_path, "Singleton", "Lock")
    if os.path.exists(lock_path):
        try:
            # Intentar leer el archivo: si otro proceso lo tiene, puede que falle
            # o que tenga contenido. Solo es una comprobación preventiva.
            with open(lock_path, "r") as f:
                content = f.read()
            # Si el archivo existe y tiene contenido, es probable que esté en uso
            return bool(content.strip())
        except Exception:
            return True
    return False


def _launch_browser(p) -> tuple:
    """Lanza el navegador y devuelve (browser, context, page)."""

    profile_path = Path(PROFILE_DIR)
    profile_path.mkdir(parents=True, exist_ok=True)

    # Comprobación de perfil bloqueado ANTES de lanzar el navegador
    if _check_profile_lock(str(profile_path)):
        print(
            f"[{time.strftime('%H:%M:%S')}] ⚠️ Perfil de Chrome en uso por otro proceso "
            f"(directorio: {PROFILE_DIR}). Cierre esa instancia y vuelva a intentar.",
            file=sys.stderr,
        )
        return None, None, None

    # Usar el channel de Chrome instalado si está disponible, fallback a Chromium
    if CHROME_CHANNEL == "chrome":
        browser = p.chromium.launch(headless=HEADLESS, channel="chrome")
    else:
        browser = p.chromium.launch(headless=HEADLESS, channel="chromium")

    context = browser.new_context(
        user_agent=USER_AGENT,
        # Directorio de perfil persistente: las cookies y estado se guardan aquí
        user_data_dir=str(profile_path),
    )
    page = context.new_page()
    return browser, context, page


def _handle_turnstile_challenge(page) -> bool:
    """
    Detecta el reto de Turnstile de Cloudflare.
    Imprime mensaje y espera hasta 5 minutos a que aparezca #product-listing-product-grid.
    Devuelve True si el listado apareció (continuar), False si timeout (salir con código 2).
    """
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
        return True  # No hay desafío, continuar

    # Desafío detectado: imprimir mensaje y esperar hasta 5 minutos
    print(f"[{time.strftime('%H:%M:%S')}] 🛡️ Desafío de Turnstile detectado")
    print(f"[{time.strftime('%H:%M:%S')}] 👉 Resuelve la verificación en la ventana de Chrome")
    print(f"[{time.strftime('%H:%M:%S')}] ⏳ Esperando listado hasta {CHALLENGE_TIMEOUT} s...")

    deadline = time.monotonic() + CHALLENGE_TIMEOUT
    appeared = False

    while time.monotonic() < deadline:
        try:
            if page.locator(CARD_SELECTOR).count() > 0:
                print(f"[{time.strftime('%H:%M:%S')}] ✅ Listado apareció después del desafío")
                appeared = True
                break
        except Exception:
            pass
        page.wait_for_timeout(1000)

    if appeared:
        return True

    # Timeout: el grid no apareció en 5 minutos
    print(f"[{time.strftime('%H:%M:%S')}] ⏰ Timeout de {CHALLENGE_TIMEOUT} s sin listado después del desafío")
    # Captura y HTML para depuración
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
    return False


def wait_for_listing(page) -> bool:
    """
    Espera a que aparezcan las tarjetas.
    Devuelve True si el listado está disponible, False si hay bloqueo/timeout.
    """
    # --- NUEVO: Detectar desafío de Turnstile antes de cualquier cosa ---
    turnstile_result = _handle_turnstile_challenge(page)
    if not turnstile_result:
        # Timeout en el desafío → salir con código 2, sin escribir en data/
        return False
    # --- Fin detección Turnstile ---

    # Si llegamos aquí, el desafío se resolvió (o no había). Ahora esperar confirmación
    # del grid (máx 10 s adicionales)
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        try:
            if page.locator(CARD_SELECTOR).count() > 0:
                return True
        except PlaywrightError:
            pass
        page.wait_for_timeout(500)

    # Ya no llamamos a detect_block aquí. Si el grid aún no apareció, es bloqueo real.
    return False


def _next_page_url(page) -> str | None:
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


def scrape() -> tuple:
    """
    Ejecuta el scrapeo completo de la lista de productos de RTX 5070.

    Returns:
        tuple: (products, ti_products, skipped, pages_scraped)
    """
    products = []
    ti_products = []
    skipped = []
    pages_scraped = 0

    global_start = time.monotonic()
    global_timeout = 12 * 60  # 12 minutos global

    with sync_playwright() as p:
        browser, context, page = _launch_browser(p)

        # Asegurar cierre en finally a continuación
        if browser is None:
            print(f"[{time.strftime('%H:%M:%S')}] ❌ No se pudo lanzar el navegador (perfil bloqueado).", file=sys.stderr)
            raise ScraperError(
                "No se pudo lanzar el navegador por perfil bloqueado",
                products=products,
                ti_products=ti_products,
                skipped=skipped,
                pages_scraped=pages_scraped,
            )

        print(f"[{time.strftime('%H:%M:%S')}] ✅ Navegador abierto visible con perfil persistente")

        try:
            # --- Visitar la home de PcComponentes antes de empezar ---
            print(f"[{time.strftime('%H:%M:%S')}] 🏠 Visitando página de inicio: https://www.pccomponentes.com")
            page.goto("https://www.pccomponentes.com", timeout=30_000)
            # Pausa aleatoria 3-6 s para que cargen las cookies/perfil
            homepage_delay = random.uniform(3, 6)
            print(f"[{time.strftime('%H:%M:%S')}] ⏳ Pausa en home {homepage_delay:.1f} s")
            page.wait_for_timeout(int(homepage_delay * 1000))

            # --- Cargar la página principal de RTX 5070 ---
            elapsed = time.monotonic() - global_start
            if elapsed > global_timeout:
                print(f"[{time.strftime('%H:%M:%S')}] ⏰ Límite global de 12 minutos alcanzado", file=sys.stderr)
                raise ScraperError(
                    "Límite global de 12 minutos alcanzado",
                    products=products,
                    ti_products=ti_products,
                    skipped=skipped,
                    pages_scraped=pages_scraped,
                )

            print(f"[{time.strftime('%H:%M:%S')}] 📄 Cargando página principal: {BASE_URL}")
            page.goto(BASE_URL, timeout=45_000)
            pages_scraped = 1

            # Esperar a que aparezcan las tarjetas (usa wait_for_listing que incluye Turnstile)
            print(f"[{time.strftime('%H:%M:%S')}] ⏳ Esperando a que aparezca el listado de productos...")
            if not wait_for_listing(page):
                # Ya imprimió su propio mensaje y guardó debug; salir con código 2
                raise ScraperError(
                    "Desafío de Cloudflare no resuelto o bloqueo detectado",
                    products=products,
                    ti_products=ti_products,
                    skipped=skipped,
                    pages_scraped=pages_scraped,
                )

            print(f"[{time.strftime('%H:%M:%S')}] 📄 Página principal cargada, listo para recorrer páginas")

            while pages_scraped < 30:  # MAX_PAGES tope de seguridad
                # Extraer productos de la página actual usando el JS de extracción
                try:
                    cards = page.locator(CARD_SELECTOR).element_handles()
                except Exception:
                    cards = []
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
                    next_url = _next_page_url(page)
                    if next_url is None:
                        break

                    # Verificar tiempo global
                    elapsed = time.monotonic() - global_start
                    if elapsed > global_timeout:
                        print(f"[{time.strftime('%H:%M:%S')}] ⏰ Límite global de 12 minutos alcanzado", file=sys.stderr)
                        raise ScraperError(
                            "Límite global de 12 minutos alcanzado",
                            products=products,
                            ti_products=ti_products,
                            skipped=skipped,
                            pages_scraped=pages_scraped,
                        )

                    print(f"[{time.strftime('%H:%M:%S')}] 📄 Cargando página {pages_scraped + 1}")
                    page.goto(next_url, timeout=45_000)
                    pages_scraped += 1

                    # Pausa aleatoria entre páginas: 4-9 s
                    page_delay = random.uniform(4, 9)
                    print(f"[{time.strftime('%H:%M:%S')}] ⏳ Pausa entre páginas {page_delay:.1f} s")
                    page.wait_for_timeout(int(page_delay * 1000))

                    # Verificar bloqueo en la siguiente página
                    if not wait_for_listing(page):
                        # Ya imprimió mensaje y guardó debug; salir con código 2
                        raise ScraperError(
                            "Desafío de Cloudflare no resuelto o bloqueo detectado en página subsiguiente",
                            products=products,
                            ti_products=ti_products,
                            skipped=skipped,
                            pages_scraped=pages_scraped,
                        )

        except ScraperError:
            raise
        except Exception as e:
            # Si hay error inesperado, guardar debug antes de cerrar
            try:
                debug_dir = Path("debug")
                debug_dir.mkdir(exist_ok=True)
                timestamp = time.strftime("%Y%m%d-%H%M%S")
                if page is not None:
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
            # Siempre cerrar context y browser
            try:
                if context is not None:
                    context.close()
            except Exception:
                pass
            try:
                if browser is not None:
                    browser.close()
            except Exception:
                pass

    return products, ti_products, skipped, pages_scraped


# JS de extracción (igual que antes)
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
# Modelo de datos mejorado
# ---------------------------------------------------------------------------

# (se mantiene EnhancedProduct y el resto de funciones auxiliares que no cambian)

# ... [Funciones que no fueron solicitadas para modificar: EnhancedProduct, detect_block, etc.]

# Para mantener el archivo compacto pero funcional, mantendremos las partes que
# sí se usan. Las funciones de detección de bloqueo que referenciaban a
# _resolve_cloudflare_challenge se eliminan ya que ahora el manejo es exclusivamente
# via Turnstile + wait_for_listing.

# Continuamos con las dataclasses y utilidades que sí se usan...

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
# Utilidades varias (parseo, formateo, etc.)
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


# ---------------------------------------------------------------------------
# Punto de entrada principal
# ---------------------------------------------------------------------------

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
        # Escritura atómica: escribir a temp y renombrar
        tmp_file = HISTORY_FILE.with_suffix(".tmp")
        with open(tmp_file, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=HISTORY_FIELDS)
            writer.writerows(history)
        tmp_file.replace(HISTORY_FILE)

        # Return summary
        new_entries = sum(
            1 for _, _ in products_with_history
            if any(row.get("sku") == product.sku and row.get("fecha") == fecha_str
                   for row in history)
            for product in [product for product, _ in products_with_history]
        )
        return {
            "total_products": len(products_with_history),
            "new_entries": new_entries,
            "date": fecha_str,
        }
    except Exception as e:
        # Si falla, removemos el temp y levantamos error
        try:
            tmp_file.unlink(missing_ok=True)
        except Exception:
            pass
        raise OSError(f"Error guardando el historial: {e}")


def print_results(products, ti_products, skipped, pages_scraped, elapsed, partial: bool = False) -> None:
    """Imprime los resultados del scrapeo en la consola."""
    print("pc-price-tracker · PCs de sobremesa con RTX 5070 · PcComponentes")
    print(f"Listado: {BASE_URL}")
    print(f"Guardado: {'desactivado (--no-save)' if partial else 'activado (data/)'}")
    print()

    total = len(products) + len(ti_products)
    print(f"Total: {total} PCs")
    print(f"Ofertas TI: {len(ti_products)}")
    print(f"Productos normales: {len(products)}")
    print(f"Páginas recorridas: {pages_scraped}")
    print(f"Tiempo: {elapsed:.1f} s")
    print()

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
# Punto de entrada de argumentos
# ---------------------------------------------------------------------------

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
        "--headless",
        action="store_true",
        help="Modo headless (sin interfaz gráfica). Por defecto Chrome visible.",
    )
    # Se elimina el flag --setup (ya no hace falta)
    args = parser.parse_args(argv)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    # Aplicar modo headless si se pidió
    global HEADLESS
    HEADLESS = args.headless

    # Mostrar la ruta del perfil que se va a usar
    print(f"[{time.strftime('%H:%M:%S')}] 📁 Perfil de Chrome: {PROFILE_DIR}")

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