import { CONTACT_EMAIL, OWNER_NAME, SITE_NAME } from './siteConfig';

export const LEGAL_VERSION = '2026-11-11';
export const LEGAL_VERSION_DISPLAY = '11/11/2026';

export interface LegalSection {
  title: string;
  paragraphs: string[];
}

export const REPORT_REASONS = [
  'Aviso falso o estafa',
  'Discrimina',
  'Trabajo no registrado o ilegal',
  'Contenido inapropiado',
  'Uso indebido de datos personales',
  'Otro',
] as const;

export const TERMS_COMMON: LegalSection[] = [
  {
    title: '1. Qué es este sitio',
    paragraphs: [
      `${SITE_NAME} es un servicio comunitario y gratuito que facilita el contacto entre personas que buscan trabajo y comercios o empresas de la zona. No es una agencia de empleo ni interviene en convocatorias, selección, entrevistas, contratación ni condiciones de trabajo. No verifica la identidad de los usuarios ni la veracidad de los avisos o perfiles, y no garantiza resultados.`,
    ],
  },
  {
    title: '2. Quiénes pueden usarlo',
    paragraphs: [
      'Solo personas mayores de 18 años. Al ingresar declarás ser mayor de edad y que tus datos son verdaderos. Cada persona o comercio puede tener una sola cuenta. Quien registra un comercio declara tener facultades para hacerlo.',
    ],
  },
  {
    title: '3. Conductas prohibidas',
    paragraphs: [
      'Publicar avisos falsos o engañosos; discriminar por edad, sexo, género, origen, religión, discapacidad, aspecto físico u otra condición; ofrecer trabajo no registrado o ilegal; cobrar a los postulantes por conseguir un empleo; pedir datos bancarios; usar los datos de otros usuarios para un fin distinto de contactarlos por una oferta o búsqueda laboral (por ejemplo spam, reventa o difusión); copiar masivamente los datos del sitio; subir contenido ilícito o que no te pertenece.',
    ],
  },
  {
    title: '4. Cuidado con las estafas',
    paragraphs: [
      'Nunca pagues para conseguir un empleo ni compartas claves o datos bancarios. El sitio no verifica a los comercios.',
    ],
  },
  {
    title: '5. Moderación',
    paragraphs: [
      'Podemos pausar o eliminar avisos, perfiles o cuentas que incumplan estos términos o que sean denunciados, con o sin aviso previo. Podés denunciar desde la ficha de cada aviso o perfil.',
    ],
  },
  {
    title: '6. Responsabilidad',
    paragraphs: [
      'El sitio se ofrece "tal como está". No somos parte de la relación entre postulantes y comercios ni respondemos por lo que acuerden, por la información que publiquen ni por daños derivados de ese contacto, salvo en lo que la ley no permita limitar. Podemos interrumpir o modificar el servicio.',
    ],
  },
  {
    title: '7. Datos personales',
    paragraphs: ['Se rigen por la Política de Privacidad.'],
  },
  {
    title: '8. Cambios',
    paragraphs: [
      'Podemos actualizar estos textos; indicaremos la versión y te pediremos aceptarla de nuevo.',
    ],
  },
  {
    title: '9. Ley y jurisdicción',
    paragraphs: [
      'Rigen las leyes de la República Argentina. Para cualquier conflicto serán competentes los tribunales ordinarios con competencia en el partido de Carlos Tejedor, provincia de Buenos Aires.',
    ],
  },
  {
    title: '10. Responsable y contacto',
    paragraphs: [`${OWNER_NAME} — ${CONTACT_EMAIL}`],
  },
];

export const TERMS_CANDIDATE: LegalSection[] = [
  {
    title: 'Condiciones específicas para Postulantes',
    paragraphs: [
      'Tu perfil, tu CV y tu teléfono pueden ser vistos por comercios registrados mientras tu perfil esté activo o te postules a sus búsquedas. Podés pausar tu perfil cuando quieras.',
      'No incluyas datos sensibles en tu CV (salud, religión, opiniones políticas, afiliación sindical, vida sexual, origen racial o étnico).',
      'Sos responsable de que lo que cargás sea verdadero y te pertenezca.',
    ],
  },
];

