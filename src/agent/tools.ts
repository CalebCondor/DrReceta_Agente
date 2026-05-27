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
        us_ssn: {
          type: 'string',
          description:
            'Últimos 4 dígitos del SSN del usuario. Solo para TURISTAS y solo cuando el usuario no existe y ya los proporcionó.',
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
      'ANTES de llamar esta herramienta SIEMPRE debes tener: pq_id, us_id, amount (monto total calculado con todos los cargos), ra_tipo_pac y tarjeta_pvc si aplica.',
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
        ra_tipo_pac: {
          type: 'integer',
          enum: [0, 1, 2],
          description:
            'Tipo de paciente: 0=Paciente adulto (default), 1=Paciente menor de edad con acompañante, 2=Paciente mayor que necesita acompañante.',
        },
        tarjeta_pvc: {
          type: 'integer',
          enum: [0, 1],
          description:
            'Indica si el usuario seleccionó Tarjeta PVC: 0=No la quiere, 1=Sí la quiere. SIEMPRE enviar este campo.',
        },
        selecciono_pvc: {
          type: 'integer',
          enum: [0, 1, 2],
          description:
            'Opción de entrega de Tarjeta PVC: 0=Recoger en oficina (default), 1=Recoger en dispensario, 2=Envío a domicilio. Solo incluir si tarjeta_pvc=1.',
        },
        pg_plan_extra1: {
          type: 'number',
          description:
            'Monto extra adicional al paquete (ej. 19.99 por Tarjeta PVC). Default 0.',
        },
        pg_plan_extra2: {
          type: 'number',
          description:
            'Monto de la Cita de Seguimiento (29.99). Solo incluir si el usuario aceptó la Cita de Seguimiento.',
        },
        dip_id: {
          type: 'integer',
          description:
            'ID del dispensario seleccionado. Obligatorio cuando selecciono_pvc=1. Default 0.',
        },
        us_dir_postal: {
          type: 'string',
          description:
            'Dirección postal del paciente. Obligatorio cuando ra_tipo_pac=2 (mayor que necesita acompañante).',
        },
        pg_metodo: {
          type: 'number',
          description:
            'Método de pago: 2 = Tarjeta (default), 3 = Efectivo/ATH.',
        },
        fecha_llegada: {
          type: 'string',
          description:
            'Fecha de llegada del turista a Puerto Rico. Formato YYYY-MM-DD. Obligatorio para turistas.',
        },
        cp_code: {
          type: 'string',
          description:
            'Código de cupón de descuento. Solo incluir si el usuario lo proporciona.',
        },
        cod_vend: {
          type: 'string',
          description: 'Código de vendedor. Solo incluir si aplica.',
        },
      },
      required: ['pq_id', 'us_id', 'amount'],
    },
  },
  {
    name: 'editar_pago',
    description:
      'Edita una compra existente en IslandMedPR. ' +
      'Úsalo cuando el usuario quiera modificar algo de su pedido ya creado (paquete, monto, método de pago, tarjeta PVC, fecha de llegada, etc.). ' +
      'Solo se actualizan los campos enviados; se debe enviar al menos uno. ' +
      'Requiere us_id y url_generado_pago. ' +
      'Enruta automáticamente al endpoint de residentes o turistas según el tipo de usuario. ' +
      'Residentes: soporta tarjeta_pvc, selecciono_pvc, ra_tipo_pac, dip_id, us_dir_postal, pg_plan_extra1, cp_code. ' +
      'Turistas: soporta fecha_llegada.',
    input_schema: {
      type: 'object',
      properties: {
        us_id: {
          type: 'integer',
          description: 'ID del usuario (debe coincidir con el token de auth).',
        },
        url_generado_pago: {
          type: 'string',
          description:
            'Identificador del pago devuelto por `crear_compra` (campo `url_generado_pago` o `token`).',
        },
        pq_id: {
          type: 'integer',
          description: 'Nuevo paquete. Recalcula pg_plan_name y pg_plan_monto.',
        },
        amount: {
          type: 'number',
          description: 'Nuevo monto total (mín 0.01).',
        },
        pg_metodo: {
          type: 'integer',
          description: 'Método de pago: 2=Tarjeta, 3=Efectivo/ATH.',
        },
        cod_vend: {
          type: 'string',
          description: 'Código de vendedor.',
        },
        pg_plan_extra1: {
          type: 'number',
          description:
            'Monto extra (ej. 19.99 por Tarjeta PVC). Solo residentes.',
        },
        pg_plan_extra2: {
          type: 'number',
          description:
            'Monto de la Cita de Seguimiento (29.99). Solo incluir si el usuario aceptó la Cita de Seguimiento. Solo residentes.',
        },
        tarjeta_pvc: {
          type: 'integer',
          enum: [0, 1],
          description:
            '0=No quiere PVC, 1=Sí quiere PVC. Reconstruye pg_plan_name. Solo residentes.',
        },
        selecciono_pvc: {
          type: 'integer',
          enum: [0, 1, 2],
          description:
            'Entrega PVC: 0=Oficina, 1=Dispensario, 2=Domicilio, ""=sin selección. Recalcula pvc_tipo_name. Solo residentes. Puede ser entero (0,1,2) o string vacío ("").',
        },
        ra_tipo_pac: {
          type: 'integer',
          enum: [0, 1, 2],
          description:
            'Tipo de paciente: 0=adulto, 1=menor con acompañante, 2=mayor con acompañante. Reconstruye pg_plan_name. Solo residentes.',
        },
        dip_id: {
          type: 'integer',
          description:
            'ID del dispensario (≥ 0). Obligatorio cuando selecciono_pvc=1. Solo residentes.',
        },
        us_dir_postal: {
          type: 'string',
          description:
            'Dirección postal. Reconstruye pg_plan_name si ra_tipo_pac=2. Solo residentes.',
        },
        cp_code: {
          type: 'string',
          description: 'Código de cupón de descuento. Solo residentes.',
        },
        fecha_llegada: {
          type: 'string',
          description:
            'Nueva fecha de llegada a Puerto Rico (YYYY-MM-DD). Solo turistas.',
        },
      },
      required: ['us_id', 'url_generado_pago'],
    },
  },
  {
    name: 'get_detalle_pago',
    description:
      'Obtiene el detalle completo de un pago usando el token devuelto por `crear_compra`. ' +
      'Úsalo INMEDIATAMENTE después de llamar a `crear_compra` para mostrar al usuario el resumen completo (paquete, monto, estado, usuario) antes de enviarle el enlace de pago. ' +
      'Enruta automáticamente al endpoint de residentes o turistas según el tipo de usuario.',
    input_schema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description:
            'Token único (formato IS…M) devuelto por `crear_compra` en el campo `token` o `url_generado_pago`.',
        },
        user_type: {
          type: 'string',
          enum: ['residente', 'turista'],
          description: 'Tipo de usuario para enrutar al endpoint correcto.',
        },
      },
      required: ['token', 'user_type'],
    },
  },
  {
    name: 'get_my_orders',
    description:
      'Lista todas las órdenes del usuario residente. ' +
      'Úsalo cuando el usuario NO sepa su pg_code o quiera ver sus órdenes disponibles. ' +
      'Devuelve solo un resumen (código, fecha, paquete, monto, tipo de PVC) para que el usuario seleccione cuál consultar. ' +
      'Requiere us_id del usuario autenticado.',
    input_schema: {
      type: 'object',
      properties: {
        us_id: {
          type: 'integer',
          description: 'ID del usuario residente autenticado.',
        },
      },
      required: ['us_id'],
    },
  },
  {
    name: 'get_estatus_orden',
    description:
      'Obtiene el estado detallado y la información del procesamiento de una orden específica. ' +
      'Úsalo cuando el usuario quiera saber en qué estado está su orden o pago. ' +
      'Requiere el ID del usuario (us_id) y el código de pago/orden (pg_code).',
    input_schema: {
      type: 'object',
      properties: {
        us_id: {
          type: 'integer',
          description: 'ID del usuario.',
        },
        pg_code: {
          type: 'string',
          description: 'Código de pago / orden a consultar.',
        },
      },
      required: ['us_id', 'pg_code'],
    },
  },
  {
    name: 'verificar_codigo_descuento',
    description:
      'Verifica si un código de descuento proporcionado por el usuario es válido en IslandMedPR (solo residentes). ' +
      'NUNCA ofrezcas ni menciones códigos de descuento — úsalo ÚNICAMENTE cuando el usuario escriba espontáneamente un código. ' +
      'Opcionalmente verifica si el código aplica a un paquete específico enviando pq_id. ' +
      'INTERPRETACIÓN DE RESPUESTA: ' +
      '- CÓDIGO VÁLIDO: La API devuelve un objeto con los campos dc_code, dc_tipo, dc_monto, descuento_aplicado y monto_final. ' +
      '  Si el objeto contiene dc_code y monto_final, el código ES VÁLIDO. Aplica el descuento así: ' +
      '  · Si dc_tipo="$": el descuento es fijo (dc_monto). Nuevo amount = monto_final. ' +
      '  · Si dc_tipo="%": el descuento es porcentual (dc_monto%). Nuevo amount = monto_final. ' +
      '  · SIEMPRE usa el campo monto_final como el nuevo amount para crear_compra. ' +
      '  · Pasa el código como cp_code en crear_compra. ' +
      '- CÓDIGO INVÁLIDO: La API devuelve array vacío [], objeto vacío {}, error o message de error. En ese caso informa que el código no es válido.',
    input_schema: {
      type: 'object',
      properties: {
        dc_code: {
          type: 'string',
          description: 'Código de descuento que el usuario proporcionó.',
        },
        pq_id: {
          type: 'integer',
          description:
            'ID del paquete que el usuario está comprando. Opcional: si se envía, la API valida que el código aplique a ese paquete.',
        },
      },
      required: ['dc_code'],
    },
  },
];
