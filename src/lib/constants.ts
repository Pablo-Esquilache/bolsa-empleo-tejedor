import { IndustryItem, LocalityItem } from '../types/database';

export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Bolsa de Empleo Tejedor';

export const WORK_SITUATIONS = [
  {
    id: 'seeking_job',
    label: 'Estoy buscando trabajo',
    description: 'Actualmente sin empleo fijo y disponible para empezar',
  },
  {
    id: 'Employed_seeking_change',
    label: 'Tengo trabajo, pero busco cambiar o sumar horas',
    description: 'Trabajando actualmente, abierto a nuevas propuestas o ingreso extra',
  },
] as const;

export const AVAILABILITY_OPTIONS = [
  'Tiempo completo (Full-time)',
  'Medio tiempo (Part-time)',
  'Por turnos / Rotativo',
  'Fines de semana / Francos',
  'Por hora / Temporal / Changas',
] as const;

export const EDUCATION_LEVELS = [
  'Primario',
  'Secundario en curso',
  'Secundario completo',
  'Terciario / Técnico en curso o completo',
  'Universitario en curso o completo',
  'Cursos y Oficios',
] as const;

export const INITIAL_LOCALITIES: LocalityItem[] = [
  { id: 'loc-1', name: 'Carlos Tejedor', district: 'Carlos Tejedor', is_active: true },
  { id: 'loc-2', name: 'Tres Algarrobos (Cuenca)', district: 'Carlos Tejedor', is_active: true },
  { id: 'loc-3', name: 'Colonia Seré', district: 'Carlos Tejedor', is_active: true },
  { id: 'loc-4', name: 'Timote', district: 'Carlos Tejedor', is_active: true },
  { id: 'loc-5', name: 'Curarú', district: 'Carlos Tejedor', is_active: true },
  { id: 'loc-6', name: 'América (Rivadavia)', district: 'Rivadavia', is_active: true },
  { id: 'loc-7', name: 'General Villegas', district: 'General Villegas', is_active: true },
  { id: 'loc-8', name: 'Pehuajó', district: 'Pehuajó', is_active: true },
  { id: 'loc-9', name: 'Lincoln', district: 'Lincoln', is_active: true },
  { id: 'loc-10', name: 'Trenque Lauquen', district: 'Trenque Lauquen', is_active: true },
];

export const INITIAL_INDUSTRIES: IndustryItem[] = [
  {
    id: 'ind-1',
    slug: 'comercio-ventas',
    name: 'Comercio y Ventas',
    suggested_positions: [
      'Vendedor/a de salón',
      'Cajero/a',
      'Repositor/a',
      'Atención al público',
      'Encargado/a de local',
      'Reparto / Cadetería',
    ],
    is_active: true,
  },
  {
    id: 'ind-2',
    slug: 'agro-campo',
    name: 'Agro y Campo',
    suggested_positions: [
      'Tractorista / Maquinista',
      'Peón general de campo',
      'Casero/a rural',
      'Tambero/a',
      'Recorredor / Ganadería',
      'Ingeniero/a Agrónomo / Veterinario/a',
      'Encargado/a de establecimiento',
    ],
    is_active: true,
  },
  {
    id: 'ind-3',
    slug: 'administracion-contable',
    name: 'Administración y Contable',
    suggested_positions: [
      'Administrativo/a general',
      'Secretario/a / Recepcionista',
      'Facturación y Cobranzas',
      'Auxiliar contable',
      'Atención telefónica / WhatsApp',
    ],
    is_active: true,
  },
  {
    id: 'ind-4',
    slug: 'gastronomia-alimentos',
    name: 'Gastronomía y Alimentos',
    suggested_positions: [
      'Cocinero/a',
      'Ayudante de cocina',
      'Mozo / Camarero/a',
      'Panadero/a / Pastelero/a',
      'Carnicero/a',
      'Delivery gastronómico',
    ],
    is_active: true,
  },
  {
    id: 'ind-5',
    slug: 'construccion-mantenimiento',
    name: 'Construcción, Mantenimiento y Oficios',
    suggested_positions: [
      'Albañil / Ayudante de albañil',
      'Electricista',
      'Plomero / Gasista',
      'Pintor',
      'Soldador / Herrero',
      'Carpintero',
      'Mantenimiento general / Parquero',
    ],
    is_active: true,
  },
  {
    id: 'ind-6',
    slug: 'transporte-logistica',
    name: 'Transporte y Logística',
    suggested_positions: [
      'Chofer de camión / Cerealero',
      'Chofer de reparto / Camioneta',
      'Operario/a de depósito / Carga y descarga',
      'Mecánico / Gomero',
    ],
    is_active: true,
  },
  {
    id: 'ind-7',
    slug: 'salud-cuidado',
    name: 'Salud y Cuidado de Personas',
    suggested_positions: [
      'Cuidado de adultos mayores',
      'Niñera / Cuidado infantil',
      'Acompañante terapéutico',
      'Enfermería / Auxiliar de farmacia',
    ],
    is_active: true,
  },
  {
    id: 'ind-8',
    slug: 'servicios-domesticos-limpieza',
    name: 'Limpieza y Servicios Generales',
    suggested_positions: [
      'Empleada doméstica / Tareas del hogar',
      'Limpieza de comercios / oficinas',
      'Lavandería y planchado',
      'Sereno / Vigilancia',
    ],
    is_active: true,
  },
];
