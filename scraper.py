#!/usr/bin/env python3
"""
pc-price-tracker
===============

Scraper de PCs de sobremesa con RTX 5070 en PcComponentes.

Uso (modo manual diario):
    python scraper.py                  # scrapea con Chrome visible, perfil persistente
    python scraper.py --headless       # modo headless (Chrome o Chromium)

El scraper se ejecuta SIEMPRE a mano en la PC con Chrome visible. No usa GitHub
Actions ni cron. Los resultados se muestran por consola y, si se consiguen,
los datos se guardan en data/. El scraper se conecta a Chrome ya abierto
por el usuario en http://127.0.0.1:9222.
"""

from __future__ import annotations

import random
import argparse
import csv
import json
import math
import os
import re
import sys
import time
import faulthandler
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

BASE_URL = "https://www.pccomponentes.com/categorias/sobremesa/geforce-rtx-5070"

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
DEFAULT_DATA_DIR = Path(__file__).resolve().parent / "data"


def _env_data_dir() -> Path:
    """Directorio de datos configurado con PCT_DATA_DIR (si existe)."""
    raw = os.environ.get("PCT_DATA_DIR", "").strip()
    if not raw:
        return DEFAULT_DATA_DIR
    return Path(raw).expanduser().resolve()


DATA_DIR = _env_data_dir()
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

# Volcado de seguridad con los productos recogidos, justo antes de guardar.
DEBUG_DIR = Path(__file__).resolve().parent / "debug"
LAST_SCRAPE_FILE = DEBUG_DIR / "last_scrape.json"


def configure_data_dir(path: str | Path | None) -> None:
    """Cambia el directorio de datos en tiempo de ejecución (--data-dir)."""
    global DATA_DIR, PRODUCTS_FILE, HISTORY_FILE
    if path is None:
        DATA_DIR = _env_data_dir()
    else:
        DATA_DIR = Path(path).expanduser().resolve()
    PRODUCTS_FILE = DATA_DIR / "products.json"
    HISTORY_FILE = DATA_DIR / "history.csv"

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

# Detección estricta de RTX 5070 Ti: exige "5070" seguido (con espacio o guion
# opcional) de "ti" como palabra completa. No debe confundirse con "Ultimate",
# "Titan", "Fireborn", etc.
RTX_5070_TI_RE = re.compile(r"5070\s*[-]?\s*ti\b", re.IGNORECASE)

GRID_SELECTOR = "#product-listing-product-grid"
CARD_SELECTOR = f"{GRID_SELECTOR} a[data-product-id]"

# --- Paginación ---
# El listado se sirve con ?page=N y 40 artículos por página.
ITEMS_PER_PAGE = 40
MAX_PAGES = 25

# --- Watchdog ---
# Si pasan 120 s sin progreso, faulthandler vuelca la pila de todos los hilos y
# termina el proceso (exit code 1) en lugar de quedarse colgado.
WATCHDOG_TIMEOUT = 120

# Expresión usada con page.wait_for_function después de cada page.goto.
WAIT_CARDS_EXPR = (
    "document.querySelectorAll('#product-listing-product-grid a[data-product-id]').length > 0"
)

# JS autocontenido (sin argumentos): número de tarjetas del DOM.
CARD_COUNT_JS = f"() => document.querySelectorAll('{CARD_SELECTOR}').length"

# JS autocontenido: total de artículos del listado ("648 artículos").
TOTAL_ITEMS_JS = r"""
() => {
  const text = document.body ? (document.body.innerText || '') : '';
  const match = text.match(/(\d[\d.\s]*)\s*art[ií]culos/i);
  if (!match) return null;
  const digits = match[1].replace(/[^\d]/g, '');
  if (!digits) return null;
  const total = parseInt(digits, 10);
  return Number.isFinite(total) ? total : null;
}
"""

# JS autocontenido: sondeo del reto de Turnstile.
TURNSTILE_PROBE_JS = r"""
() => {
  const body = document.body ? (document.body.innerText || '') : '';
  return {
    body_text: body.toLowerCase(),
    title: (document.title || '').toLowerCase(),
    turnstile_iframes: document.querySelectorAll(
      "iframe[title*='turnstile'], iframe[src*='turnstile']"
    ).length,
  };
}
"""

# JS autocontenido: texto de la página para buscar marcadores de bloqueo.
PAGE_TEXT_JS = r"""
() => {
  const body = document.body ? (document.body.innerText || '') : '';
  return (body + ' ' + (document.title || '')).toLowerCase();
}
"""


# ---------------------------------------------------------------------------
# Utilidades varias
# ---------------------------------------------------------------------------

