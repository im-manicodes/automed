# Benchmark de OCR con tus PDFs reales

Sirve para decidir (1) qué motor usar (`local` o `textract`) y (2) qué valor poner en `OCR_CONFIDENCE_THRESHOLD`. El script **no guarda nada** en BD ni en RustFS y **no imprime el texto** de los documentos, solo métricas. Aun así: los PDFs se procesan en tu máquina y, con `--engine textract`, **se envían a AWS Textract**; úsalo solo con documentos que aceptes enviar.

## Preparar
1. Copia 10-30 PDFs representativos a una carpeta fuera del repo (p. ej. `~/pruebas-ocr/`): escaneados limpios, escaneados de baja calidad, con manuscrito, fotos de celular, y alguno digital. Si puedes, anota aparte cuáles tienen texto manuscrito.
2. Para `local`: `docker compose --profile ocr up -d ocr-local` y comprueba `curl localhost:8000/health` (`engine` debe ser `paddle`; si es `tesseract` mira `fallback_reason`).
3. Para `textract`: credenciales AWS en el entorno/`.env` y `AWS_REGION` (ver `docs/despliegue.md`, sección 4).

## Ejecutar
```bash
pnpm --filter api ocr:benchmark -- ~/pruebas-ocr --engine local   --csv local.csv
pnpm --filter api ocr:benchmark -- ~/pruebas-ocr --engine textract --csv textract.csv
# opciones: --dpi 250  --threshold 0.85  --max-pages N
```
(Si falla por módulos ESM, usa `NODE_OPTIONS=--experimental-vm-modules pnpm --filter api ocr:benchmark -- ...`.)

Columnas: `paginas`, `palabras` (o líneas), `regiones`, `conf_media` (0..1), `pct_dudosas` (% de regiones bajo el umbral) y `segundos` (rasterizado + OCR del documento).

## Cómo leer los resultados
- **`pct_dudosas` es lo que verá el usuario como "dudas" a corregir.** Más de ~10-15 % en documentos legibles es mucho trabajo manual; cerca de 0 % en un documento ilegible significa que el umbral es demasiado bajo (se te pasan errores).
- Compara `local` vs `textract` documento por documento: el manuscrito suele ser donde más se separan. Revisa a mano 2-3 documentos de cada tipo (abre el PDF y la pantalla de revisión) para ver si las dudas marcadas son errores reales.
- `segundos`: referencia local medida en este repo (CPU, PaddleOCR, página A4 a 250 DPI): 1-2 s por página; Tesseract 0,5-1,2 s por página (pero menos preciso en ruido/manuscrito).

## Ajustar `OCR_CONFIDENCE_THRESHOLD`
El umbral por defecto es `0.85`. Re-ejecuta con distintos valores (no hace falta tocar `.env`):
```bash
for t in 0.70 0.80 0.85 0.90 0.95; do
  pnpm --filter api ocr:benchmark -- ~/pruebas-ocr --engine textract --threshold $t --csv umbral-$t.csv
done
```
Criterio práctico:
1. Elige el umbral con el que, en tus documentos **buenos**, `pct_dudosas` sea bajo (< 5-10 %) y, en los **malos/manuscritos**, alto (se marcan casi todas las zonas realmente erróneas).
2. Si se te escapan errores (palabras mal leídas con confianza alta), **sube** el umbral (0.90-0.95): más dudas, más correcciones, menos errores silenciosos. En contenido sensible, prefiere subir.
3. Si hay demasiadas dudas triviales (confianza 0.85-0.92 pero bien leídas), **bájalo** (0.75-0.80).
4. Cada motor tiene su propia escala: Textract y PaddleOCR no dan la misma confianza para el mismo texto. Fija el umbral **por motor** y vuelve a medir si cambias de motor.
5. Opcional: `OCR_VISION_RETRY=true` relee con el LLM de visión las dudas antes de molestar al usuario (costo extra; ajusta `OCR_VISION_ACCEPT_THRESHOLD` y `OCR_VISION_MAX_REGIONS`).
6. Guarda el valor en `.env` (`OCR_CONFIDENCE_THRESHOLD=...`) y reinicia la api. Cambiar el umbral no reprocesa documentos ya analizados (usa *Reprocesar* en un hilo si quieres aplicarlo).

## Calidad del rasterizado
`OCR_RENDER_DPI` (200-300) afecta precisión y tiempo; 250 es un buen punto. Con Textract síncrono, una página PNG > 10 MB falla: baja el DPI.
