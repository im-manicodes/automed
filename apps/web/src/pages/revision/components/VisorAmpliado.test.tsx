import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VisorAmpliado from './VisorAmpliado';
import RecorteCanvas from './RecorteCanvas';

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
