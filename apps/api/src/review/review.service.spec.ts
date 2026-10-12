import { NotFoundException } from '@nestjs/common';
import { ReviewService, parseSugerencias } from './review.service';

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
      svc: new ReviewService(prisma, pipeline, {} as any, {} as any, {} as any),
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

jest.mock('../ocr/image-crop', () => ({
  cropRegionPng: jest.fn().mockResolvedValue(new Uint8Array([1])),
}));

describe('ReviewService.suggest', () => {
  const region = {
    id: 'r1',
    x: 0.1,
    y: 0.1,
    w: 0.2,
    h: 0.05,
    page: { imageKey: 'k.png' },
  };
  const make = (reg: unknown, complete: jest.Mock) => {
    const prisma: any = {
      ocrRegion: {
        findUnique: jest.fn().mockResolvedValue(reg),
        update: jest.fn(),
      },
    };
    const pipeline: any = { onRegionsChanged: jest.fn() };
    const storage: any = {
      get: jest.fn().mockResolvedValue(new Uint8Array(1)),
    };
    const llm: any = { complete };
    const ocrSettings: any = {
      getEffective: jest.fn().mockResolvedValue({ visionAmbito: 'x' }),
    };
    return {
      svc: new ReviewService(prisma, pipeline, storage, llm, ocrSettings),
      prisma,
      pipeline,
    };
  };

  it('usa vision_respaldo con 1 imagen y devuelve <= 2 válidas, sin escribir', async () => {
    const complete = jest
      .fn()
      .mockResolvedValue(
        '```json\n{"sugerencias":["Hola","hola","[ilegible]","Mundo","Otra"]}\n```',
      );
    const { svc, prisma, pipeline } = make(region, complete);
    const res = await svc.suggest('r1', 'texto');
    expect(res).toEqual({ sugerencias: ['Hola', 'Mundo'] });
    expect(complete.mock.calls[0][0]).toMatchObject({
      task: 'vision_respaldo',
    });
    expect(complete.mock.calls[0][0].images).toHaveLength(1);
    expect(prisma.ocrRegion.update).not.toHaveBeenCalled();
    expect(pipeline.onRegionsChanged).not.toHaveBeenCalled();
  });

  it('404 si la región no existe', async () => {
    const { svc } = make(null, jest.fn());
    await expect(svc.suggest('x', '')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('si el LLM falla devuelve []', async () => {
    const { svc } = make(region, jest.fn().mockRejectedValue(new Error('x')));
    expect(await svc.suggest('r1', 'a')).toEqual({ sugerencias: [] });
  });
});

describe('parseSugerencias', () => {
  it('filtra vacías, ilegibles, duplicadas e iguales al texto actual', () => {
    expect(
      parseSugerencias(
        'ok {"sugerencias":["", "Igual", "A b", "ab", "[ilegible] x"]} fin',
        'igual',
      ),
    ).toEqual(['A b']);
  });
  it('JSON roto o sin JSON -> []', () => {
    expect(parseSugerencias('{"sugerencias":[')).toEqual([]);
    expect(parseSugerencias('nada')).toEqual([]);
  });
});
