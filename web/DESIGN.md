# tracker/5070 · DESIGN

Documento de diseño de la fase 1. Fuente de verdad para la fase 2.
Contiene literalmente las secciones 1 a 6 de la especificación. Las secciones 7 a 10
(portada, catálogo, movimiento y verificación) viven en el código y en `scripts/`.

---

## 1. FUENTES Y TIPOGRAFÍA

- Instala @fontsource/instrument-serif, @fontsource-variable/geist y @fontsource-variable/geist-mono (comprueba con npm view que existen; si alguna no existe, avísame antes de sustituirla). Importa solo Instrument Serif 400 y 400 italic, Geist variable y Geist Mono variable. font-display: swap.
- Instrument Serif: solo titulares (h1, h2, estados vacíos). Geist: interfaz y precios. Geist Mono: etiquetas, datos y ejes. Precios SIEMPRE font-variant-numeric: tabular-nums.
- Escala (tamaño/interlínea/tracking): display portada clamp(48px,8vw,96px)/0.95/-0.02em; h1 de página clamp(40px,5.5vw,64px)/1/-0.02em; h2 clamp(30px,3.4vw,44px)/1.05/-0.015em; h1 de producto Geist 500 clamp(26px,3vw,42px)/1.1/-0.02em; h3 Geist 500 18/24; título de tarjeta Geist 500 16/22 (móvil 15/21); body-lg 18/28 (móvil 16/26); body 15/24; small 13/20; label Geist Mono 500 11/16 MAYÚSCULAS tracking 0.08em; kpi Geist 500 64/1 tracking -0.03em (móvil 44/1); price-xl 72/1 (móvil 48/1); price-l 28/32 (móvil 26/30).

## 2. COLOR (variables CSS en :root; modo único oscuro)

--bg #0B0C0E; --surface-1 #111316; --surface-2 #171A1E; --surface-3 #1D2126; --border #23272D; --border-strong #323840; --text #ECEDEF; --text-2 #A3A9B2; --text-3 #7C848E; --accent #5B8CFF; --accent-soft rgba(91,140,255,.14); --down #3DDC97 (el precio baja, bueno); --down-soft rgba(61,220,151,.12); --up #FF6B6B (el precio sube); --up-soft rgba(255,107,107,.12).

- El acento solo para interacción, enlaces activos y la serie principal de las gráficas. Verde y rojo SOLO para dirección del precio. Prohibido cualquier otro color.

## 3. FORMAS, ESPACIADO Y FOCO

- Escala de espacio (px): 4, 8, 12, 16, 24, 32, 48, 64, 96, 128. Radios: tarjeta 14, panel 16, control 10, chip 6, píldora 999. Bordes 1px solid var(--border). Sin sombras salvo tooltip (0 8px 24px rgba(0,0,0,.4)) y bottom sheet. Paneles: bg var(--surface-1) y box-shadow inset 0 1px 0 rgba(255,255,255,.03).
- Foco visible: outline 2px solid var(--accent), offset 2px, en todo lo interactivo. Selección de texto: fondo var(--accent-soft).

## 4. LAYOUT GLOBAL

