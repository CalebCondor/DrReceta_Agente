// src/agent/tools.ts
// Definiciones de las herramientas (tools) que Claude puede invocar

import Anthropic from '@anthropic-ai/sdk';

/*──────────────────────────────────────────────────────────────────────────
  ESTADO DE LAS TOOLS

  ✓ ACTIVAS (tools que el modelo puede invocar y el executor maneja):
    • get_productos                   — sin endpoint, queda pendiente de cablear
    • tools de DB local:
        - recordar_conocimiento
        - buscar_conocimiento
        - guardar_memoria_usuario
        - consultar_memoria_usuario
        - registrar_derivacion
    • tools de IaPreguntas (stubs HTTP en executor, devuelven
      "pendiente de implementación" hasta cablear el backend):
        - consultar_resumen_financiero_hospitales
        - consultar_determinacion_adversa_mas_frecuente
        - consultar_concepto_mas_dias_denegados

  ✗ DESHABILITADAS (comentadas porque sus URLs externas fueron
  comentadas en `src/api/urls.ts` y sus casos en `executor.ts`):
    • get_perfil, actualizar_perfil, get_ordenes, get_pagos
    • verificar_o_registrar_usuario, verificar_codigo, crear_compra
    • get_todos_los_tramites, get_sellos_por_tramite, inicio_tramite_express
  ─────────────────────────────────────────────────────────────────────────*/

