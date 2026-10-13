import type { FormCatalog } from './catalog.types';
import { SI_NO, fecha, largo, opcion, texto } from './helpers';

const ID = 'Identificación del paciente';
const AD = 'Adscripción y contrato';
const HC = 'Historia clínica';
const DX = 'Diagnóstico';
const PO = 'Dx postoperatorio';
const ME = 'Médico tratante';
const FI = 'Firmas y familiar';

export const CIRUGIA_F03: FormCatalog = {
  id: 'cirugia-f03',
  titulo: 'Solicitud de cirugía (F03)',
  archivo: 'FORMATO_CIRUGIA_F03.pdf',
  campos: [
    // ---- Página 1: identificación
    // REVISAR: ZONA D.F. / CIUDAD DE MÉXICO de fábrica parecen de otro paciente; se vacían (la IA los llena solo si aparecen)
    texto(
      'coordinacion',
      'Coordinación',
      ID,
      'coordinacion',
      'Coordinación PEMEX a la que pertenece el paciente, solo si aparece.',
      { maxLen: 80 },
    ),
    // REVISAR: «localidad» es un solo campo PDF con dos copias (arriba y en Adscripción); una sola clave para ambas
    texto(
      'localidad',
      'Localidad',
      ID,
      'localidad',
      'Localidad o ciudad de adscripción del paciente, solo si aparece.',
      { maxLen: 60 },
    ),
    // REVISAR: «programacion» trae una X de fábrica junto a «Programación de cirugía»; se conserva
    texto('programacion', 'Programación de cirugía', ID, 'programacion', '', {
      porDefecto: '    X',
      soloManual: true,
    }),
    texto(
      'nombre_paciente',
      'Nombres y apellidos del paciente',
      ID,
      'nombre 1',
      'Nombre completo del paciente: nombres, apellido paterno y materno.',
      { maxLen: 120 },
    ),
    texto(
      'ficha',
      'Ficha',
      ID,
      'ficha',
      'Número de ficha PEMEX, solo si aparece de forma explícita.',
      { maxLen: 15 },
    ),
    texto(
      'cod',
      'COD',
      ID,
      'cod',
      'Código (COD) del derechohabiente, solo si aparece de forma explícita.',
      { maxLen: 15 },
    ),
    texto('edad', 'Edad', ID, 'edad', 'Edad del paciente en años.', {
      maxLen: 6,
    }),
    opcion(
      'sexo',
      'Sexo',
      ID,
      [
        ['masculino', 'Masculino', 'm1'],
        ['femenino', 'Femenino', 'f1'],
      ],
      'Sexo del paciente.',
    ),
    texto('centro_trabajo', 'Centro de trabajo', ID, 'centro de trabajo', '', {
      soloManual: true,
    }),
    texto(
      'departamento',
      'Departamento',
      ID,
      'departamento',
      'Departamento laboral del paciente, solo si aparece.',
      { maxLen: 40 },
    ),
    texto(
      'regimen_contractual',
      'Régimen contractual',
      ID,
      'regimen contractual',
      'Régimen contractual (planta, transitorio, jubilado...), solo si aparece.',
      { maxLen: 40 },
    ),
    texto(
      'vigencia_clausula',
      'Vigencia / cláusula',
      ID,
      'vigencia',
      'Vigencia o cláusula de derechos, solo si aparece.',
      { maxLen: 40 },
    ),
    opcion(
      'tipo_cirugia',
      'Tipo de cirugía',
      ID,
      [
        ['urgencia', 'Urgencia', 'Check Box14'],
        ['electivo', 'Electivo', 'Check Box15'],
      ],
      'Si la cirugía es de urgencia o electiva.',
    ),
    texto(
      'unidad_referencia',
      'Unidad de referencia',
      AD,
      'unidad de referencia',
      'Unidad médica que refiere al paciente, solo si aparece.',
      { maxLen: 100 },
    ),
    texto(
      'adscripcion',
      'Adscripción del paciente',
      AD,
      'adscripcion',
      'Unidad o centro al que está adscrito el paciente, solo si aparece.',
      { maxLen: 60 },
    ),
    // REVISAR: Text19 tiene la etiqueta «COORDINACIÓN» en la segunda fila (Adscripción); distinta de la de arriba
    texto(
      'coordinacion_adscripcion',
      'Coordinación (adscripción)',
      AD,
      'Text19',
      'Coordinación de la adscripción del paciente, solo si aparece.',
      { maxLen: 40 },
    ),
    texto('proveedor', 'Proveedor', AD, 'Text20', '', {
      porDefecto: '50 Doctors S.A. DE C.V.',
      soloManual: true,
    }),
    texto('contrato', 'Contrato', AD, 'Text21', '', {
      porDefecto: '4800031433',
      soloManual: true,
    }),
    texto(
      'dias_incapacidad',
      'Días de incapacidad',
      AD,
      'Text22',
      'Días de incapacidad, o «NA» si no aplica.',
      { maxLen: 10 },
    ),
    opcion(
      'accidente_trabajo',
      'Accidente de trabajo',
      AD,
      SI_NO('Check Box23', 'Check Box24'),
      'Si el padecimiento es por accidente de trabajo.',
    ),
    // ---- Historia clínica
    largo(
      'antecedentes_patologicos',
      'Antecedentes personales patológicos',
      HC,
      'Text25',
      'Antecedentes personales patológicos: enfermedades, cirugías, alergias, hospitalizaciones previas.',
      { maxLen: 500 },
    ),
    largo(
      'antecedentes_no_patologicos',
      'Antecedentes personales no patológicos',
      HC,
      'Text26',
      'Tabaquismo, alcoholismo, grupo sanguíneo y demás antecedentes no patológicos.',
      { maxLen: 500 },
    ),
    largo(
      'antecedentes_ginecobstetricos',
      'Antecedentes ginecobstétricos',
      HC,
      'Text27',
      'Antecedentes ginecobstétricos (gestas, partos, cesáreas, abortos), solo mujeres.',
      { maxLen: 500 },
    ),
    largo(
      'otros_antecedentes',
      'Otros antecedentes',
      HC,
      'Text28',
      'Otros antecedentes relevantes (heredofamiliares, medicación actual).',
      { maxLen: 500 },
    ),
    fecha(
      'fecha_inicio_padecimiento',
      'Fecha de inicio del padecimiento actual',
      HC,
      ['DÍA', 'MES', 'AÑO'],
      'Fecha de inicio del padecimiento actual (AAAA-MM-DD), si aparece.',
    ),
    // REVISAR: el PDF no tiene campo para «Principales síntomas»; Text29 es la exploración física
    largo(
      'exploracion_fisica',
      'Exploración física (signos vitales y somatometría)',
      HC,
      'Text29',
      'Signos vitales, somatometría y hallazgos de la exploración física.',
      { maxLen: 1200 },
    ),
    largo(
      'resultados_laboratorio',
      'Resultados de laboratorio y/o gabinete',
      HC,
      'Text30',
      'Resultados relevantes de laboratorio y gabinete (imagen).',
      { maxLen: 1200 },
    ),
    // ---- Página 2: diagnóstico
    texto(
      'dx_preoperatorio',
      'Dx preoperatorio (CIE 10)',
      DX,
      'Text31',
      'Diagnóstico preoperatorio con su código CIE-10 si aparece.',
      { maxLen: 150 },
    ),
    texto(
      'qx_planeada',
      'Qx planeada o procedimiento (CIE 9)',
      DX,
      'Text32',
      'Cirugía o procedimiento planeado con su código CIE-9 si aparece.',
      { maxLen: 150 },
    ),
    largo(
      'riesgo_qx_anestesia',
      'Riesgo quirúrgico / anestesia',
      DX,
      'Text33',
      'Riesgo quirúrgico y anestésico (p. ej. ASA, Goldman) si aparece.',
      { maxLen: 300 },
    ),
    opcion(
      'origen_padecimiento',
      'Origen del padecimiento',
      DX,
      [
        ['congenito', 'Congénito', 'Check Box34'],
        ['adquirido', 'Adquirido', 'Check Box35'],
      ],
      'Si el padecimiento es congénito o adquirido.',
    ),
    opcion(
      'curso_padecimiento',
      'Curso del padecimiento',
      DX,
      [
        ['agudo', 'Agudo', 'Check Box36'],
        ['cronico', 'Crónico', 'Check Box37'],
      ],
      'Si el padecimiento es agudo o crónico.',
    ),
    opcion(
      'relacionado_otro_padecimiento',
      'Relacionado a otro padecimiento, enfermedad o accidente',
      DX,
      SI_NO('Check Box38', 'Check Box39'),
      'Si se relaciona con otro padecimiento, enfermedad o accidente.',
    ),
    largo(
      'cual_relacionado',
      '¿Cuál?',
      DX,
      'Text40',
      'Cuál es el otro padecimiento, enfermedad o accidente relacionado.',
      { maxLen: 300 },
    ),
    fecha(
      'fecha_diagnostico',
      'Fecha de diagnóstico',
      DX,
      ['DÍA_2', 'MES_2', 'AÑO_2'],
      'Fecha del diagnóstico (AAAA-MM-DD), si aparece.',
    ),
    largo(
      'cirugia_realizada',
      'Cirugía realizada',
      PO,
      'Text41',
      'Cirugía ya realizada (solo si el paciente ya fue operado).',
      { maxLen: 600 },
    ),
    opcion(
      'hubo_complicaciones',
      '¿Hubo complicaciones?',
      PO,
      SI_NO('Check Box42', 'Check Box43'),
      'Si hubo complicaciones en la cirugía (solo si ya fue operado).',
    ),
    fecha(
      'fecha_inicio_complicaciones',
      'Fecha de inicio de complicaciones',
      PO,
      ['DÍA_3', 'MES_3', 'AÑO_3'],
      'Fecha de inicio de las complicaciones (AAAA-MM-DD), si aparece.',
    ),
    largo(
      'descripcion_complicaciones',
      'Descripción de complicaciones',
      PO,
      'Text44',
      'Descripción de las complicaciones, si las hubo.',
      { maxLen: 1000 },
    ),
    largo(
      'observaciones',
      'Observaciones',
      PO,
      'Text45',
      'Observaciones relevantes.',
      { maxLen: 500 },
    ),
    texto('hospital_nombre', 'Nombre del hospital', PO, 'Text68', '', {
      porDefecto: '50Doctors S.A DE C.V.',
      soloManual: true,
    }),
    texto('hospital_ciudad', 'Ciudad', PO, 'Text69', '', {
      porDefecto: 'PUEBLA PUEBLA',
      soloManual: true,
    }),
    opcion(
      'tipo_estancia',
      'Tipo de estancia',
      PO,
      [
        ['urgencia', 'Urgencia', 'Check Box46'],
        ['hospitalaria', 'Hospitalaria', 'Check Box47'],
        ['ambulatoria', 'Ambulatoria', 'Check Box48'],
        ['corta_estancia', 'Corta estancia', 'Check Box49'],
      ],
      'Tipo de estancia hospitalaria: urgencia, hospitalaria, ambulatoria o corta estancia.',
    ),
    // ---- Médico tratante
    texto(
      'medico_nombre',
      'Médico tratante: nombres y apellidos',
      ME,
      'Text50',
      'Nombre completo del médico tratante, si aparece.',
      { maxLen: 120 },
    ),
    texto(
      'medico_especialidad',
      'Especialidad',
      ME,
      'Text51',
      'Especialidad del médico tratante.',
      { maxLen: 60 },
    ),
    texto('medico_telefono', 'Teléfono', ME, 'Text52', '', {
      porDefecto: '222 689 2995',
      soloManual: true,
    }),
    texto('medico_cedula', 'Cédula profesional', ME, 'Text53', '', {
      soloManual: true,
    }),
    texto('medico_rfc', 'RFC', ME, 'Text54', '', { soloManual: true }),
    texto('proveedor_nombre', 'Nombre del proveedor', ME, 'Text55', '', {
      porDefecto: '50Doctors S.A DE C.V.',
      soloManual: true,
    }),
    texto('medico_mail', 'Mail', ME, 'Text56', '', {
      porDefecto: 'redmedica.puebla@50doctorshospital.com',
      soloManual: true,
    }),
    texto('medico_cedula_esp', 'Cédula de especialidad', ME, 'Text57', '', {
      soloManual: true,
    }),
    largo(
      'presupuesto',
      'Presupuesto',
      ME,
      'Text58',
      'Presupuesto o costos de la cirugía, solo si aparecen de forma explícita.',
      { maxLen: 800 },
    ),
    // ---- Página 3: firmas
    texto('lugar', 'Lugar', FI, 'Text59', '', {
      porDefecto: 'PUEBLA PUEBLA',
      soloManual: true,
    }),
    fecha(
      'fecha_firma',
      'Fecha de firma',
      FI,
      ['DÍA_4', 'MES_4', 'AÑO_4'],
      '',
      { soloManual: true },
    ),
    texto('medico_sectorial', 'Médico sectorial (nombre)', FI, 'Text60', '', {
      porDefecto: 'DRA.ERANDI PEÑALOZA SANCHEZ',
      soloManual: true,
    }),
    texto(
      'coordinador_zona',
      'Coordinador médico de zona (nombre)',
      FI,
      'Text61',
      '',
      {
        porDefecto: 'DRA. GUADALUPE ATHENEA SANCHEZ SALAZAR.',
        soloManual: true,
      },
    ),
    texto(
      'firma_paciente',
      'Nombre, ficha y firma del paciente',
      FI,
      'Text62',
      '',
      { soloManual: true },
    ),
    // REVISAR: Text63 queda sobre la línea del subgerente (Dr. Pedro Armando Chaidez Rosales); se infiere por posición
    texto(
      'firma_subgerencia',
      'Subgerencia de servicios médicos subrogados',
      FI,
      'Text63',
      '',
      { soloManual: true },
    ),
    texto(
      'urgencia_familiar_nombre',
      'Nota en caso de urgencia: nombre del familiar',
      FI,
      'Text65',
      '',
      { soloManual: true },
    ),
    texto(
      'urgencia_familiar_ficha',
      'Nota en caso de urgencia: ficha',
      FI,
      'Text66',
      '',
      { soloManual: true },
    ),
  ],
};