def format_price(value: float | None) -> str:
    if value is None:
        return "-"
    formatted = f"{value:,.2f}"
    # 1,799.00 -> 1.799,00
    formatted = formatted.replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    return f"{formatted} €"


def is_rtx_5070_ti(name: str) -> bool:
    """True solo si el nombre contiene una RTX 5070 Ti real."""
    return bool(RTX_5070_TI_RE.search(name or ""))


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


@dataclass
class ScrapeStats:
    """Métricas del recorrido para comparar tarjetas leídas y artículos del listado."""

    pages_scraped: int = 0
    cards_total: int = 0
    unique_skus: int = 0
    duplicate_cards: int = 0
    listing_total: int | None = None


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
        stats: "ScrapeStats | None" = None,
    ) -> None:
        super().__init__(message)
        self.products = products or []
        self.ti_products = ti_products or []
        self.skipped = skipped or []
        self.pages_scraped = pages_scraped
        self.stats = stats


# ---------------------------------------------------------------------------
# Punto de entrada y flujo principal
# ---------------------------------------------------------------------------

def _connect_to_chrome_cdp() -> tuple:
    """
    Conecta a Chrome existente vía CDP en http://127.0.0.1:9222.

    Reutiliza la pestaña que el usuario ya tiene abierta en
    pccomponentes.com/categorias (la visible). Si no existe, abre una nueva y la
    trae al frente.

    Devuelve (browser, context, page, page_created) o sale con código 2 si no
    hay conexión.
    """
    try:
        p = sync_playwright().start()
        browser = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        # Usar el contexto existente (el primer contexto del usuario)
        context = browser.contexts[0]
    except Exception:
        print(
            f"[{time.strftime('%H:%M:%S')}] ❌ No se pudo conectar a Chrome en http://127.0.0.1:9222",
            file=sys.stderr,
        )
        print(
            "    Asegúrate de haber lanzado Chrome con --remote-debugging-port=9222",
            file=sys.stderr,
        )
        print("    Ejecuta update_prices.ps1 para iniciar Chrome con depuración remota.",
            file=sys.stderr,
        )
        sys.exit(2)

    # Buscar la pestaña del listado que el usuario tiene abierta
    page = None
    for candidate in context.pages:
        try:
            if "pccomponentes.com/categorias" in (candidate.url or ""):
                page = candidate
                break
        except Exception:
            continue

    if page is not None:
        print(
            f"[{time.strftime('%H:%M:%S')}] ♻️ Reutilizando pestaña abierta: {page.url}"
        )
        return browser, context, page, False

    page = context.new_page()
    try:
        page.bring_to_front()
    except Exception:
        pass
    return browser, context, page, True


def _handle_turnstile_challenge(page) -> bool:
    """
    Detecta el reto de Turnstile de Cloudflare usando page.evaluate (sin Locators).
    Imprime mensaje y espera hasta 5 minutos a que aparezca el listado.
    Devuelve True si el listado apareció (continuar), False si timeout (salir con código 2).
    """
    challenge_text_markers = ["verificación de seguridad en curso", "turnstile"]

    try:
        probe = page.evaluate(TURNSTILE_PROBE_JS)
    except Exception:
        probe = {}

    body_text = str(probe.get("body_text") or "")
    title = str(probe.get("title") or "")
    turnstile_iframes = int(probe.get("turnstile_iframes") or 0)

    hay_desafío_texto = any(marker in body_text or marker in title for marker in challenge_text_markers)
    hay_iframe_turnstile = turnstile_iframes > 0

    if not hay_desafío_texto and not hay_iframe_turnstile:
        return True  # No hay desafío, continuar

    # Desafío detectado: imprimir mensaje y esperar hasta 5 minutos
    print(f"[{time.strftime('%H:%M:%S')}] 🛡️ Desafío de Turnstile detectado")
    print(f"[{time.strftime('%H:%M:%S')}] 👉 Resuelve la verificación en la ventana de Chrome")
    print(f"[{time.strftime('%H:%M:%S')}] ⏳ Esperando listado hasta {CHALLENGE_TIMEOUT} s...")

    deadline = time.monotonic() + CHALLENGE_TIMEOUT

    while time.monotonic() < deadline:
        # Rearmar el watchdog en cada sondeo: el usuario puede tardar hasta 5 min
        # en resolver el reto, pero un evaluate colgado sigue matando el proceso.
        _arm_watchdog()
        if _count_cards(page) > 0:
            print(f"[{time.strftime('%H:%M:%S')}] ✅ Listado apareció después del desafío")
            return True
        page.wait_for_timeout(1000)

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


