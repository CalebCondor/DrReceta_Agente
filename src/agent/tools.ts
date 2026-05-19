// src/agent/tools.ts
// Definiciones de las herramientas (tools) que Claude puede invocar

import Anthropic from '@anthropic-ai/sdk';

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_productos',
    description:
      'Obtiene el catálogo de paquetes disponibles. ' +
      'Enruta automáticamente al endpoint de residentes o turistas según el tipo de usuario. ' +
      'Úsalo cuando el usuario pregunte qué paquetes hay, qué venden, o quiera buscar algo. ' +
      'Puedes filtrar por pq_id para obtener un paquete específico.',
    input_schema: {
      type: 'object',
      properties: {
        user_type: {
          type: 'string',
          enum: ['residente', 'turista'],
          description:
            'Tipo de usuario: residente o turista. Obligatorio para enrutar al catálogo correcto.',
        },
        busqueda: {
          type: 'string',
          description:
            'Término de búsqueda opcional para filtrar paquetes por nombre o tags.',
        },
        pq_id: {
          type: 'integer',
          description: 'Filtrar por ID de paquete específico.',
        },
        limit: {
          type: 'integer',
          description: 'Cantidad máxima de resultados a devolver.',
        },
        offset: {
          type: 'integer',
          description: 'Desplazamiento para paginación.',
        },
      },
      required: ['user_type'],
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
      'Endpoint unificado de acceso. Con solo el email detecta si el usuario ya existe. ' +
      'Si existe: genera y envía un OTP de 6 dígitos válido 10 minutos (codigo_enviado: true). ' +
      'Si no existe y se pasan los campos de registro: crea la cuenta y también envía el código OTP. ' +
      'En ambos casos el código se verifica luego con `verificar_codigo`. ' +
      'FLUJO OBLIGATORIO: ' +
      '1) Llama PRIMERO solo con us_email. ' +
      '2a) Si devuelve { existe: true, codigo_enviado: true }: informa que se envió un código y pídele que lo escriba (expira en 10 min). ' +
      '2b) Si responde HTTP 422 (usuario no existe): pídele nombre, apellido, teléfono y contraseña (mín 8 caracteres) UNO POR UNO. ' +
      '3) Llama de nuevo con us_email + us_first_name + us_last_name + us_phone + us_pasww. La API registra al usuario y envía el OTP (codigo_enviado: true). ' +
      '4) En AMBOS casos (existe o nuevo), espera el código del usuario y llama a `verificar_codigo` para autenticarlo. ' +
      'NUNCA inventes ni rellenes us_first_name, us_last_name, us_phone ni us_pasww — siempre pídelos al usuario.',
    input_schema: {
      type: 'object',
      properties: {
        us_email: {
          type: 'string',
          description: 'Correo electrónico del usuario (obligatorio siempre).',
        },
        us_first_name: {
          type: 'string',
          description:
            'Nombre del usuario. Solo incluir cuando el usuario no existe y ya lo proporcionó.',
        },
        us_last_name: {
          type: 'string',
          description:
            'Apellido del usuario. Solo incluir cuando el usuario no existe y ya lo proporcionó.',
        },
        us_phone: {
          type: 'string',
          description:
            'Teléfono del usuario. Solo incluir cuando el usuario no existe y ya lo proporcionó.',
        },
        us_pasww: {
          type: 'string',
          description:
            'Contraseña elegida por el usuario (mínimo 8 caracteres). Solo incluir cuando el usuario no existe y ya la proporcionó.',
        },
        user_type: {
          type: 'string',
          enum: ['residente', 'turista'],
          description:
            'Tipo de usuario detectado al inicio de la conversación: residente (Puerto Rico) o turista. Obligatorio para enrutar al endpoint correcto.',
        },
      },
      required: ['us_email', 'user_type'],
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
        user_type: {
          type: 'string',
          enum: ['residente', 'turista'],
          description:
            'Tipo de usuario: residente o turista. Debe coincidir con el usado en verificar_o_registrar_usuario.',
        },
      },
      required: ['us_email', 'codigo', 'user_type'],
    },
  },
  {
    name: 'get_dispensarios',
    description:
      'Obtiene la lista de dispensarios PVC activos donde el usuario puede recoger su Tarjeta PVC sin cargo adicional. ' +
      'Úsalo cuando el usuario seleccione la opción de recoger en un dispensario cercano durante el flujo de Tarjeta PVC. ' +
      'No requiere parámetros. Devuelve dip_id, dip_nomb de cada dispensario activo.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'crear_compra',
    description:
      'Registra una intención de compra (iniciar_pago) en IslandMedPR. ' +
      'La API genera un token único (formato IS…M) devuelto en los campos `token` y `url_generado_pago`. ' +
      'ANTES de llamar esta herramienta SIEMPRE debes tener: pq_id, us_id, amount (monto total calculado con todos los cargos), ra_tipo_pac y tarjeta_pvc si aplica. ' +
      'El campo anombre_de es OBLIGATORIO: pregunta siempre "¿A nombre de quién va la orden?" antes de ejecutar la compra.',
    input_schema: {
      type: 'object',
      properties: {
        pq_id: {
          type: 'number',
          description: 'ID del paquete a adquirir.',
        },
        us_id: {
          type: 'number',
          description: 'ID del usuario que realiza la compra.',
        },
        amount: {
          type: 'number',
          description:
            'Monto total a cobrar (mín 0.01). Incluye el precio base del paquete más todos los cargos adicionales (tarjeta PVC, envío, acompañante).',
        },
        anombre_de: {
          type: 'string',
          description:
            'Nombre de la persona a cuyo nombre se registrará la compra. Siempre preguntarlo al usuario.',
        },
        ra_tipo_pac: {
          type: 'string',
          description:
            'Tipo de paciente: "adulto", "menor_con_acompaniante" o "mayor_con_acompaniante".',
        },
        tarjeta_pvc: {
          type: 'string',
          description:
            'Información de entrega de tarjeta PVC si el usuario la solicitó. Ej: "oficina", "dispensario:Dispensario A" o "domicilio:Dirección completa".',
        },
        pg_metodo: {
          type: 'number',
          description:
            'Método de pago: 2 = Tarjeta (default), 3 = Efectivo/ATH.',
        },
      },
      required: ['pq_id', 'us_id', 'amount', 'anombre_de'],
    },
  },
];