- .container: width 100%, max-width 1280px, margin-inline auto, padding-inline 32px (≥1024), 24px (640–1023), 20px (<640). Contenido útil = 1216px en viewports ≥1344. Breakpoints: móvil <640 (diseña a 390), tablet 640–1023, escritorio ≥1024. Nunca estires más de 1280.
- main: padding-top 64/48/32 (escritorio/tablet/móvil), padding-bottom 128 (móvil: 96 + 64 + env(safe-area-inset-bottom)). Espacio entre secciones: 96/72/56.
- Glow solo en Home: capa absoluta de 640px de alto desde top 0 con radial-gradient(60% 100% at 50% 0%, rgba(91,140,255,.10), transparent 70%), pointer-events none.
- Header: altura 64 (móvil 56), sticky top 0, z-index 50, bg rgba(11,12,14,.72), backdrop-filter blur(16px) saturate(140%), border-bottom 1px transparente que pasa a var(--border) cuando scrollY>8 (200ms). Dentro del .container, flex space-between centrado. Izquierda: wordmark "tracker/5070" Geist Mono 500 14/16, la "/" en var(--accent), enlace a la portada, zona clicable ≥44px de alto. Derecha (≥640): nav "Resumen", "Catálogo", "Favoritos" (contador chip 18×18 mono 11 solo si n>0); cada enlace alto 36, padding 0 14px, radio 999, Geist 500 14/20; inactivo color text-2, hover text, activo text sobre fondo surface-2; gap 4. La píldora activa se desliza entre enlaces en 240ms cubic-bezier(.22,1,.36,1). En <640 la derecha del header muestra un chip mono 11 text-3 "Act. 26 nov".
- Tab bar (<640 solamente): fixed bottom 0, left 0, right 0, altura calc(64px + env(safe-area-inset-bottom)), padding-bottom env(safe-area-inset-bottom), bg rgba(17,19,22,.88) con blur(16px), border-top 1px var(--border). 3 items flex:1: icono lucide 22px strokeWidth 1.5 + etiqueta Geist 500 11/14, gap 4; inactivo text-3, activo accent con barra de 24×2 radio 2 pegada arriba; área táctil ≥64×48. Badge de favoritos sobre el icono: círculo 16, bg accent, texto 10 color var(--bg).
- Footer: border-top 1px var(--border), padding 32px 0. Escritorio 2 columnas: izquierda "tracker/5070 · Datos recogidos de PcComponentes. Proyecto independiente, sin afiliación." 13/20 text-3; derecha "Última actualización 26/11/2026 09:26" mono 12 text-3. Móvil: 1 columna, gap 8.
- Franja de datos obsoletos: si el último scrape tiene más de 2 días, tira bajo el header (no sticky) de 36px, bg surface-1, border-bottom, texto mono 12 text-2 centrado "Datos de hace N días · último scrape dd/mm".

## 5. COMPONENTES BASE

- Botón: lg 48 / md 40 / sm 32 de alto, radio 999, padding-inline 24/18/14, Geist 500 15/14/13. Primario: bg var(--text), color var(--bg), hover #FFFFFF. Secundario: borde 1px var(--border-strong), color var(--text), hover bg surface-2. Ghost: sin borde, color text-2, hover text. Active: scale(.98). Transición 160ms. Icono flecha 16px que se desplaza 4px a la derecha en hover.
- Chip de spec: alto 24, padding 0 8px, radio 6, bg surface-2, borde 1px var(--border), mono 11/16, color text-2, nowrap.
- Chip de variación: alto 22, padding 0 8px, radio 6, mono 12/16 500, glifo ▼/▲ de 8px; baja: color var(--down) sobre var(--down-soft); sube: var(--up) sobre var(--up-soft); sin cambio: text-2 sobre surface-2.
- Badge: alto 20, padding 0 6px, radio 5, mono 10/12 600 MAYÚSCULAS tracking .06em. "MÍN. HISTÓRICO": color down, borde 1px rgba(61,220,151,.35). "NUEVO": color accent, borde 1px rgba(91,140,255,.35). "DESCATALOGADO": color text-3, borde border-strong.
- Switch 36×20 radio 999, ficha 16px, activo bg accent, 160ms. Checkbox 18×18 radio 5, borde 1.5px border-strong, marcado bg accent con check de 12px. Segmented: alto 36, radio 999, bg surface-2, padding 3; opción alto 30, padding 0 14px, mono 12 500; la activa (bg surface-3, color text) con píldora deslizante 220ms.
- Skeleton: bg surface-2, brillo linear-gradient animado 1.4s infinito (estático con reduced-motion).

## 6. GRÁFICAS (componentes propios en SVG, responsive con ResizeObserver)

