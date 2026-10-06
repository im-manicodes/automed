import { useEffect, useRef, useState } from 'react';
import { bboxEnRecorte, cropRect, tamanoSalida } from './lib/crop';
import type { Bbox } from './lib/types';

interface Props {
  img: HTMLImageElement;
  bbox: Bbox;
  numero: number;
  /** Alto máximo en px (por defecto el de móvil). */
  altoMax?: number;
  /** Si se da, el recorte es un botón que abre el visor ampliado. */
  onAbrir?: () => void;
}

/** Recorte ampliado de la duda con contexto alrededor y un recuadro rojo sobre la zona dudosa. */
export default function RecorteCanvas({ img, bbox, numero, altoMax: altoProp, onAbrir }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(360);

  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setAncho(Math.max(120, el.clientWidth));
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const rect = cropRect(bbox, img.naturalWidth, img.naturalHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const altoMax = altoProp ?? Math.min(280, window.innerHeight * 0.34);
    const { width, height } = tamanoSalida(rect, ancho, altoMax, dpr);
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width / dpr}px`;
    canvas.style.height = `${height / dpr}px`;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, width, height);
    const b = bboxEnRecorte(bbox, img.naturalWidth, img.naturalHeight, rect);
    ctx.lineWidth = Math.max(3, 3 * dpr);
    ctx.strokeStyle = '#dc2626';
    ctx.strokeRect(b.x * width, b.y * height, b.w * width, b.h * height);
  }, [img, bbox, ancho, altoProp]);

  const canvas = (
    <canvas
      ref={ref}
      role="img"
      aria-label={`Recorte ampliado del documento donde está la duda ${numero}, marcado con un recuadro rojo`}
      className="max-w-full"
    />
  );

  return (
    <div ref={caja} className="flex w-full justify-center rounded-xl bg-white p-1 ring-1 ring-slate-300">
      {onAbrir ? (
        <button
          type="button"
          onClick={onAbrir}
          aria-haspopup="dialog"
          aria-label={`Ver más grande el recorte de la duda ${numero}`}
          title="Haz clic para ver más grande"
          className="cursor-zoom-in rounded-lg focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
        >
          {canvas}
        </button>
      ) : (
        canvas
      )}
    </div>
  );
}
