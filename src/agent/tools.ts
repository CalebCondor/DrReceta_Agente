// src/agent/tools.ts
// Definiciones de las herramientas (tools) que Claude puede invocar

import Anthropic from '@anthropic-ai/sdk';

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_perfil',
    description:
      'Obtiene los datos del perfil del usuario autenticado en Tu Licencia. ' +
      'Usalo cuando el usuario pregunte por su perfil, datos personales, nombre, correo, etc.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'actualizar_perfil',
    description:
      'Actualiza campos del perfil del usuario en Tu Licencia. ' +
      'Usalo cuando el usuario quiera cambiar su nombre, email, telefono u otros datos. ' +
      'Solo incluye los campos que el usuario quiere cambiar. ' +
      'Los nombres de campo exactos que acepta la API son: ' +
      'us_nombres (nombre completo), us_email (correo), us_telefono (telefono), ' +
      'us_pais (pais), us_direccion (direccion), us_ciudad (ciudad), ' +
      'us_fech_nac (fecha nacimiento YYYY-MM-DD), us_code_postal (codigo postal). ' +
      'Usa SIEMPRE estos nombres exactos en el objeto campos.',
    input_schema: {
      type: 'object',
      properties: {
        campos: {
          type: 'object',
          description:
            'Objeto JSON con los campos a actualizar. Ej: {"us_nombres": "Juan"}',
        },
      },
      required: ['campos'],
    },
  },
  {
    name: 'get_ordenes',
    description:
      'Obtiene las ordenes/pedidos del usuario autenticado en Tu Licencia. ' +
      'Usalo cuando pregunte por compras, pedidos, productos comprados o enlaces de descarga.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_pagos',
    description:
      'Obtiene el historial de pagos y transacciones del usuario autenticado. ' +
      'Usalo cuando pregunte por pagos, facturas o transacciones.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_productos',
    description:
      'Obtiene el catalogo de todos los productos disponibles en Tu Licencia. ' +
      'Usalo cuando pregunte que productos hay, que venden, que esta disponible o quiera buscar algo. ' +
      'IMPORTANTE: cada producto devuelto incluye el campo `pq_id` (identificador numérico del paquete). ' +
      'Usa SIEMPRE ese `pq_id` tal cual viene en la respuesta cuando luego invoques `crear_compra`. ' +
      'NUNCA inventes un `pq_id` ni le pidas el ID al usuario: ya viene en los datos de esta herramienta.',
    input_schema: {
      type: 'object',
      properties: {
        busqueda: {
          type: 'string',
          description:
            'Termino de busqueda opcional para filtrar productos por nombre.',
        },
      },
      required: [],
    },
  },
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
      'Busca información específica en mi base de datos de aprendizaje previo. ' +
      'Úsalo antes de responder si no estás seguro de un dato interno o si el usuario pregunta algo que podrías haber aprendido antes.',
    input_schema: {
      type: 'object',
      properties: {
        busqueda: {
          type: 'string',
          description: 'Palabra clave o frase a buscar.',
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
      'Si EXISTE: la API responde con { success: true, data: { codigo: "XXXXXX", us_id, us_nombres, token: null } } — significa que se envió un código de 6 dígitos al correo del usuario (válido 10 min). Tras esto, tu siguiente llamada DEBE ser `verificar_codigo`, NO esta herramienta de nuevo. ' +
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
    name: 'verificar_codigo',
    description:
      'Verifica el código de 6 dígitos enviado al correo del usuario para autenticarlo. ' +
      'Úsalo DESPUÉS de que el usuario te proporcione el código que recibió en su correo, ' +
      'como parte del flujo de compra cuando el usuario ya existe en el sistema. ' +
      'Si el código es correcto, la API devuelve us_id, us_nombres y token para iniciar sesión. ' +
      'NUNCA inventes ni asumas el código — siempre espera a que el usuario lo escriba.',
    input_schema: {
      type: 'object',
      properties: {
        us_email: {
          type: 'string',
          description:
            'Correo electrónico del usuario (el mismo usado en verificar_o_registrar_usuario).',
        },
        codigo: {
          type: 'string',
          description:
            'Código de 6 dígitos que el usuario recibió en su correo.',
        },
      },
      required: ['us_email', 'codigo'],
    },
  },
  {
    name: 'crear_compra',
    description:
      'Crea una sesión de pago contra el endpoint interno `api/Pago/inicioPagoIa` ' +
      'de Tu Licencia. Devuelve `payment_url`, que es el enlace de pago que debes ' +
      'enviar al usuario (sirve para ATH Móvil y tarjeta en tulicenciapr.com/enlace/pago). ' +
      'SOLO llama esta herramienta cuando el usuario haya confirmado EXPLÍCITAMENTE ' +
      'qué paquete quiere (ej: standard, premium, vip) y que quiere adquirir el servicio ahora. ' +
      'Parámetros requeridos: cl_id (id del cliente/usuario), tr_id (id del trámite, ' +
      'viene de get_todos_los_tramites/get_productos), pg_precio (monto del paquete confirmado) ' +
      'y pg_package (nombre del paquete seleccionado, ej: "standard"). ' +
      'Una vez que tengas la respuesta, muestra al usuario el `payment_url` como ' +
      'enlace clickeable para que complete el pago.',
    input_schema: {
      type: 'object',
      properties: {
        cl_id: {
          type: 'number',
          description: 'ID del cliente/usuario que realiza el pago.',
        },
        tr_id: {
          type: 'number',
          description: 'ID del trámite/servicio a pagar.',
        },
        pg_precio: {
          type: 'number',
          description:
            'Monto del pago en decimal (precio del paquete confirmado).',
        },
        pg_package: {
          type: 'string',
          description:
            'Nombre del paquete seleccionado por el usuario (ej: "standard", "premium", "vip", "express").',
        },
      },
      required: ['cl_id', 'tr_id', 'pg_precio', 'pg_package'],
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

  {
    name: 'get_todos_los_tramites',
    description:
      'Obtiene la lista COMPLETA de todos los tramites disponibles (express y no express) con su pricing y detalles. ' +
      'Usalo cuando el usuario pregunte por la lista completa de tramites, todos los servicios, ' +
      'el catalogo general, o quiera ver todo lo que Tu Licencia ofrece.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_sellos_por_tramite',
    description:
      'Obtiene la lista de sellos asociados a un tramite especifico. ' +
      'Usalo cuando el usuario quiera saber que sellos incluye un tramite, ' +
      'los requisitos, documentos necesarios, tipos de sellos disponibles ' +
      'o cualquier detalle especifico de los sellos de un servicio. ' +
      'Necesitas el `tr_id` (id del tramite). Si no lo tienes, primero llama a ' +
      '`get_todos_los_tramites` o `get_productos` para obtenerlo.',
    input_schema: {
      type: 'object',
      properties: {
        tr_id: {
          type: 'number',
          description:
            'ID numerico del tramite del cual se quieren obtener los sellos.',
        },
      },
      required: ['tr_id'],
    },
  },
];
