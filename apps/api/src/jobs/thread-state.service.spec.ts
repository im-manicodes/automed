import { canTransition, ThreadStateService } from './thread-state.service';
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
});
