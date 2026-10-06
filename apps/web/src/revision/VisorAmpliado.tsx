import { useCallback, useEffect, useRef, useState } from 'react';
import { bboxEnRecorte, cropRect, estiloImagenEnRecorte } from './lib/crop';
import type { Bbox } from './lib/types';
import {
  ajustar,
  alternarZoom,
  ajustarTamano,
  desplazar,
  zoomEn,
  type Transform,
} from './lib/viewport';
import { useRuedaZoom } from './useRuedaZoom';
import { LuPlus, LuMinus } from 'react-icons/lu'

interface Props {
  img: HTMLImageElement;
  bbox: Bbox;
  numero: number;
  onCerrar: () => void;
}

/** Visor ampliado (modal) del recorte con contexto: zoom con rueda/botones, arrastre y doble clic. */
export default function VisorAmpliado({ img, bbox, numero, onCerrar }: Props) {
  const dialogo = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const cerrar = useRef<HTMLButtonElement>(null);
  const [vista, setVista] = useState({ w: 800, h: 500 });
  const [t, setT] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const arrastre = useRef<{ id: number; x: number; y: number } | null>(null);
  const [moviendo, setMoviendo] = useState(false);

  const rect = cropRect(bbox, img.naturalWidth, img.naturalHeight, { margenRel: 1.5, margenMinPx: 80 });
  const contenido = ajustarTamano({ w: rect.sw, h: rect.sh }, vista);
  const imgEstilo = estiloImagenEnRecorte(rect, img.naturalWidth, img.naturalHeight);
  const b = bboxEnRecorte(bbox, img.naturalWidth, img.naturalHeight, rect);

  // Medir el visor y mantener el recorte ajustado.
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setVista({ w: el.clientWidth || 800, h: el.clientHeight || 500 });
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    setT(ajustar(contenido, vista));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista.w, vista.h, bbox.x, bbox.y, bbox.w, bbox.h]);

  // Foco: entra al diálogo y al cerrar vuelve a quien lo abrió.
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    cerrar.current?.focus();
    return () => previo?.focus?.();
  }, []);

  const alTeclear = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCerrar();
      return;
    }
    if (e.key === 'Tab') {
      const focos = dialogo.current?.querySelectorAll<HTMLElement>('button:not(:disabled)');
      if (!focos || focos.length === 0) return;
      const primero = focos[0];
      const ultimo = focos[focos.length - 1];
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    }
  };

  useRuedaZoom(caja, (factor, x, y) => setT((p) => zoomEn(p, p.scale * factor, x, y, contenido, vista)));

  const posicion = (e: React.PointerEvent) => {
    const r = caja.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const zoomBoton = useCallback(
    (factor: number) => setT((p) => zoomEn(p, p.scale * factor, vista.w / 2, vista.h / 2, contenido, vista)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vista.w, vista.h, rect.sw, rect.sh],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-2 lg:p-6" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div
        ref={dialogo}
        role="dialog"
        aria-modal="true"
        aria-label={`Recorte ampliado de la duda ${numero}`}
        onKeyDown={alTeclear}
        className="flex h-full max-h-[96dvh] w-full max-w-[96vw] flex-col gap-2 rounded-2xl bg-white p-3 shadow-2xl"
      >
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Zoom del recorte">
          <p className="mr-auto text-base font-semibold">Duda {numero}</p>
          <button type="button" className="btn btn-secondary" aria-label="Acercar" onClick={() => zoomBoton(1.5)}>
            <LuPlus className="size-5" aria-hidden />
          </button>
          <button type="button" className="btn btn-secondary" aria-label="Alejar" onClick={() => zoomBoton(1 / 1.5)}>
            <LuMinus className="size-5" aria-hidden />
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setT(ajustar(contenido, vista))}>
            Ajustar
          </button>
          <button ref={cerrar} type="button" className="btn" onClick={onCerrar}>
            Cerrar
          </button>
        </div>
        <div
          ref={caja}
          data-testid="visor-caja"
          className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden rounded-xl bg-slate-200 ring-1 ring-slate-300 ${moviendo ? 'cursor-grabbing' : 'cursor-grab'}`}
          onPointerDown={(e) => {
            arrastre.current = { id: e.pointerId, ...posicion(e) };
            e.currentTarget.setPointerCapture?.(e.pointerId);
            setMoviendo(true);
          }}
          onPointerMove={(e) => {
            const a = arrastre.current;
            if (!a || a.id !== e.pointerId) return;
            const p = posicion(e);
            arrastre.current = { id: a.id, ...p };
            setT((prev) => desplazar(prev, p.x - a.x, p.y - a.y, contenido, vista));
          }}
          onPointerUp={() => {
            arrastre.current = null;
            setMoviendo(false);
          }}
          onPointerCancel={() => {
            arrastre.current = null;
            setMoviendo(false);
          }}
          onDoubleClick={(e) => {
            const p = posicion(e as unknown as React.PointerEvent);
            setT((prev) => alternarZoom(prev, p.x, p.y, contenido, vista));
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: contenido.w,
              height: contenido.h,
              overflow: 'hidden',
              background: '#fff',
              transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`,
              transformOrigin: '0 0',
            }}
          >
            <img
              src={img.src}
              alt={`Recorte con contexto de la duda ${numero}`}
              draggable={false}
              style={{
                position: 'absolute',
                maxWidth: 'none',
                left: `${imgEstilo.left}%`,
                top: `${imgEstilo.top}%`,
                width: `${imgEstilo.width}%`,
                height: `${imgEstilo.height}%`,
              }}
            />
            <div
              aria-hidden
              data-testid="recuadro-duda"
              style={{
                position: 'absolute',
                left: `${b.x * 100}%`,
                top: `${b.y * 100}%`,
                width: `${b.w * 100}%`,
                height: `${b.h * 100}%`,
                border: `${3 / t.scale}px solid #dc2626`,
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>
        <p className="text-sm text-slate-600">
          Rueda del ratón para acercar, arrastra para mover, doble clic para acercar o alejar. Esc para cerrar.
        </p>
      </div>
    </div>
  );
}

