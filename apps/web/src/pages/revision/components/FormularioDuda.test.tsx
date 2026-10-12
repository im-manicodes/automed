import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach } from 'vitest';
import { mockFetch, callsOf } from '../../../test/mockFetch';
import FormularioDuda from './FormularioDuda';
import { limpiarCacheSugerencias } from '../hooks/useSugerencias';

const base = { regionId: 'r1', yaCorregida: true, esUltima: false, puedeVolver: true, onCambio: () => {}, onOmitir: () => {}, onAnterior: () => {} };

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

  describe('sugerencias de la IA', () => {
    beforeEach(() => limpiarCacheSugerencias());
    afterEach(() => vi.unstubAllGlobals());
    const abierta = { ...base, yaCorregida: false };

    it('muestra «leyendo…», luego 2 sugerencias y al elegir una rellena el cuadro', async () => {
      mockFetch({ 'POST /api/ocr/regions/r1/suggest': { body: { sugerencias: ['120', '12O'] } } });
      const onCambio = vi.fn();
      render(<FormularioDuda {...abierta} onCambio={onCambio} textoInicial="12o" sugerencia="" onGuardar={() => {}} />);
      expect(screen.getByRole('status')).toHaveTextContent('La IA está leyendo el recorte…');
      const b = await screen.findByRole('button', { name: /Sugerencia 2/ });
      expect(screen.getByRole('button', { name: /Sugerencia 1/ })).toBeInTheDocument();
      expect(screen.queryByRole('status')).toBeNull();
      await userEvent.click(b);
      expect(screen.getByLabelText('¿Qué dice aquí?')).toHaveValue('12O');
      expect(onCambio).toHaveBeenCalledWith('12O');
    });
    it('si falla, no muestra sugerencias y el formulario sigue usable', async () => {
      mockFetch({ 'POST /api/ocr/regions/r1/suggest': { status: 500, body: { message: 'x' } } });
      render(<FormularioDuda {...abierta} textoInicial="abc" sugerencia="" onGuardar={() => {}} />);
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
      expect(screen.queryByRole('button', { name: /Sugerencia/ })).toBeNull();
      expect(screen.getByRole('button', { name: 'Guardar y siguiente' })).toBeEnabled();
    });
    it('pide una sola vez por duda (caché) y no pide si ya está corregida', async () => {
      const f = mockFetch({ 'POST /api/ocr/regions/r1/suggest': { body: { sugerencias: ['a'] } } });
      const { unmount } = render(<FormularioDuda {...abierta} textoInicial="x" sugerencia="" onGuardar={() => {}} />);
      await screen.findByRole('button', { name: /Sugerencia 1/ });
      unmount();
      render(<FormularioDuda {...abierta} textoInicial="x" sugerencia="" onGuardar={() => {}} />);
      expect(screen.getByRole('button', { name: /Sugerencia 1/ })).toBeInTheDocument();
      expect(callsOf(f)).toEqual(['POST /api/ocr/regions/r1/suggest']);
      limpiarCacheSugerencias();
      render(<FormularioDuda {...base} regionId="r2" textoInicial="x" sugerencia="" onGuardar={() => {}} />);
      expect(callsOf(f)).toHaveLength(1);
    });
  });
});
