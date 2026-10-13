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
    beforeEach(() => limpiarCacheSugerencias());
    afterEach(() => vi.unstubAllGlobals());
    const abierta = { ...base, yaCorregida: false };
    const ruta = 'POST /api/ocr/regions/r1/suggest';

    it('no llama a la IA hasta pulsar; una pulsación = una llamada con el texto actual', async () => {
      const f = mockFetch({ [ruta]: { body: { sugerencias: ['120', '12O'] } } });
      render(<FormularioDuda {...abierta} textoInicial="12o" sugerencia="" onGuardar={() => {}} />);
      expect(callsOf(f)).toEqual([]);
      expect(screen.queryByRole('status')).toBeNull();
      await userEvent.type(screen.getByLabelText('¿Qué dice aquí?'), 'x');
      await userEvent.click(screen.getByRole('button', { name: 'Obtener recomendaciones' }));
      await screen.findByRole('button', { name: /Sugerencia 2/ });
      expect(callsOf(f)).toEqual([ruta]);
      expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ texto: '12ox' });
    });
    it('muestra «leyendo…» con el botón deshabilitado y al elegir una sugerencia rellena el cuadro', async () => {
      let soltar: () => void = () => {};
      const espera = new Promise<void>((r) => (soltar = r));
      mockFetch({ [ruta]: async () => (await espera, { body: { sugerencias: ['120', '12O'] } }) });
      const onCambio = vi.fn();
      render(<FormularioDuda {...abierta} onCambio={onCambio} textoInicial="12o" sugerencia="" onGuardar={() => {}} />);
      await userEvent.click(screen.getByRole('button', { name: 'Obtener recomendaciones' }));
      expect(screen.getByRole('status')).toHaveTextContent('La IA está leyendo el recorte…');
      expect(screen.getByRole('button', { name: 'Obtener recomendaciones' })).toBeDisabled();
      soltar();
      const b = await screen.findByRole('button', { name: /Sugerencia 2/ });
      expect(screen.getByRole('button', { name: /Sugerencia 1/ })).toBeInTheDocument();
      expect(screen.queryByRole('status')).toBeNull();
      await userEvent.click(b);
      expect(screen.getByLabelText('¿Qué dice aquí?')).toHaveValue('12O');
      expect(onCambio).toHaveBeenCalledWith('12O');
    });
    it('si falla o viene vacío, avisa y «Intentar otra vez» repite la llamada', async () => {
      const f = mockFetch({ [ruta]: { status: 500, body: { message: 'x' } } });
      render(<FormularioDuda {...abierta} textoInicial="abc" sugerencia="" onGuardar={() => {}} />);
      await userEvent.click(screen.getByRole('button', { name: 'Obtener recomendaciones' }));
      expect(await screen.findByText('No se pudieron obtener recomendaciones.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Sugerencia/ })).toBeNull();
      expect(screen.getByRole('button', { name: 'Guardar y siguiente' })).toBeEnabled();
      mockFetch({ [ruta]: { body: { sugerencias: [] } } });
      await userEvent.click(screen.getByRole('button', { name: 'Intentar otra vez' }));
      await waitFor(() => expect(screen.getByText('No se pudieron obtener recomendaciones.')).toBeInTheDocument());
      expect(f).toBeDefined();
      const g = mockFetch({ [ruta]: { body: { sugerencias: ['ok'] } } });
      await userEvent.click(screen.getByRole('button', { name: 'Intentar otra vez' }));
      await screen.findByRole('button', { name: /Sugerencia 1/ });
      expect(callsOf(g)).toEqual([ruta]);
    });
    it('al volver a una duda ya consultada muestra las sugerencias sin nueva llamada', async () => {
      const f = mockFetch({ [ruta]: { body: { sugerencias: ['a'] } } });
      const { unmount } = render(<FormularioDuda {...abierta} textoInicial="x" sugerencia="" onGuardar={() => {}} />);
      await userEvent.click(screen.getByRole('button', { name: 'Obtener recomendaciones' }));
      await screen.findByRole('button', { name: /Sugerencia 1/ });
      unmount();
      render(<FormularioDuda {...abierta} textoInicial="x" sugerencia="" onGuardar={() => {}} />);
      expect(screen.getByRole('button', { name: /Sugerencia 1/ })).toBeInTheDocument();
      expect(callsOf(f)).toEqual([ruta]);
    });
    it('con las sugerencias apagadas en Ajustes no muestra el botón ni llama a la IA', () => {
      const f = mockFetch({});
      render(<FormularioDuda {...abierta} sugerenciasActivas={false} textoInicial="x" sugerencia="" onGuardar={() => {}} />);
      expect(screen.queryByRole('button', { name: 'Obtener recomendaciones' })).toBeNull();
      expect(callsOf(f)).toEqual([]);
    });
    it('si la duda ya está corregida no ofrece recomendaciones', () => {
      const f = mockFetch({});
      render(<FormularioDuda {...base} textoInicial="x" sugerencia="" onGuardar={() => {}} />);
      expect(screen.queryByRole('button', { name: 'Obtener recomendaciones' })).toBeNull();
      expect(callsOf(f)).toEqual([]);
    });
  });
});
