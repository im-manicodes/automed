import { useCallback, useEffect, useRef, useState } from 'react';
import { bboxEnRecorte, cropRect, estiloImagenEnRecorte } from '../lib/crop';
import type { Bbox } from '../lib/types';
import {
  ajustar,
  alternarZoom,
  ajustarTamano,
  desplazar,
  zoomEn,
  distancia,
  punto_medio,
  type Transform,
} from '../../../lib/viewport';
import { useRuedaZoom } from '../../../hooks/useRuedaZoom';
import { useCerrarConAtras } from '../hooks/useCerrarConAtras';
import { LuPlus, LuMinus } from 'react-icons/lu';

interface Props {
  img: HTMLImageElement;
  bbox: Bbox;
  numero: number;
  onCerrar: () => void;
  /** Formulario para escribir la corrección dentro del modal (debajo del recorte). */
  formulario?: React.ReactNode;
  /** Total de dudas (para «Duda N de M»). */
  total?: number;
  /** Celular: pantalla completa, pellizco, sin foco automático en el campo y «Atrás» cierra. */
  tactil?: boolean;
}

/** Visor ampliado (modal) del recorte con contexto: zoom con rueda/botones, arrastre y doble clic. */
export default function VisorAmpliado({ img, bbox, numero, onCerrar, formulario, total, tactil = false }: Props) {
  const dialogo = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const cerrar = useRef<HTMLButtonElement>(null);
  const [vista, setVista] = useState({ w: 800, h: 500 });
  const [t, setT] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const arrastre = useRef<{ id: number; x: number; y: number } | null>(null);
  const [moviendo, setMoviendo] = useState(false);
  // Punteros activos (pellizco con dos dedos) y última distancia entre ellos.
  const punteros = useRef(new Map<number, { x: number; y: number }>());
  const distPellizco = useRef<number | null>(null);

  useCerrarConAtras(tactil, onCerrar);

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
    // Escritorio con formulario: el foco va al campo. En celular se evita (abriría el teclado y tapa la imagen).
    const campo = tactil ? null : dialogo.current?.querySelector<HTMLElement>('textarea');
    (campo ?? cerrar.current)?.focus();
    return () => previo?.focus?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alTeclear = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCerrar();
      return;
    }
    if (e.key === 'Tab') {
      const focos = dialogo.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), a[href], input:not(:disabled)');
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
  const finDePuntero = (id: number) => {
    punteros.current.delete(id);
    distPellizco.current = null;
    arrastre.current = null;
    setMoviendo(false);
    // Al soltar un dedo del pellizco, el que queda sigue arrastrando desde donde está.
    if (punteros.current.size === 1) {
      const [[otro, p]] = [...punteros.current.entries()];
      arrastre.current = { id: otro, ...p };
    }
  };
  const zoomBoton = useCallback(
    (factor: number) => setT((p) => zoomEn(p, p.scale * factor, vista.w / 2, vista.h / 2, contenido, vista)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vista.w, vista.h, rect.sw, rect.sh],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/70 lg:items-center lg:p-6" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div
        ref={dialogo}
        role="dialog"
        aria-modal="true"
        aria-label={`Recorte ampliado de la duda ${numero}`}
        onKeyDown={alTeclear}
        className="flex h-dvh w-full flex-col gap-2 bg-white p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] lg:h-full lg:max-h-[96dvh] lg:max-w-[96vw] lg:rounded-2xl lg:p-3 lg:shadow-2xl"
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="order-1 mr-auto text-base font-semibold">{total ? `Duda ${numero} de ${total}` : `Duda ${numero}`}</p>
          <div className="order-3 flex basis-full gap-2 lg:order-2 lg:basis-auto" role="group" aria-label="Zoom del recorte">
            <button type="button" className="btn btn-secondary" aria-label="Acercar" onClick={() => zoomBoton(1.5)}>
              <LuPlus className="size-5" aria-hidden />
            </button>
            <button type="button" className="btn btn-secondary" aria-label="Alejar" onClick={() => zoomBoton(1 / 1.5)}>
              <LuMinus className="size-5" aria-hidden />
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setT(ajustar(contenido, vista))}>
              Ajustar
            </button>
          </div>
          <button ref={cerrar} type="button" className="btn order-2 lg:order-3" onClick={onCerrar}>
            Cerrar
          </button>
        </div>
        <div
          ref={caja}
          data-testid="visor-caja"
          className={`relative min-h-[30dvh] flex-1 touch-none lg:min-h-0 select-none overflow-hidden rounded-xl bg-slate-200 ring-1 ring-slate-300 ${moviendo ? 'cursor-grabbing' : 'cursor-grab'}`}
          onPointerDown={(e) => {
            const p = posicion(e);
            punteros.current.set(e.pointerId, p);
            e.currentTarget.setPointerCapture?.(e.pointerId);
            if (punteros.current.size === 2) {
              const [a, b2] = [...punteros.current.values()];
              distPellizco.current = distancia(a, b2);
              arrastre.current = null;
              return;
            }
            if (punteros.current.size > 2) return;
            arrastre.current = { id: e.pointerId, ...p };
            setMoviendo(true);
          }}
          onPointerMove={(e) => {
            if (punteros.current.has(e.pointerId)) punteros.current.set(e.pointerId, posicion(e));
            if (punteros.current.size === 2) {
              // Pellizco: la distancia entre los dedos cambia la escala, centrada entre ellos.
              const [a, b2] = [...punteros.current.values()];
              const d = distancia(a, b2);
              const antes = distPellizco.current;
              distPellizco.current = d;
              if (antes && antes > 0 && d > 0) {
                const c = punto_medio(a, b2);
                setT((prev) => zoomEn(prev, prev.scale * (d / antes), c.x, c.y, contenido, vista));
              }
              return;
            }
            const a = arrastre.current;
            if (!a || a.id !== e.pointerId) return;
            const p = posicion(e);
            arrastre.current = { id: a.id, ...p };
            setT((prev) => desplazar(prev, p.x - a.x, p.y - a.y, contenido, vista));
          }}
          onPointerUp={(e) => finDePuntero(e.pointerId)}
          onPointerCancel={(e) => finDePuntero(e.pointerId)}
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
        {formulario && <div className="max-h-[48dvh] overflow-y-auto px-1 lg:max-h-[42dvh]">{formulario}</div>}
        <p className="text-sm text-slate-600">
          {tactil
            ? 'Pellizca para acercar, arrastra para mover, toca dos veces para acercar o alejar.'
            : 'Rueda del ratón para acercar, arrastra para mover, doble clic para acercar o alejar. Esc para cerrar.'}
        </p>
      </div>
    </div>
  );
}