def _count_cards(page) -> int:
    """Número de tarjetas del listado, leído con page.evaluate (sin Locators)."""
    try:
        return int(page.evaluate(CARD_COUNT_JS))
    except Exception:
        return 0


def _page_looks_blocked(page) -> bool:
    """Comprueba marcadores de bloqueo/captcha en el texto de la página."""
    try:
        text = str(page.evaluate(PAGE_TEXT_JS) or "")
    except Exception:
        return False
    return any(marker in text for marker in BLOCK_MARKERS)


def _detect_listing_totals(page) -> tuple[int | None, int | None]:
    """
    Lee el total de artículos del listado ("648 artículos") y calcula el nº de
    páginas (total / 40, redondeando hacia arriba).

    Devuelve (total_articulos, total_paginas). Ambos son None si no se puede leer.
    """
    try:
        total_items = page.evaluate(TOTAL_ITEMS_JS)
    except Exception:
        return None, None

    if not isinstance(total_items, (int, float)) or total_items <= 0:
        return None, None
    total = int(total_items)
    return total, max(1, math.ceil(total / ITEMS_PER_PAGE))


def _page_url(page_num: int) -> str:
    """URL del listado para una página concreta (?page=1, ?page=2, ...)."""
    return f"{BASE_URL}?page={page_num}"


def _arm_watchdog() -> None:
    """Cancela el watchdog anterior y lo rearma (120 s sin progreso → exit)."""
    try:
        faulthandler.cancel_dump_traceback_later()
    except Exception:
        pass
    faulthandler.dump_traceback_later(WATCHDOG_TIMEOUT, exit=True)


def wait_for_listing(page) -> bool:
    """
    Espera a que aparezcan las tarjetas.
    Devuelve True si el listado está disponible, False si hay bloqueo/timeout.
    """
    # Detectar desafío de Turnstile antes de cualquier cosa
    if not _handle_turnstile_challenge(page):
        # Timeout en el desafío → salir con código 2, sin escribir en data/
        return False

    # Esperar el grid tras el page.goto (sin Locators)
    try:
        page.wait_for_function(WAIT_CARDS_EXPR, timeout=30_000)
        return True
    except Exception:
        pass

    # Margen extra por si el listado aparece justo después del timeout
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        if _count_cards(page) > 0:
            return True
        page.wait_for_timeout(500)

    return False


