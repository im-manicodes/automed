import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VisorAmpliado from './VisorAmpliado';
import RecorteCanvas from './RecorteCanvas';
import FormularioDuda from './FormularioDuda';

function imagen(): HTMLImageElement {
  const img = new Image();
  Object.defineProperty(img, 'naturalWidth', { value: 1000 });
  Object.defineProperty(img, 'naturalHeight', { value: 1400 });
  img.src = 'http://localhost/pagina.png';
  return img;
}
const bbox = { x: 0.2, y: 0.3, w: 0.2, h: 0.05 };

function Escenario() {
  const [abierto, setAbierto] = useState(false);
  const img = imagen();
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)}>
        Abrir
      </button>
      {abierto && <VisorAmpliado img={img} bbox={bbox} numero={2} onCerrar={() => setAbierto(false)} />}
    </>
  );
}

describe('VisorAmpliado', () => {
  it('es un diálogo modal accesible con recuadro rojo y controles de zoom', () => {
    render(<VisorAmpliado img={imagen()} bbox={bbox} numero={2} onCerrar={() => {}} />);
    const d = screen.getByRole('dialog');
    expect(d).toHaveAttribute('aria-modal', 'true');
    expect(d).toHaveAccessibleName('Recorte ampliado de la duda 2');
    expect(screen.getByTestId('recuadro-duda')).toBeInTheDocument();
    for (const n of ['Acercar', 'Alejar', 'Ajustar', 'Cerrar']) {
      expect(screen.getByRole('button', { name: n })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus();
  });

  it('cierra con Esc y con el botón Cerrar, y devuelve el foco', async () => {
    render(<Escenario />);
    const abrir = screen.getByRole('button', { name: 'Abrir' });
    await userEvent.click(abrir);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(abrir).toHaveFocus();

    await userEvent.click(abrir);
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(abrir).toHaveFocus();
  });

  it('el botón + acerca y la rueda no deja la página sin controlar', () => {
    render(<VisorAmpliado img={imagen()} bbox={bbox} numero={1} onCerrar={() => {}} />);
    const recuadro = screen.getByTestId('recuadro-duda');
    const antes = recuadro.style.border;
    fireEvent.click(screen.getByRole('button', { name: 'Acercar' }));
    expect(recuadro.style.border).not.toBe(antes);
    const caja = screen.getByTestId('visor-caja');
    const ev = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true });
    caja.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('RecorteCanvas con onAbrir', () => {
  it('abre al hacer clic y con Enter', async () => {
    const onAbrir = vi.fn();
    render(<RecorteCanvas img={imagen()} bbox={bbox} numero={3} onAbrir={onAbrir} />);
    const b = screen.getByRole('button', { name: /Ver más grande el recorte de la duda 3/ });
    await userEvent.click(b);
    expect(onAbrir).toHaveBeenCalledTimes(1);
    b.focus();
    await userEvent.keyboard('{Enter}');
    expect(onAbrir).toHaveBeenCalledTimes(2);
  });
});

describe('VisorAmpliado con formulario', () => {
  const formulario = (onGuardar = vi.fn()) => (
    <FormularioDuda
      regionId="r1"
      yaCorregida
      textoInicial=""
      sugerencia=""
      esUltima={false}
      puedeVolver={false}
      onCambio={() => {}}
      onGuardar={onGuardar}
      onOmitir={() => {}}
      onAnterior={() => {}}
      enModal
    />
  );

  it('muestra el campo dentro del modal y lo enfoca al abrir', () => {
    render(<VisorAmpliado img={imagen()} bbox={bbox} numero={2} onCerrar={() => {}} formulario={formulario()} />);
    const campo = screen.getByRole('textbox', { name: '¿Qué dice aquí?' });
    expect(screen.getByRole('dialog')).toContainElement(campo);
    expect(campo).toHaveFocus();
  });

  it('Enter guarda el texto escrito; Mayús+Enter no', async () => {
    const onGuardar = vi.fn();
    render(<VisorAmpliado img={imagen()} bbox={bbox} numero={2} onCerrar={() => {}} formulario={formulario(onGuardar)} />);
    await userEvent.keyboard('sonda de drenaje');
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onGuardar).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    expect(onGuardar).toHaveBeenCalledWith(expect.stringContaining('sonda de drenaje'));
  });

  it('Tab recorre el campo y los botones sin salir del diálogo, y Esc cierra', async () => {
    const onCerrar = vi.fn();
    render(<VisorAmpliado img={imagen()} bbox={bbox} numero={2} onCerrar={onCerrar} formulario={formulario()} />);
    const d = screen.getByRole('dialog');
    for (let i = 0; i < 12; i++) {
      await userEvent.tab();
      expect(d).toContainElement(document.activeElement as HTMLElement);
    }
    await userEvent.keyboard('{Escape}');
    expect(onCerrar).toHaveBeenCalled();
  });
});

describe('VisorAmpliado táctil', () => {
  const campoForm = (
    <FormularioDuda
      regionId="r1"
      yaCorregida
      textoInicial=""
      sugerencia=""
      esUltima={false}
      puedeVolver={false}
      onCambio={() => {}}
      onGuardar={() => {}}
      onOmitir={() => {}}
      onAnterior={() => {}}
      enModal
      enterGuarda={false}
    />
  );

  it('no enfoca el campo (enfoca Cerrar) y muestra el texto táctil y «Duda N de M»', () => {
    render(<VisorAmpliado img={imagen()} bbox={bbox} numero={2} total={5} onCerrar={() => {}} formulario={campoForm} tactil />);
    expect(screen.getByRole('textbox', { name: '¿Qué dice aquí?' })).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus();
    expect(screen.getByText(/Pellizca para acercar/)).toBeInTheDocument();
    expect(screen.queryByText(/Rueda del ratón/)).toBeNull();
    expect(screen.getByText('Duda 2 de 5')).toBeInTheDocument();
  });

  it('en escritorio mantiene el texto del ratón', () => {
    render(<VisorAmpliado img={imagen()} bbox={bbox} numero={2} onCerrar={() => {}} />);
    expect(screen.getByText(/Rueda del ratón/)).toBeInTheDocument();
    expect(screen.queryByText(/Pellizca/)).toBeNull();
  });

  it('el pellizco con dos dedos cambia la escala', () => {
    render(<VisorAmpliado img={imagen()} bbox={bbox} numero={1} onCerrar={() => {}} tactil />);
    const caja = screen.getByTestId('visor-caja');
    const recuadro = screen.getByTestId('recuadro-duda');
    const antes = recuadro.style.border;
    fireEvent.pointerDown(caja, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(caja, { pointerId: 2, clientX: 140, clientY: 100 });
    fireEvent.pointerMove(caja, { pointerId: 2, clientX: 260, clientY: 100 });
    expect(recuadro.style.border).not.toBe(antes);
    fireEvent.pointerUp(caja, { pointerId: 2 });
    fireEvent.pointerUp(caja, { pointerId: 1 });
  });

  it('el botón Atrás del navegador (popstate) cierra el modal', async () => {
    const onCerrar = vi.fn();
    render(<VisorAmpliado img={imagen()} bbox={bbox} numero={1} onCerrar={onCerrar} tactil />);
    expect(window.history.state).toMatchObject({ amModalAtras: true });
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });
});
