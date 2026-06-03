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
  {
    name: 'get_foto_link',
    description:
      'Obtiene el enlace para que el usuario suba sus fotos y documentos requeridos para el proceso de certificación. ' +
      'Úsalo cuando el usuario pregunte: "¿dónde subo mis fotos?", "¿cómo subo mis documentos?", "subir foto", "subir documentos", "mis fotos", "mis documentos", o cualquier variación similar. ' +
      'Requiere pg_code (código de la orden/pago). Si el usuario no lo sabe, consulta primero con `get_my_orders` para obtenerlo. ' +
      'La API devuelve un foto_link con la URL donde el usuario puede subir sus documentos.',
    input_schema: {
      type: 'object',
      properties: {
        pg_code: {
          type: 'string',
          description:
            'Código de la orden/pago (ej: ISA3310396). Devuelto por `crear_compra` o `get_my_orders`.',
        },
        user_type: {
          type: 'string',
          enum: ['residente', 'turista'],
          description: 'Tipo de usuario para enrutar al endpoint correcto.',
        },
      },
      required: ['pg_code', 'user_type'],
    },
  },
];