PriceChart (props: series de precio, serie opcional de PVPR, barras opcionales, hitos, altura):
- Márgenes: arriba 24, derecha 24 (móvil 12), abajo 36, izquierda 64 (móvil 48).
- Eje Y: dominio [min−4%·rango, max+4%·rango], con rango mínimo de 2% del valor medio o 20 € si la serie es plana. Ticks "agradables" con paso en {1, 2, 2.5, 5}×10^k, entre 4 y 6 ticks. Etiquetas con el formato de euros completo ("2.480 €"), mono 11 color text-3, alineadas a la derecha, SIN duplicados (si dos etiquetas salen iguales, reduce ticks o aumenta decimales). Líneas de rejilla 1px rgba(255,255,255,.06). Sin línea de eje Y.
- Eje X: escala temporal real por fechas, nunca categórica. Pasos candidatos 1 día, 2 días, 1 semana, 2 semanas, 1 mes; elige el menor que dé ≤7 etiquetas. Formato "23 nov", mono 11 text-3, SIN duplicados. Línea inferior 1px var(--border).
- Serie: línea 2px var(--accent), linejoin round; área bajo la línea con gradiente accent .18 → 0. Puntos (≤60 datos): círculo r=3.5, relleno var(--bg), trazo 2px accent. Si el hueco entre dos puntos consecutivos es >1,5× la mediana de intervalos y >1 día, ese tramo se dibuja discontinuo (dasharray 4 4, opacidad .6) y no se interpola nada más.
- Zona futura (solo si hay <30 días de datos): el dominio X se extiende hasta último scrape + 14 días; esa zona lleva relleno rgba(255,255,255,.025), trama diagonal de 1px y la etiqueta "SIN DATOS AÚN" mono 10 text-3 arriba a la izquierda de la zona.
- Hitos: Black Friday 27/11/2026, Cyber Monday 30/11/2026, Navidad 25/12/2026, Reyes 06/01/2027, Rebajas 07/01/2027. Línea vertical dasharray 3 3, 1px rgba(255,255,255,.18); etiqueta pegada arriba: alto 20, padding 0 8px, radio 6, bg surface-2, mono 10. Solo los que caen dentro del dominio. Si dos etiquetas quedan a menos de 80px, la segunda baja 24px. En <640 solo punto de 6px arriba, y la etiqueta sale en el tooltip al tocar.
- Línea de PVPR (si se pide): 1px dasharray 2 4, color text-3, etiqueta "PVPR 4.239 €" a la derecha encima de la línea.
- Barras opcionales ("PCs que bajan"): zona inferior de 56px, ancho 8px, radio 2, color var(--down) con alfa .7, escala propia 0..max; tooltip incluye su valor.
- Interacción: crosshair vertical + punto que sigue al dato más cercano (snap) con pointermove; en táctil pointerdown/pointermove con touch-action: pan-y. Tooltip: bg surface-2, borde 1px border-strong, radio 10, padding 10px 12px, sombra de tooltip; fecha "jue 26 nov 2026" mono 11 text-3, precio Geist 500 18/24, variación respecto al punto anterior (chip), PVPR si hay. Se mantiene dentro del área del gráfico y se voltea a izquierda o derecha. Teclado: el SVG es focusable (tabindex 0), flechas ←/→ mueven entre puntos, región aria-live="polite" con la lectura. role="img" con aria-label que resume rango y variación.
- Entrada: al entrar en viewport (IntersectionObserver, umbral .3) la línea se dibuja con stroke-dashoffset en 900ms ease-out y el área aparece en 600ms con 300ms de retraso. Con prefers-reduced-motion: sin animación.
- 1 solo punto: punto + texto centrado "Historial en construcción · 1 día". 2 o más: línea normal.

Sparkline: SVG 96×32, sin ejes, línea 1.5px con vector-effect non-scaling-stroke, últimos 30 puntos, dominio con 10% de margen. Color: down si baja respecto al primer punto, up si sube, text-3 si es plana. Punto final r=2.5. Un solo punto: solo el punto, gris. Plana: línea horizontal centrada.

---

## Notas de implementación (no forman parte de las secciones 1–6)

- Los ejemplos de fecha del documento (26/11) son formato; la interfaz usa la fecha real
  del último scrape disponible en los datos (27/11/2026 08:00 al escribir esto).
- Los microtextos de 10px que la propia especificación fija (badge, etiquetas de hitos,
  zona futura, badge de la tab bar) se marcan con `data-micro` para la verificación;
  ningún otro texto baja de 11px.
