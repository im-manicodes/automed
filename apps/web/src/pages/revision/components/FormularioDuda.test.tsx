import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { mockFetch, callsOf } from '../../../test/mockFetch';
import FormularioDuda from './FormularioDuda';

const base = { esUltima: false, puedeVolver: true, onCambio: () => {}, onOmitir: () => {}, onAnterior: () => {} };

describe('FormularioDuda', () => {
  it('precarga la sugerencia y guarda el texto editado', async () => {
    const onGuardar = vi.fn();
    render(<FormularioDuda {...base} textoInicial="12O" sugerencia="12O" onGuardar={onGuardar} />);
    const campo = screen.getByLabelText('¿Qué dice aquí?');
    expect(campo).toHaveValue('12O');
    await userEvent.clear(campo);
    await userEvent.type(campo, '120');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y siguiente' }));
    expect(onGuardar).toHaveBeenCalledWith('120');
  });
  it('no deja guardar vacío y "No se entiende" envía el marcador', async () => {
    const onGuardar = vi.fn();
    render(<FormularioDuda {...base} textoInicial="" sugerencia="" onGuardar={onGuardar} />);
    expect(screen.getByRole('button', { name: 'Guardar y siguiente' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'No se entiende' }));
    expect(onGuardar).toHaveBeenCalledWith('[ilegible]');
  });
  it('con atajos, Enter guarda y Mayús+Enter no', async () => {
    const onGuardar = vi.fn();
    render(<FormularioDuda {...base} atajos textoInicial="abc" sugerencia="" onGuardar={onGuardar} />);
    await userEvent.click(screen.getByLabelText('¿Qué dice aquí?'));
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onGuardar).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    expect(onGuardar).toHaveBeenCalledTimes(1);
  });
  it('sin atajos, Enter en el campo no guarda', async () => {
    const onGuardar = vi.fn();
    render(<FormularioDuda {...base} textoInicial="abc" sugerencia="" onGuardar={onGuardar} />);
    await userEvent.click(screen.getByLabelText('¿Qué dice aquí?'));
    await userEvent.keyboard('{Enter}');
    expect(onGuardar).not.toHaveBeenCalled();
  });

  it('en el modal, Enter guarda por defecto y muestra la pista', async () => {
    const onGuardar = vi.fn();
    render(<FormularioDuda {...base} enModal textoInicial="abc" sugerencia="" onGuardar={onGuardar} />);
    expect(screen.getByText(/guarda y pasa a la siguiente/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('¿Qué dice aquí?'));
    await userEvent.keyboard('{Enter}');
    expect(onGuardar).toHaveBeenCalledWith('abc');
  });
  it('en el modal con enterGuarda=false, Enter no guarda y no hay pista', async () => {
    const onGuardar = vi.fn();
    render(<FormularioDuda {...base} enModal enterGuarda={false} textoInicial="abc" sugerencia="" onGuardar={onGuardar} />);
    expect(screen.queryByText(/guarda y pasa a la siguiente/)).toBeNull();
    await userEvent.click(screen.getByLabelText('¿Qué dice aquí?'));
    await userEvent.keyboard('{Enter}');
    expect(onGuardar).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y siguiente' }));
    expect(onGuardar).toHaveBeenCalledTimes(1);
  });

  describe('sugerencias de la IA', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('muestra de inmediato las sugerencias guardadas, sin botón ni llamadas; el clic rellena el cuadro', async () => {
      const f = mockFetch({});
      const onCambio = vi.fn();
      render(<FormularioDuda {...base} onCambio={onCambio} sugerenciasIa={['120', '12O']} textoInicial="12o" sugerencia="" onGuardar={() => {}} />);
      expect(screen.queryByRole('button', { name: /Obtener recomendaciones/ })).toBeNull();
      expect(screen.getByRole('button', { name: /Sugerencia 1: “120”/ })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /Sugerencia 2/ }));
      expect(screen.getByLabelText('¿Qué dice aquí?')).toHaveValue('12O');
      expect(onCambio).toHaveBeenCalledWith('12O');
      expect(callsOf(f)).toEqual([]);
    });
    it('sin sugerencias no hay botones ni llamadas', () => {
      const f = mockFetch({});
      render(<FormularioDuda {...base} textoInicial="x" sugerencia="" onGuardar={() => {}} />);
      expect(screen.queryByRole('button', { name: /Sugerencia|recomendaciones/ })).toBeNull();
      expect(callsOf(f)).toEqual([]);
    });
  });
});
