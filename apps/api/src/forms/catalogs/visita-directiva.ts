import type { FormCatalog } from './catalog.types';
import { fecha, largo, texto } from './helpers';

const S = 'Informe de padecimiento';

export const VISITA_DIRECTIVA: FormCatalog = {
  id: 'visita-directiva',
  titulo: 'Informe de padecimiento (visita directiva)',
  archivo: 'FORMATO_VISITA_DIRECTIVA.pdf',
  campos: [
    texto('unidad_medica', 'Unidad médica', S, 'Text1', '', {
      porDefecto: '50 DOCTORS S.A DE C.V.',
      soloManual: true,
    }),
    texto(
      'nombre_paciente',
      'Nombre del paciente',
      S,
      'nombre',
      'Nombre completo del paciente (derechohabiente) tal como aparece en el correo o la síntesis.',
      { maxLen: 120 },
    ),
    texto(
      'ficha',
      'Ficha',
      S,
      'Ficha',
      'Número de ficha PEMEX del derechohabiente, solo si aparece de forma explícita.',
      { maxLen: 30 },
    ),
    texto(
      'servicio',
      'Servicio',
      S,
      'servicio',
      'Servicio o especialidad donde está internado el paciente (p. ej. Medicina interna, Cirugía general).',
      { maxLen: 80 },
    ),
    largo(
      'naturaleza_internamiento',
      'La naturaleza de su internamiento es',
      S,
      'La naturaleza  de su internamiento es 1',
      'Explicación sencilla y breve de por qué está internado el paciente: diagnóstico principal, estado actual, tratamiento en curso y pronóstico, en lenguaje claro para el paciente y su familia.',
      {
        maxLen: 1200,
        sufijo: '\n\nPEMEX SE RESERVA DERECHO DE TRASLADO',
        porDefecto:
          '\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\nPEMEX SE RESERVA DERECHO DE TRASLADO',
      },
    ),
    texto(
      'derechohabiente_nombre',
      'Nombre de quien firma (Yo, ...)',
      S,
      'Yo',
      'Nombre del derechohabiente (paciente) que declara haber recibido la información, solo si aparece.',
      { maxLen: 120 },
    ),
    fecha(
      'fecha_informacion',
      'Fecha en que recibió la información',
      S,
      'Que he recibido de fotma integra informacion completa de la naruraleza de mi internamieno asi como el',
      '',
      { soloManual: true },
    ),
    texto('firma_paciente', 'Nombre y firma del paciente', S, 'Text2', '', {
      soloManual: true,
    }),
    texto(
      'firma_familiar',
      'Nombre y firma del familiar responsable',
      S,
      'Text3',
      '',
      { soloManual: true },
    ),
  ],
};