def scrape() -> tuple:
    """
    Ejecuta el scrapeo completo de la lista de productos de RTX 5070.

    Returns:
        tuple: (products, ti_products, skipped, stats)
    """
    products = []
    ti_products = []
    skipped = []
    stats = ScrapeStats()
    seen_skus: set[str] = set()

    global_start = time.monotonic()
    global_timeout = 12 * 60  # 12 minutos global

    browser, context, page, page_created = _connect_to_chrome_cdp()

    print(f"[{time.strftime('%H:%M:%S')}] ✅ Conectado a Chrome del usuario")

    # --- Configuración de timeouts y watchdog ---
    context.set_default_timeout(30_000)
    page.set_default_navigation_timeout(45_000)
    if page_created:
        try:
            page.bring_to_front()
        except Exception:
            pass

    # Watchdog: 120 s sin progreso → volcar la pila y terminar el proceso.
    _arm_watchdog()

    try:
        detected_pages: int | None = None
        total_pages = MAX_PAGES
        truncated = False
        ended_empty = False
        page_num = 1

        while page_num <= total_pages:
            elapsed = time.monotonic() - global_start
            if elapsed > global_timeout:
                print(f"[{time.strftime('%H:%M:%S')}] ⏰ Límite global de 12 minutos alcanzado", file=sys.stderr)
                raise ScraperError(
                    "Límite global de 12 minutos alcanzado",
                    products=products,
                    ti_products=ti_products,
                    skipped=skipped,
                    pages_scraped=stats.pages_scraped,
                    stats=stats,
                )

            url = _page_url(page_num)
            if page_num == 1:
                print(f"[{time.strftime('%H:%M:%S')}] 📄 Cargando página principal: {url}")
            else:
                print(f"[{time.strftime('%H:%M:%S')}] 📄 Cargando página {page_num}: {url}")

            page.goto(url, timeout=45_000)

            # Tras cada goto: esperar a que el grid tenga tarjetas (Turnstile incluido).
            if not wait_for_listing(page):
                # Una página sin tarjetas puede ser el final natural del listado.
                if (
                    page_num > 1
                    and _count_cards(page) == 0
                    and not _page_looks_blocked(page)
                ):
                    print(
                        f"[{time.strftime('%H:%M:%S')}] 📄 La página {page_num} no tiene "
                        "tarjetas: fin del listado"
                    )
                    ended_empty = True
                    break
                raise ScraperError(
                    f"Desafío de Cloudflare no resuelto o bloqueo detectado en la página {page_num}",
                    products=products,
                    ti_products=ti_products,
                    skipped=skipped,
                    pages_scraped=stats.pages_scraped,
                    stats=stats,
                )

            # En la primera página se lee el total de artículos ("648 artículos")
            # y se calcula el nº de páginas (40 artículos/página).
            if page_num == 1:
                listing_total, detected_pages = _detect_listing_totals(page)
                stats.listing_total = listing_total
                if detected_pages is None:
                    print(
                        f"[{time.strftime('%H:%M:%S')}] 📊 No se pudo leer el total de "
                        "artículos: se recorrerá hasta una página sin tarjetas"
                    )
                else:
                    print(
                        f"[{time.strftime('%H:%M:%S')}] 📊 Listado: "
                        f"{listing_total} artículos → {detected_pages} páginas "
                        f"({ITEMS_PER_PAGE} artículos/página)"
                    )
                    if detected_pages > MAX_PAGES:
                        truncated = True
                        print(
                            f"[{time.strftime('%H:%M:%S')}] ⚠️ El listado supera el límite "
                            f"de {MAX_PAGES} páginas",
                            file=sys.stderr,
                        )
                    total_pages = min(detected_pages, MAX_PAGES)

            # Extraer productos con JS autocontenido (sin Locators ni ElementHandles).
            try:
                card_data_list = page.evaluate(EXTRACT_JS_SELF_CONTAINED)
            except Exception:
                card_data_list = []

            if not card_data_list:
                if detected_pages is not None and page_num < detected_pages:
                    raise ScraperError(
                        f"La página {page_num} no devolvió tarjetas y se esperaban "
                        f"{detected_pages} páginas: datos incompletos",
                        products=products,
                        ti_products=ti_products,
                        skipped=skipped,
                        pages_scraped=stats.pages_scraped,
                    stats=stats,
                    )
                break

            stats.cards_total += len(card_data_list)

            for i, card_data in enumerate(card_data_list):
                sku = str(card_data.get("sku") or "").strip()
                if sku:
                    if sku in seen_skus:
                        stats.duplicate_cards += 1
                        continue
                    seen_skus.add(sku)

                try:
                    # Build specifications from name
                    specs = extract_specifications(card_data.get('card_text') or '')

                    # Build Product object
                    product = build_product(card_data, specs)

                    if product is not None:
                        # Detección estricta: "Ultimate" o "Titan" no son Ti.
                        if is_rtx_5070_ti(product.name):
                            ti_products.append(product)
                        else:
                            products.append(product)
                except Exception:
                    skipped.append(sku or f'card-{i}')

            stats.pages_scraped = page_num
            stats.unique_skus = len(seen_skus)
            print(
                f"[{time.strftime('%H:%M:%S')}] ✅ Página {page_num} completada: "
                f"{len(card_data_list)} tarjetas"
            )

            # Página completada: cancelar y rearmar el watchdog.
            _arm_watchdog()

            # Pausa aleatoria entre páginas: 4-9 s
            if page_num < total_pages:
                page_delay = random.uniform(4, 9)
                print(f"[{time.strftime('%H:%M:%S')}] ⏳ Pausa entre páginas {page_delay:.1f} s")
                page.wait_for_timeout(int(page_delay * 1000))

            page_num += 1

        # No se escriben datos si el recorrido quedó incompleto.
        if truncated:
            raise ScraperError(
                f"Listado incompleto: hay {detected_pages} páginas y el límite es {MAX_PAGES}",
                products=products,
                ti_products=ti_products,
                skipped=skipped,
                pages_scraped=stats.pages_scraped,
                stats=stats,
            )
        if ended_empty and detected_pages is not None and stats.pages_scraped < detected_pages:
            raise ScraperError(
                f"Listado incompleto: se recorrieron {stats.pages_scraped} de {detected_pages} páginas",
                products=products,
                ti_products=ti_products,
                skipped=skipped,
                pages_scraped=stats.pages_scraped,
                stats=stats,
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
            pages_scraped=stats.pages_scraped,
            stats=stats,
        )
    finally:
        # Cancelar el watchdog de faulthandler
        try:
            faulthandler.cancel_dump_traceback_later()
        except Exception:
            pass
        # Cerrar solo la pestaña si la abrimos nosotros (nunca la del usuario)
        if page_created:
            try:
                page.close()
            except Exception:
                pass
        # Desconectar browser de CDP (no cierra la ventana de Chrome del usuario)
        try:
            browser.close()
        except Exception:
            pass

    return (
        sorted(products, key=lambda product: product.name.lower()),
        sorted(ti_products, key=lambda product: product.name.lower()),
        skipped,
        stats,
    )


