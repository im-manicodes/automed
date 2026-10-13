import { NotFoundException } from '@nestjs/common';
import { ReviewService } from './review.service';

describe('ReviewService.correctRegion', () => {
  const make = (region: unknown) => {
    const prisma: any = {
      ocrRegion: {
        findUnique: jest.fn().mockResolvedValue(region),
        update: jest.fn().mockResolvedValue({
          id: 'r1',
          status: 'corregido',
          userText: 'texto bueno',
        }),
      },
    };
    const pipeline: any = {
      onRegionsChanged: jest.fn().mockResolvedValue(['t1']),
    };
    return {
      svc: new ReviewService(prisma, pipeline),
      prisma,
      pipeline,
    };
  };

  it('marca corregido y reencola la síntesis de los hilos con ese sha256', async () => {
    const { svc, prisma, pipeline } = make({
      id: 'r1',
      page: { sha256: 'abc' },
    });
    const res = await svc.correctRegion('r1', 'texto bueno');
    expect(prisma.ocrRegion.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { userText: 'texto bueno', status: 'corregido', source: 'usuario' },
    });
    expect(pipeline.onRegionsChanged).toHaveBeenCalledWith('abc');
    expect(res).toMatchObject({
      status: 'corregido',
      hilosReencolados: ['t1'],
    });
  });

  it('404 si la región no existe', async () => {
    const { svc, pipeline } = make(null);
    await expect(svc.correctRegion('x', 'a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(pipeline.onRegionsChanged).not.toHaveBeenCalled();
  });
});
