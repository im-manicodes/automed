import { BadRequestException } from '@nestjs/common';
import { TemplateInstructionsService } from './template-instructions.service';
import { DEFAULT_INSTRUCCIONES } from './template-instructions';
import { fakePrisma } from '../../test/helpers/fake-prisma';

describe('TemplateInstructionsService', () => {
  const make = () => {
    const db = fakePrisma();
    return { db, svc: new TemplateInstructionsService(db as never) };
  };

  it('sin guardar devuelve el valor por defecto de cada tipo', async () => {
    const { svc } = make();
    expect(await svc.get('resumen')).toBe(DEFAULT_INSTRUCCIONES.resumen);
    expect(await svc.getAll()).toEqual(DEFAULT_INSTRUCCIONES);
  });

  it('guarda por tipo, "" = sin instrucciones y null vuelve al defecto', async () => {
    const { svc } = make();
    await svc.save('whatsapp', ' Hola ');
    expect(await svc.get('whatsapp')).toBe('Hola');
    expect(await svc.get('resumen')).toBe(DEFAULT_INSTRUCCIONES.resumen);
    await svc.save('whatsapp', '');
    expect(await svc.get('whatsapp')).toBe('');
    await svc.save('whatsapp', null);
    expect(await svc.get('whatsapp')).toBe(DEFAULT_INSTRUCCIONES.whatsapp);
  });

  it('rechaza más de 4000 caracteres en español y no guarda', async () => {
    const { svc } = make();
    await expect(svc.save('resumen', 'x'.repeat(4001))).rejects.toThrow(
      BadRequestException,
    );
    expect(await svc.get('resumen')).toBe(DEFAULT_INSTRUCCIONES.resumen);
  });

  it('la caché se invalida al guardar', async () => {
    const { svc } = make();
    await svc.get('resumen');
    await svc.save('resumen', 'Nuevo');
    expect(await svc.get('resumen')).toBe('Nuevo');
  });
});
