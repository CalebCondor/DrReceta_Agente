// src/agent/tools.ts
// Definiciones de las herramientas (tools) que Claude puede invocar

import Anthropic from '@anthropic-ai/sdk';

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'recordar_conocimiento',
    description:
      'Guarda un par de pregunta y respuesta en la base de datos de conocimiento de la IA para usarlo en el futuro. ' +
      'Úsalo cuando el usuario te enseñe algo nuevo o te de una respuesta corregida.',
    input_schema: {
      type: 'object',
      properties: {
        pregunta: {
          type: 'string',
          description: 'La pregunta o concepto a aprender.',
        },
        respuesta: {
          type: 'string',
          description: 'La respuesta o información correcta.',
        },
      },
      required: ['pregunta', 'respuesta'],
    },
  },
  {
    name: 'buscar_conocimiento',
    description:
      'Busca la respuesta OFICIAL y APROBADA de la clínica en la base de conocimiento. ' +
      'OBLIGATORIO antes de responder cualquier consulta de salud o síntomas (qué es una enfermedad, qué significa un síntoma, un tratamiento, etc.). ' +
      'Usa como "busqueda" una palabra clave o frase corta del tema (ej: "puntos negros", "miodesopsias", "desprendimiento de retina", "catarata", "glaucoma", "OCT", "planes médicos", "diabetes"). ' +
      'Usa palabras simples y del tema; el buscador ignora acentos y tolera singular/plural. ' +
      'Si devuelve resultados, responde al paciente con esa información. Si NO devuelve resultados, deriva al personal humano en vez de inventar.',
    input_schema: {
      type: 'object',
      properties: {
        busqueda: {
          type: 'string',
          description:
            'Palabra clave o frase corta a buscar (ej: "puntos negros flotantes", "catarata").',
        },
      },
      required: ['busqueda'],
    },
  },
  {
    name: 'guardar_memoria_usuario',
    description:
      'Guarda un dato importante sobre el usuario en su memoria a largo plazo. ' +
      'Úsalo para recordar preferencias, nombres de familiares, condiciones médicas mencionadas, ' +
      'o cualquier detalle personal que mejore la atención a futuro.',
    input_schema: {
      type: 'object',
      properties: {
        clave: {
          type: 'string',
          description:
            "Nombre corto del dato (ej: 'alergias', 'nombre_hijo', 'preferencia_contacto').",
        },
        valor: { type: 'string', description: 'El detalle a recordar.' },
      },
      required: ['clave', 'valor'],
    },
  },
  {
    name: 'consultar_memoria_usuario',
    description:
      'Consulta la memoria a largo plazo del usuario actual para obtener detalles personalizados. ' +
      'Úsalo al inicio de una conversación o cuando necesites recordar algo que el usuario te contó en el pasado.',
    input_schema: {
      type: 'object',
      properties: {
        clave: {
          type: 'string',
          description:
            'Opcional: Filtrar por una clave específica. Si se omite, trae toda la memoria.',
        },
      },
      required: [],
    },
  },
  {
    name: 'verificar_o_registrar_usuario',
    description:
      'PASO 1 del flujo de verificación. Verifica si un usuario existe por correo. ' +
      'Si EXISTE: la API responde con { success: true, data: { codigo: "XXXXXX", us_id, us_nombres, token: null } } — significa que se envió un código de 6 dígitos al correo del usuario (válido 10 min). Tras esto, tu siguiente llamada DEBE ser `verificar_codigo`, NO esta herramienta de nuevo. La respuesta además expone el campo `us_nombres` en el JSON enriquecido: SIEMPRE debes usarlo tal cual para dirigirte al usuario (ej. "¡Listo, Andrés!..."). NUNCA inventes ni sustituyas el nombre de la BD. ' +
      'Si NO EXISTE: la API responde con un error (ej. 422) pidiendo us_nombres, us_telefono, us_genero y us_clave. Recopila esos datos del usuario UNO POR UNO y vuelve a llamar a esta herramienta con todos los campos. ' +
      'ÚSALO solo cuando el usuario quiera autenticarse para comprar. ' +
      'NUNCA inventes ni rellenes us_nombres, us_telefono, us_genero ni us_clave — siempre pídelos al usuario. ' +
      'Para us_genero, pregunta al usuario con opciones naturales ("¿Eres hombre o mujer?") y envía el valor tal como el usuario lo diga ("masculino", "femenino", "hombre", "mujer", "M", "F"); el executor se encarga de normalizarlo.',
    input_schema: {
      type: 'object',
      properties: {
        us_email: {
          type: 'string',
          description: 'Correo electrónico del usuario (obligatorio siempre).',
        },
        us_nombres: {
          type: 'string',
          description:
            'Nombre completo del usuario. Solo incluir si el usuario ya lo proporcionó.',
        },
        us_telefono: {
          type: 'string',
          description:
            'Teléfono del usuario. Solo incluir si el usuario ya lo proporcionó.',
        },
        us_genero: {
          type: 'string',
          description:
            'Género del usuario. Solo incluir si el usuario ya lo proporcionó. Acepta: "masculino"/"hombre"/"M" o "femenino"/"mujer"/"F" (también "otro" si el usuario lo indica).',
        },
        us_clave: {
          type: 'string',
          description:
            'Contraseña elegida por el usuario. Solo incluir si el usuario ya la proporcionó. Se encripta con AES-256-CBC.',
        },
      },
      required: ['us_email'],
    },
  },

  {
    name: 'registrar_derivacion',
    description:
      'Registra en la base de datos que el usuario fue derivado a un asesor humano. ' +
      'DEBES llamar a esta herramienta SIEMPRE, de forma automática y sin mencionárselo al usuario, ' +
      'justo antes de enviar el enlace de WhatsApp al asesor humano. ' +
      'Captura el motivo de la derivación y el mensaje exacto que envió el usuario para poder entrenar a la IA en el futuro.',
    input_schema: {
      type: 'object',
      properties: {
        motivo: {
          type: 'string',
          description:
            'Categoría o razón de la derivación. Ej: "solicitud_asesor", "queja_grave", "situacion_legal", "caso_medico_complejo", "otro".',
        },
        mensaje_usuario: {
          type: 'string',
          description:
            'Texto exacto o resumen del mensaje del usuario que provocó la derivación.',
        },
        respuesta_ia: {
          type: 'string',
          description:
            'Resumen de la respuesta que la IA proporcionó al derivar al usuario.',
        },
      },
      required: ['motivo', 'mensaje_usuario'],
    },
  },
];
