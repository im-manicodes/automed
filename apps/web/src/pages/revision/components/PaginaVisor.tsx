import { useRuedaZoom } from '../../../hooks/useRuedaZoom';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ajustar,
  clampTransform,
  desplazar,
  distancia,
  dobleToque,
  enfocarBbox,
  punto_medio,
  zoomEn,
  type Transform,
} from '../../../lib/viewport';
import type { Duda } from '../lib/types';
import type { EstadoDuda } from '../lib/dudas';
import { LuCheck, LuPlus, LuMinus } from 'react-icons/lu'

interface Props {
  imagenUrl: string;
  /** Proporción de la página (alto / ancho). */
  proporcion: number;
  /** Todas las dudas (de todas las páginas); aquí se dibujan las de `pageNumber`. */
  dudas: Duda[];
  estados: Record<string, EstadoDuda>;
  pageNumber: number;
  actualId: string | undefined;
  onElegir: (indice: number) => void;
  /** Clases de alto del visor (por defecto el de móvil). */
  claseAlto?: string;
  /** Escala al enfocar la duda actual. */
  escalaFoco?: number;
}

interface Tap {
  t: number;
  x: number;
  y: number;
}

/** Página completa con recuadros, pinch-zoom, arrastre, doble toque y botones +/-/ajustar (sin dependencias). */
export default function PaginaVisor({ imagenUrl, proporcion, dudas, estados, pageNumber, actualId, onElegir, claseAlto = 'h-[55vh] min-h-72', escalaFoco = 2 }: Props) {
  const caja = useRef<HTMLDivElement>(null);
  const [vista, setVista] = useState({ w: 360, h: 480 });
  const [t, setT] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const punteros = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const movido = useRef(false);
  const inicio = useRef<{ x: number; y: number } | null>(null);
  const ultimoTap = useRef<Tap | null>(null);

  // Contenido ajustado al visor (contain).
  const contenido = {
    w: Math.min(vista.w, vista.h / proporcion),
    h: Math.min(vista.w * proporcion, vista.h),
  };

  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setVista({ w: el.clientWidth, h: el.clientHeight });
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dudasPagina = dudas
    .map((d, indice) => ({ d, indice }))
    .filter(({ d }) => d.pageNumber === pageNumber);

  // Al cambiar de duda o de página, enfoca la duda actual (o ajusta la página completa).
  const actual = dudas.find((d) => d.id === actualId);
  useEffect(() => {
    if (actual && actual.pageNumber === pageNumber) {
      setT(enfocarBbox(actual.bbox, contenido, vista, escalaFoco));
    } else {
      setT(ajustar(contenido, vista));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualId, pageNumber, vista.w, vista.h, proporcion]);

  const posicion = (e: React.PointerEvent) => {
    const r = caja.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const alBajar = (e: React.PointerEvent) => {
    punteros.current.set(e.pointerId, posicion(e));
    if (punteros.current.size === 1) {
      movido.current = false;
      inicio.current = posicion(e);
    } else if (punteros.current.size === 2) {
      const [a, b] = [...punteros.current.values()];
      pinch.current = { dist: distancia(a, b), scale: t.scale };
      movido.current = true;
    }
  };

  const alMover = (e: React.PointerEvent) => {
    const previo = punteros.current.get(e.pointerId);
    if (!previo) return;
    const actualPos = posicion(e);
    punteros.current.set(e.pointerId, actualPos);
    if (punteros.current.size >= 2 && pinch.current) {
      const [a, b] = [...punteros.current.values()];
      const medio = punto_medio(a, b);
      const d = distancia(a, b);
      setT((prev) => zoomEn(prev, (pinch.current!.scale * d) / pinch.current!.dist, medio.x, medio.y, contenido, vista));
      return;
    }
    if (inicio.current && distancia(inicio.current, actualPos) > 8) movido.current = true;
    if (movido.current && punteros.current.size === 1 && e.pointerType === 'mouse') {
      // Con ratón, sigue el arrastre aunque el puntero salga del visor (no se captura antes para no romper el clic en recuadros).
      caja.current?.setPointerCapture?.(e.pointerId);
    }
    if (movido.current) {
      setT((prev) => desplazar(prev, actualPos.x - previo.x, actualPos.y - previo.y, contenido, vista));
    }
  };

  const alSoltar = (e: React.PointerEvent) => {
    const pos = punteros.current.get(e.pointerId) ?? posicion(e);
    punteros.current.delete(e.pointerId);
    if (punteros.current.size < 2) pinch.current = null;
    if (punteros.current.size === 0 && !movido.current) {
      const ahora = Date.now();
      const u = ultimoTap.current;
      if (u && ahora - u.t < 320 && distancia(u, pos) < 40) {
        ultimoTap.current = null;
        setT((prev) => dobleToque(prev, pos.x, pos.y, contenido, vista));
      } else {
        ultimoTap.current = { t: ahora, x: pos.x, y: pos.y };
      }
    }
  };

  const zoomBoton = useCallback(
    (factor: number) =>
      setT((prev) => zoomEn(prev, prev.scale * factor, vista.w / 2, vista.h / 2, contenido, vista)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vista.w, vista.h, proporcion],
  );

  useRuedaZoom(caja, (factor, x, y) =>
    setT((prev) => zoomEn(prev, prev.scale * factor, x, y, contenido, vista)),
  );

  const grosor = (sel: boolean) => (sel ? 5 : 2.5) / t.scale;

  return (
    <div className="space-y-2">
      <div
        ref={caja}
        className={`relative ${claseAlto} touch-none select-none overflow-hidden rounded-xl bg-slate-200 ring-1 ring-slate-300`}
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: contenido.w,
            height: contenido.h,
            transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`,
            transformOrigin: '0 0',
          }}
        >
          <img
            src={imagenUrl}
            alt={`Página ${pageNumber} del documento`}
            draggable={false}
            className="h-full w-full bg-white"
          />
          {dudasPagina.map(({ d, indice }) => {
            const sel = d.id === actualId;
            const hecho = estados[d.id] === 'guardada';
            const color = hecho ? '#15803d' : '#dc2626';
            return (
              <button
                key={d.id}
                type="button"
                aria-label={`Duda ${indice + 1}${hecho ? ', ya corregida' : ''}${sel ? ', la que estás viendo' : ''}`}
                aria-current={sel ? 'true' : undefined}
                onClick={() => {
                  if (!movido.current) onElegir(indice);
                }}
                style={{
                  position: 'absolute',
                  left: `${d.bbox.x * 100}%`,
                  top: `${d.bbox.y * 100}%`,
                  width: `${d.bbox.w * 100}%`,
                  height: `${d.bbox.h * 100}%`,
                  border: `${grosor(sel)}px ${hecho ? 'dashed' : 'solid'} ${color}`,
                  background: sel ? 'rgba(220,38,38,0.12)' : 'transparent',
                  padding: 0,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: -2 / t.scale,
                    top: 0,
                    transform: `translateY(-100%) scale(${1 / t.scale})`,
                    transformOrigin: '0 100%',
                    background: color,
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 14,
                    lineHeight: '20px',
                    padding: '0 6px',
                    borderRadius: 4,
                  }}
                >
                  {hecho ? <LuCheck className="inline size-3.5 align-text-bottom" aria-hidden /> : null}
                  {indice + 1}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex gap-2" role="group" aria-label="Zoom de la página">
        <button type="button" className="btn btn-secondary flex-1" aria-label="Acercar" onClick={() => zoomBoton(1.5)}>
          <LuPlus className="size-5" aria-hidden />
        </button>
        <button type="button" className="btn btn-secondary flex-1" aria-label="Alejar" onClick={() => zoomBoton(1 / 1.5)}>
          <LuMinus className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          className="btn btn-secondary flex-[2]"
          onClick={() => setT(clampTransform({ scale: 1, x: 0, y: 0 }, contenido, vista))}
        >
          Ver toda la hoja
        </button>
      </div>
    </div>
  );
}