# JS de extracción autocontenido: selecciona las tarjetas desde la página
# en lugar de recibir ElementHandles como argumento (lo que causaba el cuelgue).
EXTRACT_JS_SELF_CONTAINED = r"""
() => {
  const grid = document.querySelector('#product-listing-product-grid');
  if (!grid) return [];
  const cards = grid.querySelectorAll('a[data-product-id]');
  return Array.from(cards).map((card) => {
    const query = (selector) => card.querySelector(selector);
    const delivery = query('[data-testid="product-card-delivery"]');
    const crossed = query('[data-e2e="crossedPrice"]');
    const priceEl = query('[data-e2e="price-card"]');
    const nameEl = query('[data-product-name]');
    const imageEl = query('[data-product-image]');

    return {
      sku: card.getAttribute('data-product-id') || '',
      name: nameEl?.getAttribute('data-product-name') || card.getAttribute('data-product-name') || '',
      url: card.href || '',
      price: card.getAttribute('data-product-price')
        || (priceEl ? priceEl.textContent : ''),
      previous_price: crossed ? crossed.textContent : '',
      delivery:
        delivery
          ? (delivery.innerText || '').replace(/\\s+/g, ' ').trim()
          : '',
      card_text: (card.innerText || '').replace(/\\s+/g, ' ').trim(),
      image_url: imageEl ? imageEl.src || '' : '',
      full_text: (card.innerText || '').replace(/\\s+/g, ' ').trim(),
    };
  });
}
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

# Continuamos con las dataclasses y utilidades que sí usamos...

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


# ---------------------------------------------------------------------------
# Histórico en disco
# ---------------------------------------------------------------------------


def load_history() -> list[dict]:
    """Carga el histórico de precios desde el fichero CSV."""
    if not HISTORY_FILE.exists():
        return []

    try:
        with open(HISTORY_FILE, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            columns = reader.fieldnames or []
            if not columns:
                return []  # fichero vacío
            missing = [field for field in HISTORY_FIELDS if field not in columns]
            if missing:
                raise OSError(
                    f"{HISTORY_FILE} no tiene las columnas esperadas "
                    f"(faltan: {', '.join(missing)})"
                )

            history = []
            for row in reader:
                if not any(
                    str(value).strip()
                    for value in row.values()
                    if value is not None
                ):
                    continue  # línea en blanco
                history.append(
                    {
                        field: (row.get(field) or "").strip()
                        for field in HISTORY_FIELDS
                    }
                )
            return history
    except OSError:
        raise
    except (UnicodeDecodeError, csv.Error) as exc:
        raise OSError(f"No se pudo leer {HISTORY_FILE}: {exc}") from exc


def history_row(product: Product, fecha: str, hora: str) -> dict[str, str]:
    """Fila del CSV con el formato de siempre (precios con 2 decimales)."""
    return {
        "fecha": fecha,
        "hora": hora,
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


def _write_history(rows: list[dict]) -> None:
    """Escritura atómica del CSV (mismas columnas y CRLF que el histórico actual)."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp_file = HISTORY_FILE.with_name(HISTORY_FILE.name + ".tmp")
    try:
        with open(tmp_file, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=HISTORY_FIELDS)
            writer.writeheader()
            writer.writerows(rows)
        tmp_file.replace(HISTORY_FILE)
    except Exception:
        try:
            tmp_file.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def save_run(products: list[Product], *, now: datetime | None = None) -> dict:
    """
    Guarda la observación actual en el histórico.

    - Si ya hay filas de esa misma fecha, se reemplazan (no se duplican).
    - Si la fecha es nueva, se añaden al final.
    - Los precios se escriben con 2 decimales, como siempre.
    """
    try:
        if not products:
            raise OSError("No hay productos que guardar.")

        ahora = now or datetime.now()
        fecha_str = ahora.strftime("%Y-%m-%d")
        hora_str = ahora.strftime("%H:%M:%S")

        # Deduplicar por SKU por si la entrada viene de un JSON externo.
        unique_products: list[Product] = []
        seen: set[str] = set()
        for product in products:
            if product.sku:
                if product.sku in seen:
                    continue
                seen.add(product.sku)
            unique_products.append(product)

        history = load_history()
        previous_skus = {
            row["sku"] for row in history if row["fecha"] != fecha_str
        }
        replaced_rows = sum(1 for row in history if row["fecha"] == fecha_str)

        # Solo se conservan las filas de otras fechas; las de esta fecha se sustituyen.
        kept_rows = [row for row in history if row["fecha"] != fecha_str]
        today_rows = [
            history_row(product, fecha_str, hora_str)
            for product in sorted(unique_products, key=lambda item: item.sku)
        ]
        # Orden cronológico por fecha y SKU, igual que el histórico existente.
        rows = sorted(kept_rows + today_rows, key=lambda row: (row["fecha"], row["sku"]))

        _write_history(rows)

        return {
            "date": fecha_str,
            "time": hora_str,
            "total_products": len(unique_products),
            "new_skus": sum(
                1 for product in unique_products if product.sku not in previous_skus
            ),
            "replaced_rows": replaced_rows,
            "history_rows": len(rows),
            "history_dates": len({row["fecha"] for row in rows}),
            "history_file": str(HISTORY_FILE),
        }
    except OSError as exc:
        raise OSError(f"Error guardando el historial: {exc}") from exc
    except Exception as exc:
        raise OSError(f"Error guardando el historial: {exc}") from exc


