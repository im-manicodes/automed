import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import FormularioDuda from './components/FormularioDuda';
import PaginaVisor from './components/PaginaVisor';
import RecorteCanvas from './components/RecorteCanvas';
import { crearBorradores, textoInicial } from './lib/borrador';
import {
  anterior,
  avanzar,
  construirDudas,
  flujoInicial,
  irA,
  marcar,
  totalGuardadas,
  type Flujo,
} from './lib/dudas';
import type { ApiPagesResponse } from './lib/types';
import { usePaginasAdjunto } from './hooks/usePaginasAdjunto';
import { useGuardado } from './hooks/useGuardado';
import { useEsEscritorio } from '../../hooks/useEsEscritorio';
import { usePaginaImagen } from '../../hooks/usePaginaImagen';
import VisorAmpliado from './components/VisorAmpliado';
import { LuCheck } from 'react-icons/lu'

const borradores = crearBorradores(
  (() => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  })(),
);

type Modo = 'recorte' | 'pagina';

export default function RevisionPage() {
  const { id: ticketId = '', attachmentId = '' } = useParams();
  const { data: datos, error: errorCarga, refetch } = usePaginasAdjunto(attachmentId);

  if (errorCarga) {
    return (
      <Centro>
        <p className="text-lg">No pudimos abrir el documento.</p>
        <p className="text-slate-600">{errorCarga}</p>
        <button type="button" className="btn" onClick={() => void refetch()}>
          Intentar otra vez
        </button>
        <Link to={`/tickets/${ticketId}`} className="btn btn-secondary">
          Volver al ticket
        </Link>
      </Centro>
    );
  }
  if (!datos) {
    return (
      <Centro>
        <p role="status" className="text-lg">
          Abriendo el documento…
        </p>
      </Centro>
    );
  }
  return <Revision datos={datos} ticketId={ticketId} attachmentId={attachmentId} />;
}

