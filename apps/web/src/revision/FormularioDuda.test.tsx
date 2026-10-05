import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
});