# ---------------------------------------------------------------------------
# Volcado de seguridad y reimportación desde JSON
# ---------------------------------------------------------------------------


def _product_to_dict(product: Product) -> dict:
    return {
        "sku": product.sku,
        "name": product.name,
        "url": product.url,
        "price": product.price,
        "previous_price": product.previous_price,
        "availability": product.availability,
        "cpu": product.cpu,
        "ram": product.ram,
        "ssd": product.ssd,
        "gpu": product.gpu,
        "marca": product.marca,
    }


def _write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_file = path.with_name(path.name + ".tmp")
    try:
        with open(tmp_file, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        tmp_file.replace(path)
    except Exception:
        try:
            tmp_file.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def dump_last_scrape(
    products: list[Product],
    ti_products: list[Product],
    skipped: list[str],
    stats: ScrapeStats,
    *,
    now: datetime,
    path: Path = LAST_SCRAPE_FILE,
) -> None:
    """Vuelca los productos recogidos a debug/last_scrape.json antes de guardar."""
    payload = {
        "schema_version": 1,
        "generated_at": now.isoformat(timespec="seconds"),
        "fecha": now.strftime("%Y-%m-%d"),
        "hora": now.strftime("%H:%M:%S"),
        "pages_scraped": stats.pages_scraped,
        "cards_total": stats.cards_total,
        "unique_skus": stats.unique_skus,
        "duplicate_cards": stats.duplicate_cards,
        "listing_total": stats.listing_total,
        "skipped": skipped,
        "products": [_product_to_dict(product) for product in products],
        "ti_products": [_product_to_dict(product) for product in ti_products],
    }
    _write_text_atomic(
        path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    )
    print(f"[{time.strftime('%H:%M:%S')}] 💾 Volcado de seguridad: {path}")


def _as_int(value: object) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0


def _json_product_items(data: object) -> tuple[list[dict], dict]:
    """
    Acepta tres formatos:
      - lista de productos,
      - objeto con las claves "products" y/o "ti_products",
      - mapping SKU -> {name, url, ...} (formato de data/products.json).
    """
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)], {}

    if isinstance(data, dict):
        if "products" in data or "ti_products" in data:
            items: list[dict] = []
            for key in ("products", "ti_products"):
                value = data.get(key)
                if isinstance(value, list):
                    items.extend(item for item in value if isinstance(item, dict))
                elif isinstance(value, dict):
                    for sku, item in value.items():
                        if isinstance(item, dict):
                            items.append({"sku": str(sku), **item})
            return items, data

        # data/products.json: {"10650846": {"name": ..., "url": ...}}
        items = []
        for sku, item in data.items():
            if isinstance(item, dict):
                items.append({"sku": str(sku), **item})
        return items, {}

    raise ValueError("El JSON debe ser una lista u objeto de productos")


def _product_from_json_item(item: dict) -> Product | None:
    name = str(item.get("name") or "").strip()
    if not name:
        return None

    sku = str(item.get("sku") or item.get("id") or "").strip()
    specs = extract_specifications(name)
    for key in ("cpu", "ram", "ssd", "gpu", "marca"):
        value = item.get(key)
        if value:
            specs[key] = str(value)

    availability = str(item.get("availability") or item.get("delivery") or "")
    return Product(
        sku=sku,
        name=name,
        url=str(item.get("url") or ""),
        price=parse_price(item.get("price")),
        previous_price=parse_price(item.get("previous_price")),
        availability=clean_availability(availability, ""),
        cpu=specs.get("cpu", ""),
        ram=specs.get("ram", ""),
        ssd=specs.get("ssd", ""),
        gpu=specs.get("gpu", ""),
        marca=specs.get("marca", ""),
    )