export const TERMS_EMPLOYER: LegalSection[] = [
  {
    title: 'Condiciones específicas para Comercios y Empresas',
    paragraphs: [
      'Sos responsable de los avisos que publicás, de los logos y fotos que subís y de cumplir la normativa laboral aplicable.',
      'Los avisos no pueden discriminar, ofrecer trabajo no registrado ni pedir pagos o datos bancarios a los postulantes.',
      'Los datos de postulantes (CV, teléfono, nombre) se usan solo para contactarlos por una búsqueda laboral. Está prohibido usarlos para otro fin, cederlos o difundirlos. Sos responsable del tratamiento que hagas de los datos que obtengas.',
      'Cada acceso a un CV o pedido de contacto queda registrado.',
    ],
  },
];

export const PRIVACY: LegalSection[] = [
  {
    title: '1. Responsable',
    paragraphs: [
      `${OWNER_NAME}. Contacto para ejercer tus derechos: ${CONTACT_EMAIL}.`,
    ],
  },
  {
    title: '2. Qué datos tratamos',
    paragraphs: [
      'Postulantes: nombre, apellido, foto (opcional), teléfono, correo, fecha de nacimiento, localidad, situación laboral, disponibilidad, estudios, rubros y puestos, descripción y CV en PDF.',
      'Comercios: nombre comercial, logo, rubro, localidad, persona de contacto, teléfono, correo y avisos.',
      'Técnicos: dirección IP al pedir el código de ingreso (para evitar abusos), registro de accesos a CVs y de contactos, y constancia de tu aceptación de estos textos.',
    ],
  },
  {
    title: '3. Para qué',
    paragraphs: [
      'Únicamente para que postulantes y comercios puedan contactarse, para la seguridad del sitio y para atender denuncias.',
    ],
  },
  {
    title: '4. Quién ve qué',
    paragraphs: [
      'Quienes visitan sin ingresar solo ven la portada informativa del sitio. Los comercios registrados pueden ver el perfil laboral, el CV y pedir el teléfono de postulantes con perfil activo o que se hayan postulado a sus búsquedas; esos accesos quedan registrados. Los postulantes registrados ven los avisos laborales y los datos comerciales del comercio al que se postulan. El administrador accede a los datos para moderación, soporte y denuncias.',
    ],
  },
  {
    title: '5. Consentimiento',
    paragraphs: [
      'Al aceptar, consentís de forma expresa e informada este tratamiento, incluido que tu perfil, CV y teléfono se muestren a comercios registrados. Podés retirar el consentimiento pausando tu perfil o eliminando tu cuenta.',
    ],
  },
  {
    title: '6. Proveedores y transferencia al exterior',
    paragraphs: [
      'Usamos Supabase (base de datos), Netlify (alojamiento del sitio), Brevo (correos) y Cloudflare (verificación anti-robots). Sus servidores pueden estar fuera de la Argentina; al aceptar consentís expresamente esa transferencia.',
    ],
  },
  {
    title: '7. Conservación',
    paragraphs: [
      'Guardamos tus datos mientras tu cuenta esté activa. Las cuentas sin actividad durante 12 meses y los avisos vencidos se eliminan automáticamente; los registros de seguridad se conservan hasta 12 meses. Conservamos la constancia de aceptación de estos textos sin tus datos personales (solo un identificador no reversible).',
    ],
  },
  {
    title: '8. Tus derechos',
    paragraphs: [
      `Podés acceder a tus datos, rectificarlos, actualizarlos y suprimirlos. Desde tu perfil podés editar tus datos, descargarlos y eliminar tu cuenta. También podés escribir a ${CONTACT_EMAIL}: respondemos pedidos de acceso en 10 días corridos y de rectificación o supresión en 5 días hábiles.`,
    ],
  },
  {
    title: '9. Reclamos',
    paragraphs: [
      'La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.',
    ],
  },
  {
    title: '10. Seguridad',
    paragraphs: [
      'Los CVs se guardan en una zona privada, el acceso está restringido y registrado, y el ingreso usa códigos de un solo uso. Ningún sistema es infalible: si detectamos una filtración que te afecte, te avisaremos.',
    ],
  },
  {
    title: '11. Almacenamiento en tu navegador',
    paragraphs: [
      'Guardamos un identificador de sesión en el almacenamiento local para mantenerte conectado. No usamos publicidad ni seguimiento de terceros.',
    ],
  },
  {
    title: '12. Datos sensibles',
    paragraphs: ['No los cargues en tu CV ni en tu perfil.'],
  },
  {
    title: '13. Cambios',
    paragraphs: [
      'Si actualizamos esta política, cambiará la versión y te pediremos aceptarla de nuevo.',
    ],
  },
];
