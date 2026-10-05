import {
  canTransition,
  stateOnNewContent,
  ThreadStateService,
} from './thread-state.service';
import { PrismaService } from '../prisma/prisma.service';

describe('transiciones de Thread', () => {
  it('flujo válido', () => {
    expect(canTransition('pendiente', 'procesando')).toBe(true);
    expect(canTransition('procesando', 'listo')).toBe(true);
    expect(canTransition('procesando', 'necesita_revision')).toBe(true);
    expect(canTransition('procesando', 'error')).toBe(true);
    expect(canTransition('listo', 'pendiente')).toBe(true);
    expect(canTransition('error', 'pendiente')).toBe(true);
  });
  it('transiciones inválidas', () => {
    expect(canTransition('pendiente', 'listo')).toBe(false);
    expect(canTransition('listo', 'procesando')).toBe(false);
    expect(canTransition('error', 'listo')).toBe(false);
  });

  it('transition rechaza lo inválido y no escribe', async () => {
    const prisma = {
      thread: {
        findUnique: jest.fn().mockResolvedValue({ status: 'pendiente' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const s = new ThreadStateService(prisma as unknown as PrismaService);
    expect(await s.transition('t', 'listo')).toBe(false);
    expect(prisma.thread.updateMany).not.toHaveBeenCalled();
    expect(await s.transition('t', 'procesando')).toBe(true);
    expect(prisma.thread.updateMany).toHaveBeenCalledWith({
      where: { id: 't', status: 'pendiente' },
      data: { status: 'procesando' },
    });
  });

  it('sin_analizar solo sale hacia pendiente', () => {
    expect(canTransition('sin_analizar', 'pendiente')).toBe(true);
    for (const to of [
      'procesando',
      'listo',
      'necesita_revision',
      'error',
    ] as const)
      expect(canTransition('sin_analizar', to)).toBe(false);
    expect(canTransition('listo', 'sin_analizar')).toBe(false);
    expect(canTransition('pendiente', 'sin_analizar')).toBe(false);
  });

  it('stateOnNewContent: nunca analizado no cambia', () => {
    expect(
      stateOnNewContent({
        status: 'sin_analizar',
        seguimiento: true,
        syntheses: 0,
      }),
    ).toBeNull();
  });
  it('stateOnNewContent: analizado con seguimiento -> pendiente', () => {
    expect(
      stateOnNewContent({ status: 'listo', seguimiento: true, syntheses: 1 }),
    ).toEqual({ status: 'pendiente', tieneMensajesNuevos: false });
  });
  it('stateOnNewContent: analizado sin seguimiento -> marca', () => {
    for (const status of ['listo', 'necesita_revision', 'error'] as const)
      expect(
        stateOnNewContent({ status, seguimiento: false, syntheses: 0 }),
      ).toEqual({ tieneMensajesNuevos: true });
  });
});