export const TOOLS: Anthropic.Tool[] = [
  // {
  //   name: 'get_perfil',
  //   description:
  //     'Obtiene los datos del perfil del usuario autenticado. ' +
  //     'Usalo cuando el usuario pregunte por su perfil, datos personales, nombre, correo, etc.',
  //   input_schema: { type: 'object', properties: {}, required: [] },
  // },
  // {
  //   name: 'actualizar_perfil',
  //   description:
  //     'Actualiza campos del perfil del usuario. ' +
  //     'Usalo cuando el usuario quiera cambiar su nombre, email, telefono u otros datos. ' +
  //     'Solo incluye los campos que el usuario quiere cambiar. ' +
  //     'Los nombres de campo exactos que acepta la API son: ' +
  //     'us_nombres (nombre completo), us_email (correo), us_telefono (telefono), ' +
  //     'us_pais (pais), us_direccion (direccion), us_ciudad (ciudad), ' +
  //     'us_fech_nac (fecha nacimiento YYYY-MM-DD), us_code_postal (codigo postal). ' +
  //     'Usa SIEMPRE estos nombres exactos en el objeto campos.',
  //   input_schema: {
  //     type: 'object',
  //     properties: {
  //       campos: {
  //         type: 'object',
  //         description:
  //           'Objeto JSON con los campos a actualizar. Ej: {"us_nombres": "Juan"}',
  //       },
  //     },
  //     required: ['campos'],
  //   },
  // },
  // {
  //   name: 'get_ordenes',
  //   description:
  //     'Obtiene las ordenes/pedidos del usuario autenticado. ' +
  //     'Usalo cuando pregunte por compras, pedidos, productos comprados o enlaces de descarga.',
  //   input_schema: { type: 'object', properties: {}, required: [] },
  // },
  // {
  //   name: 'get_pagos',
  //   description:
  //     'Obtiene el historial de pagos y transacciones del usuario autenticado. ' +
  //     'Usalo cuando pregunte por pagos, facturas o transacciones.',
  //   input_schema: { type: 'object', properties: {}, required: [] },
  // },
  {
    name: 'get_productos',
    description:
      'Obtiene el catalogo de todos los productos disponibles. ' +
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
  // {
  //   name: 'verificar_o_registrar_usuario',
  //   description:
  //     'PASO 1 del flujo de verificación. Verifica si un usuario existe por correo. ' +
  //     'Si EXISTE: la API responde con { success: true, data: { codigo: "XXXXXX", us_id, us_nombres, token: null } } — significa que se envió un código de 6 dígitos al correo del usuario (válido 10 min). Tras esto, tu siguiente llamada DEBE ser `verificar_codigo`, NO esta herramienta de nuevo. La respuesta además expone el campo `us_nombres` en el JSON enriquecido: SIEMPRE debes usarlo tal cual para dirigirte al usuario (ej. "¡Listo, Andrés!..."). NUNCA inventes ni sustituyas el nombre de la BD. ' +
  //     'Si NO EXISTE: la API responde con un error (ej. 422) pidiendo us_nombres, us_telefono, us_genero y us_clave. Recopila esos datos del usuario UNO POR UNO y vuelve a llamar a esta herramienta con todos los campos. ' +
  //     'ÚSALO solo cuando el usuario quiera autenticarse para comprar. ' +
  //     'NUNCA inventes ni rellenes us_nombres, us_telefono, us_genero ni us_clave — siempre pídelos al usuario. ' +
  //     'Para us_genero, pregunta al usuario con opciones naturales ("¿Eres hombre o mujer?") y envía el valor tal como el usuario lo diga ("masculino", "femenino", "hombre", "mujer", "M", "F"); el executor se encarga de normalizarlo.',
  //   input_schema: {
  //     type: 'object',
  //     properties: {
  //       us_email: {
  //         type: 'string',
  //         description: 'Correo electrónico del usuario (obligatorio siempre).',
  //       },
  //       us_nombres: {
  //         type: 'string',
  //         description:
  //           'Nombre completo del usuario. Solo incluir si el usuario ya lo proporcionó.',
  //       },
  //       us_telefono: {
  //         type: 'string',
  //         description:
  //           'Teléfono del usuario. Solo incluir si el usuario ya lo proporcionó.',
  //       },
  //       us_genero: {
  //         type: 'string',
  //         description:
  //           'Género del usuario. Solo incluir si el usuario ya lo proporcionó. Acepta: "masculino"/"hombre"/"M" o "femenino"/"mujer"/"F" (también "otro" si el usuario lo indica).',
  //       },
  //       us_clave: {
  //         type: 'string',
  //         description:
  //           'Contraseña elegida por el usuario. Solo incluir si el usuario ya la proporcionó. Se encripta con AES-256-CBC.',
  //       },
  //     },
  //     required: ['us_email'],
  //   },
  // },
  // {
  //   name: 'verificar_codigo',
  //   description:
  //     'Verifica el código de 6 dígitos enviado al correo del usuario para autenticarlo. ' +
  //     'Úsalo DESPUÉS de que el usuario te proporcione el código que recibió en su correo, ' +
  //     'como parte del flujo de compra cuando el usuario ya existe en el sistema. ' +
  //     'Si el código es correcto, la API devuelve us_id, us_nombres y token para iniciar sesión. ' +
  //     'NUNCA inventes ni asumas el código — siempre espera a que el usuario lo escriba.',
  //   input_schema: {
  //     type: 'object',
  //     properties: {
  //       us_email: {
  //         type: 'string',
  //         description:
  //           'Correo electrónico del usuario (el mismo usado en verificar_o_registrar_usuario).',
  //       },
  //       codigo: {
  //         type: 'string',
  //         description:
  //           'Código de 6 dígitos que el usuario recibió en su correo.',
  //       },
  //     },
  //     required: ['us_email', 'codigo'],
  //   },
  // },
  // {
  //   name: 'crear_compra',
  //   description:
  //     'Crea una sesión de pago contra el endpoint interno `api/Pago/inicioPagoIa` ' +
  //     'del backend de Audita. Devuelve `payment_url`, que es el enlace de pago ' +
  //     'que debes enviar al usuario (sirve para ATH Móvil y tarjeta). ' +
  //     'SOLO llama esta herramienta cuando el usuario haya confirmado EXPLÍCITAMENTE ' +
  //     'qué paquete quiere (ej: standard, premium, vip) y que quiere adquirir el servicio ahora. ' +
  //     'Parámetros requeridos: cl_id (id del cliente/usuario), tr_id (id del trámite, ' +
  //     'viene de get_todos_los_tramites/get_productos), pg_precio (monto del paquete confirmado) ' +
  //     'y pg_package (nombre del paquete seleccionado, ej: "standard"). ' +
  //     'Una vez que tengas la respuesta, muestra al usuario el `payment_url` como ' +
  //     'enlace clickeable para que complete el pago.',
  //   input_schema: {
  //     type: 'object',
  //     properties: {
  //       cl_id: {
  //         type: 'number',
  //         description: 'ID del cliente/usuario que realiza el pago.',
  //       },
  //       tr_id: {
  //         type: 'number',
  //         description: 'ID del trámite/servicio a pagar.',
  //       },
  //       pg_precio: {
  //         type: 'number',
  //         description:
  //           'Monto del pago en decimal (precio del paquete confirmado).',
  //       },
  //       pg_package: {
  //         type: 'string',
  //         description:
  //           'Nombre del paquete seleccionado por el usuario (ej: "standard", "premium", "vip", "express").',
  //       },
  //     },
  //     required: ['cl_id', 'tr_id', 'pg_precio', 'pg_package'],
  //   },
  // },
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

  // {
  //   name: 'get_todos_los_tramites',
  //   description:
  //     'Obtiene el catálogo completo de trámites disponibles. ' +
  //     'La respuesta viene en `data` con TRES listas separadas:\n' +
  //     '  • `tramites_express[]` — servicios puntuales de bajo costo (ej.: Coordinación de turno para Autoexpreso, cita para recoger Lic. de Aprendizaje, cita para examen Lic. de Aprendizaje, Evaluación Médica, Amnistía 40%, Recurso de revisión de multas, Certificación de multas, Gestión de plan de pago). Cada item trae `id`, `codigo` (ej. "CT-0001", "LC-0002", "MPP-0001"), `nombre`, `descripcion`, `precio` (único, SIN variante VIP), `activo`, `visible`. Categoría en `categoriaId` ("CT" = Citas y Turnos, "LC" = Licencias y Certificaciones, "MPP" = Multas y Planes de Pago).\n' +
  //     '  • `tramites[]` — trámites principales de licencia con VARIANTE ESTÁNDAR y VIP. Cada item trae `id`, `nombre` (ej.: "Renovación de Licencia"), `precio` (Estándar), `precioVip` (VIP, puede ser 0 si no aplica), `meta.precioSellos`, `requisitos`, `formularios`.\n' +
  //     '  • `tramites_vehiculares[]` — igual estructura que `tramites[]` pero para vehículos (Traspaso, Duplicado de título, etc.).\n\n' +
  //     'USO:\n' +
  //     '  • Si el usuario dice "quiero un turno", "sacar un turno", "agendar cita", "coordinar cita", o cualquier variante → filtra `tramites_express` por `categoriaId === "CT"` y por palabras clave ("turno", "cita", "coordinación") en `nombre`. Muestra los resultados con su `precio` (sin VIP).\n' +
  //     '  • Si el usuario pide una licencia, renovación, duplicado, REAL ID, etc. → usa `tramites[]` y muestra `precio` (Estándar) + `precioVip` (VIP).\n' +
  //     '  • Si el usuario pide traspaso, duplicado de título, marbete, etc. → usa `tramites_vehiculares[]`.\n' +
  //     '  • Si pide multas, plan de pago, amnistía, recurso de revisión → `tramites_express` con `categoriaId === "MPP"`.\n' +
  //     '  • SOLO muestra items con `visible: true` (ignora `visible: false`).\n' +
  //     '  • Máximo 4 opciones por respuesta.',
  //   input_schema: { type: 'object', properties: {}, required: [] },
  // },
  // {
  //   name: 'get_sellos_por_tramite',
  //   description:
  //     'Obtiene la lista de sellos asociados a un tramite especifico. ' +
  //     'Usalo cuando el usuario quiera saber que sellos incluye un tramite, ' +
  //     'los requisitos, documentos necesarios, tipos de sellos disponibles ' +
  //     'o cualquier detalle especifico de los sellos de un servicio. ' +
  //     'Necesitas el `tr_id` (id del tramite). Si no lo tienes, primero llama a ' +
  //     '`get_todos_los_tramites` o `get_productos` para obtenerlo.',
  //   input_schema: {
  //     type: 'object',
  //     properties: {
  //       tr_id: {
  //         type: 'number',
  //         description:
  //           'ID numerico del tramite del cual se quieren obtener los sellos.',
  //       },
  //     },
  //     required: ['tr_id'],
  //   },
  // },
  // {
  //   name: 'inicio_tramite_express',
  //   description:
  //     'Inicia un trámite express y devuelve datos para generar el enlace de pago (token_ia, payment_url). ' +
  //     'Usalo cuando el usuario confirme que quiere adquirir un trámite express. ' +
  //     'Devuelve `payment_url` en el campo `data.payment_url` para enviar al usuario.',
  //   input_schema: {
  //     type: 'object',
  //     properties: {
  //       cl_id: {
  //         type: 'number',
  //         description: 'ID del cliente/usuario que solicita el trámite.',
  //       },
  //       producto_id: {
  //         type: 'number',
  //         description: 'ID del producto/trámite express a iniciar.',
  //       },
  //       observacion: {
  //         type: 'string',
  //         description: 'Observación opcional para enviar al backend.',
  //       },
  //       meta: {
  //         type: 'string',
  //         description: 'Campo meta opcional.',
  //       },
  //     },
  //     required: ['cl_id', 'producto_id'],
  //   },
  // },

  /*──────────────────────────────────────────────────────────────────────────
    AUXILIARES — Planes

    PRERREQUISITO OBLIGATORIO de las tools de IaPreguntas. Antes de cualquier
    consulta de resumen-financiero, determinacion-adversa o concepto-mas-dias,
    el modelo DEBE llamar a `obtener_planes_disponibles` para conocer el
    catálogo actualizado de planes (id + nombre) y poder mapear los nombres
    que el usuario mencione a sus IDs. NUNCA inventar `idPlanes`.
    ─────────────────────────────────────────────────────────────────────────*/

  {
    name: 'obtener_planes_disponibles',
    description:
      'Devuelve el catálogo público de planes médicos disponibles (id + nombre).\n\n' +
      'NO REQUIERE AUTENTICACIÓN: este endpoint es público y puede invocarse aunque ' +
      'el usuario NO haya iniciado sesión. NO pidas correo ni código antes de llamarla.\n\n' +
      'REGLA OBLIGATORIA — PRERREQUISITO DE LAS TOOLS DE IaPreguntas:\n' +
      '  • DEBES llamar a esta herramienta ANTES de invocar cualquier tool de ' +
      'IaPreguntas (`consultar_resumen_financiero_hospitales`, ' +
      '`consultar_determinacion_adversa_mas_frecuente`, ' +
      '`consultar_concepto_mas_dias_denegados`). Sin el catálogo en contexto, ' +
      'NO puedes construir el parámetro `idPlanes` de forma fiable.\n' +
      '  • Si el usuario menciona un plan por nombre ("Plan A", "Plan B", ' +
      '"plan premium", etc.), primero llama a esta tool para mapear el nombre ' +
      'al `idPlan` correspondiente, y luego pasa ese `idPlan` en el array ' +
      '`idPlanes[]` de la tool de IaPreguntas.\n' +
      '  • NUNCA inventes `idPlanes` ni uses IDs memorizados de conversaciones ' +
      'anteriores — el catálogo puede cambiar entre sesiones.\n\n' +
      'CUANDO EL USUARIO PREGUNTA SOBRE PLANES:\n' +
      '  • Si el usuario pregunta "¿qué planes hay?", "¿cuáles son los planes ' +
      'disponibles?", o variantes → muéstrale la lista devuelta con el formato ' +
      '"id: 1127 — Plan A" (un plan por línea).\n' +
      '  • Si pregunta por un plan específico por nombre → búscalo en esta lista ' +
      'y devuelve el id + nombre exactos que vienen del backend.\n\n' +
      'RESPUESTA:\n' +
      '  Cada plan: `{ idPlan: number, plan: string }`. ' +
      'Ej: `[{idPlan: 1127, plan: "Plan A"}, {idPlan: 1123, plan: "Plan B"}]`.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  /*──────────────────────────────────────────────────────────────────────────
    ANALÍTICAS / REPORTES — Catálogo IaPreguntas (ACTIVAS)

    REGLA COMÚN: Antes de invocar cualquiera de estas 3 tools, el modelo
    DEBE haber llamado antes a `obtener_planes_disponibles` para tener el
    catálogo actualizado de planes (ids + nombres) y poder mapear
    correctamente los nombres que mencione el usuario a sus IDs.
    ─────────────────────────────────────────────────────────────────────────*/

  {
    name: 'consultar_resumen_financiero_hospitales',
    description:
      'Responde la pregunta de prioridad alta del catálogo: ' +
      '"¿Cuántos días se han denegado / aprobado / recuperado en (fecha)?".\n\n' +
      'Suma los campos Finanzas.aprobado, Finanzas.denegado y Finanzas.recuperado ' +
      'de las auditorías del período y devuelve:\n' +
      '  • Totales globales (rolled-up a través de los hospitales consultados).\n' +
      '  • Desglose por hospital en `porHospital[]` (siempre poblado).\n' +
      '  • Si se envía `idPlanes`, cada hospital incluye además `planes[]` con los totales ' +
      'por plan (sólo planes con datos — los planes pedidos sin actividad NO aparecen).\n\n' +
      'PRERREQUISITO OBLIGATORIO:\n' +
      '  • Antes de invocar esta tool, DEBES llamar primero a `obtener_planes_disponibles` ' +
      'para tener el catálogo actualizado de planes (ids + nombres). Sin ese catálogo en ' +
      'contexto, NO puedes construir el parámetro `idPlanes` de forma fiable.\n' +
      '  • Si el usuario menciona un plan por nombre ("Plan A", "plan premium"), usa esa ' +
      'tool para mapear el nombre al `idPlan` correspondiente.\n' +
      '  • NUNCA inventes `idPlanes` ni uses IDs memorizados de conversaciones anteriores.\n\n' +
      'USO:\n' +
      '  • Úsala cuando el usuario pregunte por totales de días aprobados, denegados o ' +
      'recuperados en un período específico ("días denegados", "días aprobados", ' +
      '"auditorías aprobadas/denegadas", "resumen financiero", etc.).\n' +
      '  • Todos los `totalX` son enteros (días, NO dinero).\n' +
      '  • Sin `idPlanes`: `porHospital[].planes = null`. Con `idPlanes`: `planes[]` se ordena ' +
      'por `totalDenegado desc, idPlan asc`.\n' +
      '  • El filtro de plan va por la cadena `Auditorias.IdPlanNivel → PlanNivel.PnlPlanId → ' +
      'Planes.IdPlanes`. Auditorías sin plan quedan EXCLUIDAS cuando se envía `idPlanes`.\n\n' +
      'OBTENCIÓN DE PARÁMETROS:\n' +
      '  • `anio`: int requerido (1900–2999). Si el usuario no lo da, pregunta.\n' +
      '  • `meses`: int[] opcional (1–12). Si se omite o se envía vacío, se asumen los 12 meses del año.\n' +
      '  • `idHospitales`: int[] requerido (al menos uno). Si el usuario solo dice "mis hospitales", ' +
      'usa el listado derivado de las herramientas de perfil/permisos.\n' +
      '  • `idPlanes`: int[] opcional. ANTES de usarlo, llama a `obtener_planes_disponibles` ' +
      'para obtener los IDs válidos. Si el usuario menciona un plan por nombre, esa tool te ' +
      'devuelve el `idPlan` correspondiente. Si NO envías `idPlanes`, OMITE el campo ' +
      '(no envíes array vacío).\n\n' +
      'FORMATO DE SALIDA (OBLIGATORIO): usa SOLO <b>, <i>, <code>, <a> y listas simples ' +
      'con guion (una línea por hospital/plan, con valores separados por comas o espacios). ' +
      'NUNCA uses <pre>, <table>, <ul>, <li>, <br>, ni columnas alineadas para presentar ' +
      'datos. Aunque tengas varias entidades que comparar (`porHospital[]`, `planes[]`), NO ' +
      'las pongas en un bloque con columnas; usa SIEMPRE una lista con guion, una línea por ' +
      'entidad. Ejemplo correcto: "- Hospital San Lucas — aprobados 187, denegados 133, ' +
      'recuperados 3 (40 auditorías).". Estructura esperada: 1) totales primero con unidad; ' +
      '2) filtros aplicados en una línea; 3) desglose como lista con guion (NUNCA como tabla ' +
      'ni bloque <pre>).',
    input_schema: {
      type: 'object',
      properties: {
        anio: {
          type: 'integer',
          description: 'Año del período. Rango válido: 1900–2999.',
          minimum: 1900,
          maximum: 2999,
        },
        meses: {
          type: 'array',
          items: { type: 'integer', minimum: 1, maximum: 12 },
          description:
            'Meses a incluir (1–12). Si se omite o se envía vacío, se asumen los 12 meses del año. ' +
            'Ej: [1, 2, 4] = enero, febrero y abril.',
        },
        idHospitales: {
          type: 'array',
          items: { type: 'integer' },
          minItems: 1,
          description:
            'IDs de hospitales a incluir (al menos uno). Ej: [1, 2, 5].',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes médicos para filtrar (opcional). Ej: [1127, 1123]. ' +
            'Si se omite, no se aplica filtro por plan. Cuando se envía, las auditorías ' +
            'sin plan asociado quedan excluidas.',
        },
      },
      required: ['anio', 'idHospitales'],
    },
  },

  {
    name: 'consultar_determinacion_adversa_mas_frecuente',
    description:
      'Responde: "¿Cuál es la determinación adversa más frecuente?".\n\n' +
      'Devuelve un ranking de las determinaciones adversas (tabla AuditoriaConceptos) más ' +
      'aplicadas en el período, agrupadas por hospital.\n\n' +
      'VISTAS DEVUELTAS:\n' +
      '  • `items[]` (FLAT, siempre poblado) — top-N por (hospital, concepto). ' +
      '`cantidad` y `totalDiasDenegados` rolled-up a través de los planes cuando hay filtro.\n' +
      '  • `itemsPorPlan[]` (NESTED, sólo si `idPlanes` viene poblado) — top-N conceptos ' +
      'dentro de cada (hospital, plan).\n\n' +
      'PRERREQUISITO OBLIGATORIO:\n' +
      '  • Antes de invocar esta tool, DEBES llamar primero a `obtener_planes_disponibles` ' +
      'para tener el catálogo actualizado de planes (ids + nombres). Sin ese catálogo en ' +
      'contexto, NO puedes construir el parámetro `idPlanes` de forma fiable.\n' +
      '  • Si el usuario menciona un plan por nombre ("Plan A", "plan premium"), usa esa ' +
      'tool para mapear el nombre al `idPlan` correspondiente.\n' +
      '  • NUNCA inventes `idPlanes` ni uses IDs memorizados de conversaciones anteriores.\n\n' +
      'USO:\n' +
      '  • Úsala cuando el usuario pregunte por la "determinación adversa más frecuente", ' +
      '"concepto más común", "lo que más se deniega por concepto", "ranking por cantidad", ' +
      'o similares donde la métrica principal es la FRECUENCIA.\n' +
      '  • Si el usuario pregunta por DÍAS DENEGADOS (no cantidad), usa ' +
      '`consultar_concepto_mas_dias_denegados` en su lugar — son métricas distintas.\n\n' +
      'MÉTRICAS:\n' +
      '  • `cantidad` = filas en AuditoriaConceptos (registros administrativos).\n' +
      '  • `totalDiasDenegados` = suma de `dias_denegados` de esas filas.\n\n' +
      'RANKINGS:\n' +
      '  • `items[]`: top-N por hospital (default API = 5).\n' +
      '  • `itemsPorPlan[plan].conceptos`: `cantidad desc, totalDiasDenegados desc` (desempate).\n' +
      '  • Planes pedidos sin actividad NO aparecen en `itemsPorPlan`.\n\n' +
      'OBTENCIÓN DE PARÁMETROS:\n' +
      '  • `anio`: int requerido (1900–2999). Si el usuario no lo da, pregunta.\n' +
      '  • `meses`: int[] opcional (1–12). Si se omite o se envía vacío, se asumen los 12 meses del año.\n' +
      '  • `idHospitales`: int[] requerido (al menos uno). Si el usuario solo dice "mis hospitales", ' +
      'usa el listado derivado de las herramientas de perfil/permisos.\n' +
      '  • `idPlanes`: int[] opcional. ANTES de usarlo, llama a `obtener_planes_disponibles` ' +
      'para obtener los IDs válidos. Si el usuario menciona un plan por nombre, esa tool te ' +
      'devuelve el `idPlan` correspondiente. Si NO envías `idPlanes`, OMITE el campo ' +
      '(no envíes array vacío) y `itemsPorPlan` vendrá `null`.\n' +
      '  • `top`: int opcional. Top-N por hospital en `items[]` y por (hospital, plan) en ' +
      '`itemsPorPlan[].conceptos[]`. Si se omite, la API usa 5. Rango recomendado: 1–20.\n\n' +
      'FORMATO DE SALIDA (OBLIGATORIO): usa SOLO <b>, <i>, <code>, <a> y listas simples con ' +
      'guion para presentar el ranking (una línea por concepto, con sus valores separados por ' +
      'comas o espacios). NUNCA uses <pre>, <table>, <ul>, <li>, <br>, ni columnas alineadas. ' +
      'Aunque tengas varias entradas (`items[]` o `itemsPorPlan[]`), NO las pongas en un bloque ' +
      'con columnas; usa SIEMPRE una lista con guion. Ejemplo correcto: "- Hospital San Lucas — ' +
      'concepto "Criterio de Alta", cantidad 25, días denegados 87."; si hay varias, una línea por ' +
      'concepto. Si agrupas por plan, una sección por plan (encabezado en <b>) y dentro la lista con guion.',
    input_schema: {
      type: 'object',
      properties: {
        anio: {
          type: 'integer',
          description: 'Año del período. Rango válido: 1900–2999.',
          minimum: 1900,
          maximum: 2999,
        },
        meses: {
          type: 'array',
          items: { type: 'integer', minimum: 1, maximum: 12 },
          description:
            'Meses a incluir (1–12). Si se omite o se envía vacío, se asumen los 12 meses del año. ' +
            'Ej: [1, 2, 4] = enero, febrero y abril.',
        },
        idHospitales: {
          type: 'array',
          items: { type: 'integer' },
          minItems: 1,
          description:
            'IDs de hospitales a incluir (al menos uno). Ej: [1, 2, 5].',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes médicos para filtrar (opcional). Ej: [1127, 1123]. ' +
            'Si se omite, no se aplica filtro por plan y `itemsPorPlan = null`. ' +
            'Cuando se envía, se incluyen ambas vistas (items[] flat + itemsPorPlan[] nested) ' +
            'y se devuelven sólo los planes con actividad. ' +
            'ANTES de usar este parámetro, llama a `obtener_planes_disponibles` para ' +
            'obtener los IDs válidos (y mapear nombres a IDs si el usuario mencionó un plan).',
        },
        top: {
          type: 'integer',
          description:
            'Top-N por hospital (en `items[]`) o por (hospital, plan) (en `itemsPorPlan[].conceptos[]`). ' +
            'Si se omite, la API usa 5. Rango recomendado: 1–20.',
          minimum: 1,
          maximum: 50,
        },
      },
      required: ['anio', 'idHospitales'],
    },
  },

  {
    name: 'consultar_concepto_mas_dias_denegados',
    description:
      'Responde: "¿Qué concepto / determinación genera más días denegados?".\n\n' +
      'DIFERENCIA CLAVE con `consultar_determinacion_adversa_mas_frecuente`: acá el ranking es ' +
      'por `totalDiasDenegados desc` (NO por cantidad).\n\n' +
      'BLOQUES DEL RESPONSE:\n' +
      '  • `masDiasDenegadosGlobal` — concepto ganador absoluto (sumando todos los hospitales ' +
      'y planes). Solo expone `idConcepto`, `concepto` y `totalDiasDenegados` — ' +
      'INTENCIONALMENTE NO incluye `cantidad` (es la métrica principal, sin ruido).\n' +
      '  • `porHospital[]` — top-N conceptos por hospital (rolled-up si hay filtro de plan).\n' +
      '  • `itemsPorPlan[]` — sólo cuando hay `idPlanes`, agrupa por (hospital, plan) con top-N ' +
      'conceptos dentro.\n\n' +
      'PRERREQUISITO OBLIGATORIO:\n' +
      '  • Antes de invocar esta tool, DEBES llamar primero a `obtener_planes_disponibles` ' +
      'para tener el catálogo actualizado de planes (ids + nombres). Sin ese catálogo en ' +
      'contexto, NO puedes construir el parámetro `idPlanes` de forma fiable.\n' +
      '  • Si el usuario menciona un plan por nombre ("Plan A", "plan premium"), usa esa ' +
      'tool para mapear el nombre al `idPlan` correspondiente.\n' +
      '  • NUNCA inventes `idPlanes` ni uses IDs memorizados de conversaciones anteriores.\n\n' +
      'USO:\n' +
      '  • Úsala cuando el usuario pregunte por "qué concepto genera más días denegados", ' +
      '"lo que más días denegados produce", "ranking por días denegados", o similares donde ' +
      'la métrica principal son los DÍAS.\n' +
      '  • Si el usuario pregunta por FRECUENCIA/CANTIDAD (no días), usa ' +
      '`consultar_determinacion_adversa_mas_frecuente` en su lugar.\n\n' +
      'RANKINGS:\n' +
      '  • `porHospital[]`: top-N conceptos por hospital (default API = 10).\n' +
      '  • `itemsPorPlan[plan].conceptos`: `totalDiasDenegados desc, cantidad desc` (desempate).\n' +
      '  • `cantidad` se calcula internamente y se usa como tie-breaker — sólo NO se serializa ' +
      'en `masDiasDenegadosGlobal`.\n' +
      '  • Planes pedidos sin actividad NO aparecen en `itemsPorPlan`.\n\n' +
      'FORMATO DE SALIDA (OBLIGATORIO): usa SOLO <b>, <i>, <code>, <a> y listas simples con ' +
      'guion para presentar el ranking (una línea por concepto, con sus valores separados por ' +
      'comas o espacios). NUNCA uses <pre>, <table>, <ul>, <li>, <br>, ni columnas alineadas. ' +
      'Aunque tengas varias entradas (`porHospital[]` o `itemsPorPlan[]`), NO las pongas en un ' +
      'bloque con columnas; usa SIEMPRE una lista con guion. Ejemplo correcto: "- Hospital San ' +
      'Lucas — concepto "Criterio de Alta", total días denegados 87."; si hay varias, una línea ' +
      'por concepto. El ganador absoluto (`masDiasDenegadosGlobal`) va primero con su cifra en ' +
      '<b>. Si agrupas por plan, una sección por plan (encabezado en <b>) y dentro la lista con guion.',
    input_schema: {
      type: 'object',
      properties: {
        anio: {
          type: 'integer',
          description: 'Año del período. Rango válido: 1900–2999.',
          minimum: 1900,
          maximum: 2999,
        },
        meses: {
          type: 'array',
          items: { type: 'integer', minimum: 1, maximum: 12 },
          description:
            'Meses a incluir (1–12). Si se omite, se asumen los 12 meses del año.',
        },
        idHospitales: {
          type: 'array',
          items: { type: 'integer' },
          minItems: 1,
          description: 'IDs de hospitales a incluir (al menos uno).',
        },
        idPlanes: {
          type: 'array',
          items: { type: 'integer' },
          description:
            'IDs de planes médicos para filtrar (opcional). Si se omite, `itemsPorPlan = null`. ' +
            'ANTES de usar este parámetro, llama a `obtener_planes_disponibles` para ' +
            'obtener los IDs válidos (y mapear nombres a IDs si el usuario mencionó un plan).',
        },
        top: {
          type: 'integer',
          description:
            'Top-N por hospital (en `porHospital[]`) o por (hospital, plan) (en `itemsPorPlan[].conceptos[]`). ' +
            'Si se omite, la API usa 10. Rango recomendado: 1–20.',
          minimum: 1,
          maximum: 50,
        },
      },
      required: ['anio', 'idHospitales'],
    },
  },
];