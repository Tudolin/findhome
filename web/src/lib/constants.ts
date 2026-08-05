import type { InteractionStatus } from '@prisma/client';

export const STATUSES: InteractionStatus[] = [
  'DISCOVERED',
  'INTERESTED',
  'FAVORITE',
  'VISIT_SCHEDULED',
  'APPLIED',
  'REJECTED',
];

export const STATUS_LABEL: Record<InteractionStatus, string> = {
  DISCOVERED: 'Discovered',
  INTERESTED: 'Interested',
  FAVORITE: 'Favorite',
  VISIT_SCHEDULED: 'Visit scheduled',
  APPLIED: 'Applied',
  REJECTED: 'Archived',
};

/**
 * Status chips stay on the one shared surface and are pressed *into* it —
 * filling them with colour would break the neumorphic light model. The status
 * is carried by the text colour and the dot in STATUS_DOT.
 */
export const STATUS_STYLE: Record<InteractionStatus, string> = {
  DISCOVERED: 'bg-surface text-ink-600 shadow-neu-inset-sm',
  INTERESTED: 'bg-surface text-sky-800 shadow-neu-inset-sm',
  FAVORITE: 'bg-surface text-amber-800 shadow-neu-inset-sm',
  VISIT_SCHEDULED: 'bg-surface text-violet-800 shadow-neu-inset-sm',
  APPLIED: 'bg-surface text-brand-800 shadow-neu-inset-sm',
  REJECTED: 'bg-surface text-rose-800 shadow-neu-inset-sm',
};

/** Small colour swatch shown inside a status chip. */
export const STATUS_DOT: Record<InteractionStatus, string> = {
  DISCOVERED: 'bg-ink-400',
  INTERESTED: 'bg-sky-500',
  FAVORITE: 'bg-amber-500',
  VISIT_SCHEDULED: 'bg-violet-500',
  APPLIED: 'bg-brand-500',
  REJECTED: 'bg-rose-500',
};

/** Columns rendered on the Co-Op Kanban board, in order. */
export const BOARD_COLUMNS: InteractionStatus[] = [
  'INTERESTED',
  'FAVORITE',
  'VISIT_SCHEDULED',
  'APPLIED',
  'REJECTED',
];

export const AMENITY_OPTIONS = [
  'Elevador',
  'Portaria 24h',
  'Academia',
  'Piscina',
  'Churrasqueira',
  'Varanda',
  'Mobiliado',
  'Lavanderia',
  'Coworking',
  'Playground',
  'Ar-condicionado',
  'Terraço',
];

export const QUICK_PROS = [
  'Perto do metrô',
  'Varanda ampla',
  'Bem iluminado',
  'Reformado',
  'Rua tranquila',
  'Boa planta',
  'Aceita pet',
];

export const QUICK_CONS = [
  'Condomínio caro',
  'Sem elevador',
  'Rua barulhenta',
  'Precisa de reforma',
  'Longe do trabalho',
  'Sem vaga',
  'Andar baixo',
];
