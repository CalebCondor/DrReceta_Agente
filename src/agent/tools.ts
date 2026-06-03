// src/agent/tools.ts
// Definiciones de las herramientas (tools) que Claude puede invocar

import Anthropic from '@anthropic-ai/sdk';

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_status_by_code',
    description:
      'Consulta el estado completo de una orden/pago usando su código (pg_code). ' +
      'Úsalo cuando alguien pregunte por el estatus de una orden.',
    input_schema: {
      type: 'object',
      properties: {
        pg_code: {
          type: 'string',
          description: 'Código de la orden/pago (ej: IS932A238M).',
        },
      },
      required: ['pg_code'],
    },
  },
  {
    name: 'get_user_by_email',
    description:
      'Consulta los datos de un usuario por su correo electrónico. ' +
      'Devuelve información del perfil. Úsalo para buscar un usuario antes de editarlo.',
    input_schema: {
      type: 'object',
      properties: {
        us_email: {
          type: 'string',
          description: 'Correo electrónico del usuario.',
        },
      },
      required: ['us_email'],
    },
  },
  {
    name: 'edit_contact',
    description:
      'Edita el email y/o teléfono de un usuario. Requiere us_id. ' +
      'Campos editables: us_email, us_phone. Solo envía los que se desean cambiar.',
    input_schema: {
      type: 'object',
      properties: {
        us_id: {
          type: 'string',
          description: 'ID del usuario a editar.',
        },
        us_email: {
          type: 'string',
          description: 'Nuevo correo electrónico (opcional).',
        },
        us_phone: {
          type: 'string',
          description: 'Nuevo número de teléfono (opcional).',
        },
      },
      required: ['us_id'],
    },
  },
];
