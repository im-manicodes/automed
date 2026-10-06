import { useEffect, useRef, useState } from 'react';
import { MARCADOR_ILEGIBLE, textoEnviable } from './lib/borrador';

interface Props {
  textoInicial: string;
  sugerencia: string;
  esUltima: boolean;
  puedeVolver: boolean;
  onCambio: (texto: string) => void;
  onGuardar: (texto: string) => void;
  onOmitir: () => void;
  onAnterior: () => void;
  /** Atajos de teclado de escritorio (Enter guarda y pasa a la siguiente). */
  atajos?: boolean;
}

/** Campo grande + botones de la duda actual. Se remonta (key) en cada duda. */
export default function FormularioDuda({
  textoInicial,
  sugerencia,
  esUltima,
  puedeVolver,
  onCambio,
  onGuardar,
  onOmitir,
  onAnterior,
  atajos = false,
}: Props) {
  const [texto, setTexto] = useState(textoInicial);
  const campo = useRef<HTMLTextAreaElement>(null);
  const valido = textoEnviable(texto) !== null;

  const centrar = () => {
    // El teclado del celular tapa la parte baja: lleva el campo al centro de lo visible.
    setTimeout(() => campo.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
  };

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const alCambiar = () => {
      if (document.activeElement === campo.current) campo.current?.scrollIntoView({ block: 'center' });
    };
    vv.addEventListener('resize', alCambiar);
    return () => vv.removeEventListener('resize', alCambiar);
  }, []);

  // Enter (sin Shift) o Ctrl+Enter guardan; con foco en un botón/enlace Enter conserva su función normal.
  const textoRef = useRef(texto);
  const guardarRef = useRef(onGuardar);
  useEffect(() => {
    textoRef.current = texto;
    guardarRef.current = onGuardar;
  });
  useEffect(() => {
    if (!atajos) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.altKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const enTexto = tag === 'TEXTAREA' || (tag === 'INPUT' && (el as HTMLInputElement).type === 'text');
      if (!e.ctrlKey && (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT' || (tag === 'INPUT' && !enTexto))) return;
      if (e.shiftKey && !e.ctrlKey) return; // Shift+Enter = salto de línea
      if (el?.closest('[role="dialog"]')) return;
      const t = textoEnviable(textoRef.current);
      if (!t) return;
      e.preventDefault();
      guardarRef.current(t);
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [atajos]);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const t = textoEnviable(texto);
        if (t) onGuardar(t);
      }}
    >
      <label htmlFor="texto-duda" className="block text-lg font-semibold">
        ¿Qué dice aquí?
      </label>
      {sugerencia && texto !== sugerencia && (
        <button
          type="button"
          className="text-left text-base text-blue-800 underline"
          onClick={() => {
            setTexto(sugerencia);
            onCambio(sugerencia);
          }}
        >
          Usar lo que leyó la máquina: “{sugerencia}”
        </button>
      )}
      <textarea
        id="texto-duda"
        ref={campo}
        value={texto}
        rows={3}
        maxLength={2000}
        autoComplete="off"
        autoCapitalize="sentences"
        spellCheck={false}
        enterKeyHint="done"
        placeholder="Escribe lo que ves en el recuadro rojo"
        onFocus={centrar}
        onChange={(e) => {
          setTexto(e.target.value);
          onCambio(e.target.value);
        }}
        className="block min-h-28 w-full rounded-xl border-2 border-slate-400 bg-white p-3 text-xl focus:border-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200"
      />
      <button type="submit" className="btn w-full text-lg disabled:opacity-50" disabled={!valido}>
        {esUltima ? 'Guardar y terminar' : 'Guardar y siguiente'}
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary" onClick={onAnterior} disabled={!puedeVolver}>
          Anterior
        </button>
        <button type="button" className="btn btn-secondary" onClick={onOmitir}>
          Omitir por ahora
        </button>
      </div>
      <button type="button" className="btn btn-secondary w-full" onClick={() => onGuardar(MARCADOR_ILEGIBLE)}>
        No se entiende
      </button>
    </form>
  );
}