function Centro({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex max-w-md flex-col items-stretch gap-4 px-4 py-10 text-center">{children}</div>;
}

function Revision({ datos, ticketId, attachmentId }: { datos: ApiPagesResponse; ticketId: string; attachmentId: string }) {
  const dudas = useMemo(() => construirDudas(datos.pages), [datos]);
  const [flujo, setFlujo] = useState<Flujo>(() => flujoInicial(dudas));
  const [terminado, setTerminado] = useState(false);
  const [modo, setModo] = useState<Modo>('recorte');
  const [paginaVista, setPaginaVista] = useState<number | null>(null);
  const [ampliado, setAmpliado] = useState(false);
  const escritorio = useEsEscritorio();
  const [guardados, setGuardados] = useState<Record<string, string>>({});
  const { estados, enviar, reintentarTodo, conError, guardando } = useGuardado();
  const titulo = useRef<HTMLHeadingElement>(null);

  const actual = dudas[flujo.indice];
  const paginaNum = paginaVista ?? actual?.pageNumber ?? datos.pages[0]?.pageNumber;
  const pagina = datos.pages.find((p) => p.pageNumber === paginaNum);
  const { img, error: errorImg, reintentar } = usePaginaImagen(attachmentId, actual?.pageNumber);
  // Página completa del visor (escritorio: la de la duda; celular: solo en modo «Página completa»).
  const imagenVisor = usePaginaImagen(attachmentId, escritorio ? actual?.pageNumber : modo === 'pagina' ? paginaNum : undefined).img;

  // Al cambiar de duda, la vista de página sigue a la duda y el foco vuelve al encabezado (anuncia el avance).
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- patrón de carga inicial / sincronización con la red o la imagen; no cambia el comportamiento
    setPaginaVista(null);
    titulo.current?.focus({ preventScroll: true });
  }, [flujo.indice]);

  const alGuardar = useCallback(
    (texto: string) => {
      if (!actual) return;
      setGuardados((g) => ({ ...g, [actual.id]: texto }));
      borradores.guardar(actual.id, texto);
      void enviar(actual.id, texto);
      const f = marcar(flujo, actual.id, 'guardada');
      const r = avanzar(f, dudas);
      setFlujo(r.flujo);
      setTerminado(r.terminado);
      if (r.terminado) setAmpliado(false);
    },
    [actual, flujo, dudas, enviar],
  );

  const alOmitir = () => {
    if (!actual) return;
    const f = flujo.estados[actual.id] === 'guardada' ? flujo : marcar(flujo, actual.id, 'omitida');
    const r = avanzar(f, dudas);
    setFlujo(r.flujo);
    setTerminado(r.terminado);
    if (r.terminado) setAmpliado(false);
  };

  // Escritorio: Alt+Izquierda / Alt+Derecha = duda anterior / siguiente.
  useEffect(() => {
    if (!escritorio || ampliado || terminado) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const paso = e.key === 'ArrowLeft' ? -1 : 1;
      setFlujo((f) => irA(f, dudas, f.indice + paso));
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [escritorio, ampliado, terminado, dudas]);

  const volverAlTicket = `/tickets/${ticketId}`;

  if (dudas.length === 0) {
    return (
      <Centro>
        <h1 className="text-2xl font-bold">No hay nada que revisar aquí</h1>
        <p className="text-lg text-slate-700">Este documento no tiene dudas pendientes. ¡Gracias!</p>
        <Link to={volverAlTicket} className="btn">
          Volver al ticket
        </Link>
      </Centro>
    );
  }

  if (terminado) {
    return (
      <Centro>
        <h1 className="text-3xl font-bold">¡Listo!</h1>
        <p className="text-lg text-slate-700">
          Gracias por revisar las {dudas.length} dudas. El resumen se actualizará solo en unos momentos.
        </p>
        {conError > 0 && (
          <ErrorGuardado cantidad={conError} onReintentar={reintentarTodo} />
        )}
        {guardando > 0 && <p role="status">Guardando…</p>}
        <Link to={volverAlTicket} className="btn text-lg">
          Volver al ticket
        </Link>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setTerminado(false);
            setFlujo((f) => irA(f, dudas, 0));
          }}
        >
          Revisar otra vez
        </button>
      </Centro>
    );
  }

  const hechas = totalGuardadas(flujo);
  const pct = Math.round((hechas / dudas.length) * 100);
  const idxEnPagina = datos.pages.map((p) => p.pageNumber);
  const posPagina = idxEnPagina.indexOf(paginaNum);
  const esUltima = dudas.filter((d) => flujo.estados[d.id] !== 'guardada').length <= 1 && flujo.estados[actual.id] !== 'guardada';
  const guardadoActual = estados[actual.id];

  const encabezado = (
    <header>
      <div className="flex items-baseline justify-between gap-2">
        <h1 ref={titulo} tabIndex={-1} className="text-2xl font-bold outline-none" aria-live="polite">
          Duda {flujo.indice + 1} de {dudas.length}
        </h1>
        <span className="text-base text-slate-700" role="status">
          {guardadoActual === 'guardando' && 'Guardando…'}
          {guardadoActual === 'guardado' && <><LuCheck className="mr-1 -mt-0.5 inline size-4" aria-hidden />Guardado</>}
          {guardadoActual === 'error' && 'No se guardó'}
        </span>
      </div>
      <div
        className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={dudas.length}
        aria-valuenow={hechas}
        aria-label={`${hechas} de ${dudas.length} dudas resueltas`}
      >
        <div className="h-full bg-blue-700 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-base text-slate-700">
        Documento: {datos.filename} · Página {actual.pageNumber}
      </p>
    </header>
  );

  const formulario = (
    <FormularioDuda
      key={actual.id}
      regionId={actual.id}
      yaCorregida={!!(guardados[actual.id] ?? actual.textoGuardado)}
      textoInicial={textoInicial(borradores.leer(actual.id), guardados[actual.id] ?? actual.textoGuardado, actual.sugerencia)}
      sugerencia={actual.sugerencia}
      esUltima={esUltima}
      puedeVolver={flujo.indice > 0}
      onCambio={(t) => borradores.guardar(actual.id, t)}
      onGuardar={alGuardar}
      onOmitir={alOmitir}
      onAnterior={() => setFlujo((f) => anterior(f, dudas))}
      atajos={escritorio && !ampliado}
      enModal={ampliado && !!img}
      enterGuarda={ampliado && !!img && escritorio}
    />
  );

  const recorte = img ? (
    <RecorteCanvas
      img={img}
      bbox={actual.bbox}
      numero={flujo.indice + 1}
      altoMax={escritorio ? Math.max(260, Math.min(560, window.innerHeight * 0.45)) : undefined}
      onAbrir={() => setAmpliado(true)}
    />
  ) : errorImg ? (
    <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-400" role="alert">
      <p>No se pudo cargar la imagen.</p>
      <button type="button" className="btn btn-secondary mt-2" onClick={reintentar}>
        Intentar otra vez
      </button>
    </div>
  ) : (
    <p role="status" className="py-10 text-center text-slate-600">
      Cargando imagen…
    </p>
  );

  const visorAmpliado = ampliado && img && (
    <VisorAmpliado img={img} bbox={actual.bbox} numero={flujo.indice + 1} onCerrar={() => setAmpliado(false)} formulario={formulario} total={dudas.length} tactil={!escritorio} />
  );

  if (escritorio) {
    const paginaDuda = datos.pages.find((p) => p.pageNumber === actual.pageNumber) ?? pagina;
    return (
      <div className="flex flex-col gap-3 pb-4">
        {encabezado}
        {conError > 0 && <ErrorGuardado cantidad={conError} onReintentar={reintentarTodo} />}
        <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(24rem,1fr)] items-start gap-6">
          <div className="space-y-2">
            {paginaDuda && (
              <PaginaVisor
                imagenUrl={imagenVisor?.src ?? ''}
                proporcion={paginaDuda.height / paginaDuda.width}
                dudas={dudas}
                estados={flujo.estados}
                pageNumber={paginaDuda.pageNumber}
                actualId={actual.id}
                onElegir={(i) => setFlujo((f) => irA(f, dudas, i))}
                claseAlto="h-[calc(100dvh-13rem)] min-h-96"
                escalaFoco={1.6}
              />
            )}
            <p className="text-sm text-slate-600">
              Haz clic en un recuadro para ir a esa duda. Rueda del ratón para acercar, arrastra para mover.
            </p>
          </div>
          <aside className="sticky top-16 space-y-3" aria-label="Duda actual">
            {recorte}
            {img && <p className="text-sm text-slate-600">Haz clic en el recorte para verlo más grande.</p>}
            {/* Con el modal abierto el formulario vive dentro de él (un solo campo a la vez). */}
            {!(ampliado && img) && formulario}
            <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700" aria-label="Atajos de teclado">
              <p className="font-semibold">Atajos</p>
              <ul className="mt-1 space-y-0.5">
                <li><kbd className="font-mono">Enter</kbd> guardar y pasar a la siguiente (<kbd className="font-mono">Mayús + Enter</kbd> nueva línea)</li>
                <li><kbd className="font-mono">Alt + ←</kbd> / <kbd className="font-mono">Alt + →</kbd> duda anterior / siguiente</li>
              </ul>
            </div>
          </aside>
        </div>
        {visorAmpliado}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md flex-col gap-3 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {encabezado}

      {conError > 0 && <ErrorGuardado cantidad={conError} onReintentar={reintentarTodo} />}

      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Cómo ver el documento">
        {(['recorte', 'pagina'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={modo === m}
            onClick={() => setModo(m)}
            className={`btn ${modo === m ? '' : 'btn-secondary'}`}
          >
            {m === 'recorte' ? 'Recorte' : 'Página completa'}
          </button>
        ))}
      </div>

      {modo === 'recorte' ? (
        <>
          {recorte}
          {img && <p className="text-sm text-slate-600">Toca el recorte para verlo más grande.</p>}
        </>
      ) : (
        pagina && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                aria-label="Página anterior"
                disabled={posPagina <= 0}
                onClick={() => setPaginaVista(idxEnPagina[posPagina - 1])}
              >
                ‹
              </button>
              <span className="text-base">
                Página {paginaNum} de {datos.pages.length}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                aria-label="Página siguiente"
                disabled={posPagina >= idxEnPagina.length - 1}
                onClick={() => setPaginaVista(idxEnPagina[posPagina + 1])}
              >
                ›
              </button>
            </div>
            <PaginaVisor
              imagenUrl={imagenVisor?.src ?? ''}
              proporcion={pagina.height / pagina.width}
              dudas={dudas}
              estados={flujo.estados}
              pageNumber={pagina.pageNumber}
              actualId={actual.id}
              onElegir={(i) => setFlujo((f) => irA(f, dudas, i))}
            />
            <p className="text-sm text-slate-600">
              Toca un recuadro para ir a esa duda. Pellizca o toca dos veces para acercar.
            </p>
          </div>
        )
      )}

      {/* Con el modal abierto el formulario vive dentro de él (un solo campo a la vez). */}
      {!(ampliado && img) && formulario}
      {visorAmpliado}
    </div>
  );
}

function ErrorGuardado({ cantidad, onReintentar }: { cantidad: number; onReintentar: () => void }) {
  return (
    <div role="alert" className="rounded-xl bg-amber-50 p-3 text-left ring-1 ring-amber-500">
      <p className="font-semibold">
        {cantidad === 1 ? 'Una respuesta no se pudo guardar.' : `${cantidad} respuestas no se pudieron guardar.`}
      </p>
      <p>Lo que escribiste sigue aquí. Revisa tu conexión.</p>
      <button type="button" className="btn mt-2 w-full" onClick={onReintentar}>
        Intentar guardar otra vez
      </button>
    </div>
  );
}