def load_scrape_json(path: Path) -> tuple[
    list[Product], list[Product], list[str], ScrapeStats, str | None, str | None
]:
    """
    Carga un JSON de productos y los reclasifica con la regex estricta de Ti.

    Devuelve (products, ti_products, skipped, stats, fecha, hora).
    """
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise OSError(f"No se pudo leer {path}: {exc}") from exc

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"JSON inválido en {path}: {exc}") from exc

    items, meta = _json_product_items(data)

    products: list[Product] = []
    ti_products: list[Product] = []
    seen: set[str] = set()
    for item in items:
        product = _product_from_json_item(item)
        if product is None:
            continue
        if product.sku:
            if product.sku in seen:
                continue
            seen.add(product.sku)
        if is_rtx_5070_ti(product.name):
            ti_products.append(product)
        else:
            products.append(product)

    skipped_raw = meta.get("skipped")
    skipped = (
        [str(value) for value in skipped_raw]
        if isinstance(skipped_raw, list)
        else []
    )

    listing_raw = meta.get("listing_total")
    listing_total = _as_int(listing_raw) if listing_raw is not None else None
    if listing_total is not None and listing_total <= 0:
        listing_total = None

    cards_total = _as_int(meta.get("cards_total")) or len(items)
    unique_skus = len(seen) or (len(products) + len(ti_products))
    duplicate_cards = _as_int(meta.get("duplicate_cards"))
    if not duplicate_cards:
        duplicate_cards = max(0, len(items) - unique_skus)

    stats = ScrapeStats(
        pages_scraped=_as_int(meta.get("pages_scraped")),
        cards_total=cards_total,
        unique_skus=unique_skus,
        duplicate_cards=duplicate_cards,
        listing_total=listing_total,
    )

    fecha = str(meta.get("fecha") or "").strip() or None
    hora = str(meta.get("hora") or "").strip() or None
    if fecha:
        try:
            datetime.strptime(fecha, "%Y-%m-%d")
        except ValueError:
            fecha = None
    if hora:
        try:
            datetime.strptime(hora, "%H:%M:%S")
        except ValueError:
            hora = None

    products.sort(key=lambda product: product.name.lower())
    ti_products.sort(key=lambda product: product.name.lower())
    return products, ti_products, skipped, stats, fecha, hora


