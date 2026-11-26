#!/usr/bin/env python3
import re

path = r"C:\Users\Mario\Documents\PROYECTOS\Scrapper pccom\scraper.py"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

old = """# JS de extracción (igual que antes)
EXTRACT_JS = r\"\"\"
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
    delivery:
      delivery
        ? (delivery.innerText || '').replace(/\\s\\/g, ' ').trim()
        : '',
    card_text: (card.innerText || '').replace(/\\s+/g, ' ').trim(),
    image_url: imageEl ? imageEl.src || '' : '',
    // Atributos adicionales que podrían estar en el texto o en data-attributes
    full_text: (card.innerText || '').replace(/\\s+/g, ' ').trim(),
  };
}
\"\"\""""

new = """# JS de extracción autocontenido: selecciona las tarjetas desde la página
# en lugar de recibir ElementHandles como argumento (lo que causaba el cuelgue).
EXTRACT_JS_SELF_CONTAINED = r\"\"\"
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
          ? (delivery.innerText || '').replace(/\\s\\/g, ' ').trim()
          : '',
      card_text: (card.innerText || '').replace(/\\s+/g, ' ').trim(),
      image_url: imageEl ? imageEl.src || '' : '',
      full_text: (card.innerText || '').replace(/\\s+/g, ' ').trim(),
    };
  });
}
\"\"\""""

if old in content:
    content = content.replace(old, new)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("Replacement successful")
else:
    print("Old string not found!")
    idx = content.find('# JS de extracción (igual que antes)')
    if idx >= 0:
        print("Found at index:", idx)
        print(content[idx:idx+600])