import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import FormularioDuda from './FormularioDuda';
import PaginaVisor from './PaginaVisor';
import RecorteCanvas from './RecorteCanvas';
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
import { obtenerPaginas } from './revisionApi';
import { useGuardado } from './useGuardado';
import { usePaginaImagen } from './usePaginaImagen';

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
  const [datos, setDatos] = useState<ApiPagesResponse | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [cargaN, setCargaN] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setErrorCarga(null);
    obtenerPaginas(attachmentId)
      .then((d) => !cancelado && setDatos(d))
      .catch((e: Error) => !cancelado && setErrorCarga(e.message));
    return () => {
      cancelado = true;
    };
  }, [attachmentId, cargaN]);

  if (errorCarga) {
    return (
      <Centro>
        <p className="text-lg">No pudimos abrir el documento.</p>
        <p className="text-slate-600">{errorCarga}</p>
        <button type="button" className="btn" onClick={() => setCargaN((n) => n + 1)}>
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
  const [guardados, setGuardados] = useState<Record<string, string>>({});
  const { estados, enviar, reintentarTodo, conError, guardando } = useGuardado();
  const titulo = useRef<HTMLHeadingElement>(null);

  const actual = dudas[flujo.indice];
  const paginaNum = paginaVista ?? actual?.pageNumber ?? datos.pages[0]?.pageNumber;
  const pagina = datos.pages.find((p) => p.pageNumber === paginaNum);
  const { img, error: errorImg, reintentar } = usePaginaImagen(attachmentId, actual?.pageNumber);

  // Al cambiar de duda, la vista de página sigue a la duda y el foco vuelve al encabezado (anuncia el avance).
  useEffect(() => {
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
    },
    [actual, flujo, dudas, enviar],
  );

  const alOmitir = () => {
    if (!actual) return;
    const f = flujo.estados[actual.id] === 'guardada' ? flujo : marcar(flujo, actual.id, 'omitida');
    const r = avanzar(f, dudas);
    setFlujo(r.flujo);
    setTerminado(r.terminado);
  };

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

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md flex-col gap-3 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <header>
        <div className="flex items-baseline justify-between gap-2">
          <h1 ref={titulo} tabIndex={-1} className="text-2xl font-bold outline-none" aria-live="polite">
            Duda {flujo.indice + 1} de {dudas.length}
          </h1>
          <span className="text-base text-slate-700" role="status">
            {guardadoActual === 'guardando' && 'Guardando…'}
            {guardadoActual === 'guardado' && '✓ Guardado'}
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
        img ? (
          <RecorteCanvas img={img} bbox={actual.bbox} numero={flujo.indice + 1} />
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
        )
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
              imagenUrl={`/api/attachments/${encodeURIComponent(attachmentId)}/pages/${pagina.pageNumber}/image`}
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

      <FormularioDuda
        key={actual.id}
        textoInicial={textoInicial(borradores.leer(actual.id), guardados[actual.id] ?? actual.textoGuardado, actual.sugerencia)}
        sugerencia={actual.sugerencia}
        esUltima={esUltima}
        puedeVolver={flujo.indice > 0}
        onCambio={(t) => borradores.guardar(actual.id, t)}
        onGuardar={alGuardar}
        onOmitir={alOmitir}
        onAnterior={() => setFlujo((f) => anterior(f, dudas))}
      />
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