def timestamp_from_json(fecha: str | None, hora: str | None) -> datetime:
    """Reconstruye la fecha/hora del volcado; si no es válida, usa ahora."""
    if not fecha:
        return datetime.now()
    time_part = hora or datetime.now().strftime("%H:%M:%S")
    try:
        return datetime.strptime(f"{fecha} {time_part}", "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return datetime.now()


def print_results(
    products,
    ti_products,
    skipped,
    stats: ScrapeStats | None,
    elapsed,
    partial: bool = False,
    *,
    saving: bool = True,
) -> None:
    """Imprime los resultados del scrapeo en la consola."""
    print("pc-price-tracker · PCs de sobremesa con RTX 5070 · PcComponentes")
    print(f"Listado: {BASE_URL}")
    if partial:
        save_state = "no se guarda (ejecución parcial)"
    elif saving:
        save_state = f"activado ({DATA_DIR})"
    else:
        save_state = "desactivado (--no-save)"
    print(f"Guardado: {save_state}")
    print()

    total = len(products) + len(ti_products)
    cards_total = stats.cards_total if stats and stats.cards_total else total
    unique_skus = stats.unique_skus if stats and stats.unique_skus else total
    duplicate_cards = stats.duplicate_cards if stats else 0
    pages_scraped = stats.pages_scraped if stats else 0

    print(f"Tarjetas leídas: {cards_total}")
    print(f"SKUs únicos: {unique_skus}")
    print(f"Tarjetas duplicadas: {duplicate_cards}")
    print(f"PCs RTX 5070 (sin Ti): {len(products)}")
    print(f"PCs RTX 5070 Ti: {len(ti_products)}")
    print(f"Páginas recorridas: {pages_scraped}")
    print(f"Tiempo: {elapsed:.1f} s")

    if stats and stats.listing_total is not None:
        listing_total = stats.listing_total
        print()
        print(f"Listado según la web: {listing_total} artículos")
        print(f"Diferencia tarjetas - listado: {cards_total - listing_total:+d}")
        print(f"Diferencia SKUs únicos - listado: {unique_skus - listing_total:+d}")
        if duplicate_cards:
            print(
                f"  {duplicate_cards} tarjeta(s) repetida(s) entre páginas explican "
                "el exceso de tarjetas."
            )
        if unique_skus < listing_total:
            print(
                "  El contador del listado es una foto del momento; puede incluir "
                "artículos que no llegaron a renderizarse."
            )

    print()
    if ti_products:
        print(f"RTX 5070 Ti detectadas ({len(ti_products)}):")
        for product in ti_products:
            print(f"  {product.sku} · {product.name}")
    else:
        print("RTX 5070 Ti detectadas (0): ninguna")

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
    print(f"Fecha: {summary.get('date', 'N/A')} {summary.get('time', '')}".rstrip())
    print(f"Productos guardados: {summary.get('total_products', 0)}")
    print(f"SKUs nuevos: {summary.get('new_skus', 0)}")
    print(f"Filas reemplazadas del mismo día: {summary.get('replaced_rows', 0)}")
    print(f"Filas en histórico: {summary.get('history_rows', 0)}")
    print(f"Fechas en histórico: {summary.get('history_dates', 0)}")
    print(f"Historial guardado en: {summary.get('history_file', HISTORY_FILE)}")


# ---------------------------------------------------------------------------
# Punto de entrada de argumentos
# ---------------------------------------------------------------------------

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
        help="No guarda el histórico: solo muestra la tabla por consola.",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Modo headless (sin interfaz gráfica). Por defecto Chrome visible.",
    )
    parser.add_argument(
        "--from-json",
        type=Path,
        metavar="RUTA",
        help=(
            "No scrapea: carga los productos de RUTA y ejecuta solo el resumen "
            "y el guardado."
        ),
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        metavar="DIR",
        help=(
            "Directorio de datos alternativo (history.csv). También se puede "
            "configurar con la variable de entorno PCT_DATA_DIR."
        ),
    )
    args = parser.parse_args(argv)

    if args.data_dir is not None:
        configure_data_dir(args.data_dir)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    print(f"[{time.strftime('%H:%M:%S')}] 📁 Directorio de datos: {DATA_DIR}")

    started = time.monotonic()
    print("pc-price-tracker · PCs de sobremesa con RTX 5070 · PcComponentes")
    print(f"Listado: {BASE_URL}")
    if args.from_json:
        print(f"Modo: --from-json {args.from_json} (sin scrapeo)")
    print(
        "Guardado: "
        + ("desactivado (--no-save)" if args.no_save else f"activado ({DATA_DIR})")
    )
    print()

    if args.from_json:
        try:
            products, ti_products, skipped, stats, fecha, hora = load_scrape_json(
                args.from_json
            )
        except (OSError, ValueError) as exc:
            print(f"\n[ERROR] {exc}", file=sys.stderr)
            return 1

        print_results(
            products,
            ti_products,
            skipped,
            stats,
            time.monotonic() - started,
            saving=not args.no_save,
        )

        if args.no_save:
            return 0
        if not products:
            print(
                "\n[AVISO] El JSON no contiene productos RTX 5070 (sin Ti); "
                "no se guarda el histórico.",
                file=sys.stderr,
            )
            return 0

        try:
            summary = save_run(products, now=timestamp_from_json(fecha, hora))
        except OSError as exc:
            print(
                f"\n[ERROR] No se pudo guardar el histórico: {exc}",
                file=sys.stderr,
            )
            return 1

        print_save_summary(summary)
        return 0

    try:
        products, ti_products, skipped, stats = scrape()
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
            partial_stats = exc.stats or ScrapeStats(
                pages_scraped=exc.pages_scraped,
                cards_total=len(exc.products) + len(exc.ti_products),
                unique_skus=len(exc.products) + len(exc.ti_products),
            )
            print_results(
                exc.products,
                exc.ti_products,
                exc.skipped,
                partial_stats,
                time.monotonic() - started,
                partial=True,
                saving=False,
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
        products,
        ti_products,
        skipped,
        stats,
        time.monotonic() - started,
        saving=not args.no_save,
    )

    if args.no_save:
        return 0

    if not products:
        print(
            "\n[AVISO] No hay productos con RTX 5070; no se guarda el histórico.",
            file=sys.stderr,
        )
        return 0

    # Volcado de seguridad justo antes de guardar: si el guardado falla, el
    # scrapeo de varios minutos no se pierde y se puede reimportar con
    # --from-json debug/last_scrape.json.
    ahora = datetime.now()
    try:
        dump_last_scrape(products, ti_products, skipped, stats, now=ahora)
    except Exception as exc:
        print(
            f"\n[AVISO] No se pudo escribir {LAST_SCRAPE_FILE}: {exc}",
            file=sys.stderr,
        )

    try:
        summary = save_run(products, now=ahora)
    except OSError as exc:
        print(
            f"\n[ERROR] No se pudo guardar el histórico: {exc}",
            file=sys.stderr,
        )
        return 1

    print_save_summary(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())