"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOLS = void 0;
exports.TOOLS = [
    {
        name: 'get_perfil',
        description: 'Obtiene los datos del perfil del usuario autenticado en DoctorRecetas. ' +
            'Usalo cuando el usuario pregunte por su perfil, datos personales, nombre, correo, etc.',
        input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'actualizar_perfil',
        description: 'Actualiza campos del perfil del usuario en DoctorRecetas. ' +
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
                    description: 'Objeto JSON con los campos a actualizar. Ej: {"us_nombres": "Juan"}',
                },
            },
            required: ['campos'],
        },
    },
    {
        name: 'get_ordenes',
        description: 'Obtiene las ordenes/pedidos del usuario autenticado en DoctorRecetas. ' +
            'Usalo cuando pregunte por compras, pedidos, productos comprados o enlaces de descarga.',
        input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'get_pagos',
        description: 'Obtiene el historial de pagos y transacciones del usuario autenticado. ' +
            'Usalo cuando pregunte por pagos, facturas o transacciones.',
        input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'get_productos',
        description: 'Obtiene el catalogo de todos los productos disponibles en DoctorRecetas. ' +
            'Usalo cuando pregunte que productos hay, que venden, que esta disponible o quiera buscar algo.',
        input_schema: {
            type: 'object',
            properties: {
                busqueda: {
                    type: 'string',
                    description: 'Termino de busqueda opcional para filtrar productos por nombre.',
                },
            },
            required: [],
        },
    },
    {
        name: 'recordar_conocimiento',
        description: 'Guarda un par de pregunta y respuesta en la base de datos de conocimiento de la IA para usarlo en el futuro. ' +
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
        description: 'Busca información específica en mi base de datos de aprendizaje previo. ' +
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
        description: 'Guarda un dato importante sobre el usuario en su memoria a largo plazo. ' +
            'Úsalo para recordar preferencias, nombres de familiares, condiciones médicas mencionadas, ' +
            'o cualquier detalle personal que mejore la atención a futuro.',
        input_schema: {
            type: 'object',
            properties: {
                clave: {
                    type: 'string',
                    description: "Nombre corto del dato (ej: 'alergias', 'nombre_hijo', 'preferencia_contacto').",
                },
                valor: { type: 'string', description: 'El detalle a recordar.' },
            },
            required: ['clave', 'valor'],
        },
    },
    {
        name: 'consultar_memoria_usuario',
        description: 'Consulta la memoria a largo plazo del usuario actual para obtener detalles personalizados. ' +
            'Úsalo al inicio de una conversación o cuando necesites recordar algo que el usuario te contó en el pasado.',
        input_schema: {
            type: 'object',
            properties: {
                clave: {
                    type: 'string',
                    description: 'Opcional: Filtrar por una clave específica. Si se omite, trae toda la memoria.',
                },
            },
            required: [],
        },
    },
    {
        name: 'verificar_o_registrar_usuario',
        description: 'Verifica si un usuario existe en DoctorRecetas por correo y devuelve su us_id. ' +
            'Si el usuario EXISTE: la API envía automáticamente un código de verificación de 6 dígitos a su correo (válido 10 min). ' +
            'Si NO existe, lo registra con los datos proporcionados. ' +
            'ÚSALO cuando el usuario quiera comprar un producto o servicio y NO esté autenticado. ' +
            'FLUJO OBLIGATORIO: ' +
            '1) Llama PRIMERO solo con us_email. ' +
            '2a) Si la API devuelve { existe: true, codigo_enviado: true }: informa al usuario que se envió un código a su correo y pídele que lo escriba (expira en 10 min). Guarda el us_id recibido. ' +
            '2b) Si la API responde HTTP 422 (faltan campos), el usuario no existe: pídele nombre completo, teléfono y contraseña UNO POR UNO. ' +
            '3) Si registraste al usuario nuevo (caso 2b), ya tienes su us_id. No se envía código en el registro. ' +
            'NUNCA inventes ni rellenes us_nombres, us_telefono ni us_clave — siempre pídelos al usuario.',
        input_schema: {
            type: 'object',
            properties: {
                us_email: {
                    type: 'string',
                    description: 'Correo electrónico del usuario (obligatorio siempre).',
                },
                us_nombres: {
                    type: 'string',
                    description: 'Nombre completo del usuario. Solo incluir si el usuario ya lo proporcionó.',
                },
                us_telefono: {
                    type: 'string',
                    description: 'Teléfono del usuario. Solo incluir si el usuario ya lo proporcionó.',
                },
                us_clave: {
                    type: 'string',
                    description: 'Contraseña elegida por el usuario. Solo incluir si el usuario ya la proporcionó. Se encripta con AES-256-CBC.',
                },
            },
            required: ['us_email'],
        },
    },
    {
        name: 'crear_compra',
        description: 'Registra una intención de compra en DoctorRecetas. ' +
            'La API genera automáticamente el código de la compra (cp_code: DR+8 chars) y un token único de pago (url_generado_pago). ' +
            'ANTES de llamar esta herramienta SIEMPRE debes tener: pq_id (id del producto/paquete), us_id (id del usuario) y anombre_de. ' +
            'El campo anombre_de es OBLIGATORIO y debe ser preguntado SIEMPRE al usuario antes de ejecutar la compra, ' +
            'ya que la compra puede hacerse a nombre de cualquier persona (no necesariamente el comprador). ' +
            'Ejemplo de pregunta: "¿A nombre de quién va la compra?"',
        input_schema: {
            type: 'object',
            properties: {
                pq_id: {
                    type: 'number',
                    description: 'ID del paquete o producto a comprar.',
                },
                us_id: {
                    type: 'number',
                    description: 'ID del usuario que realiza la compra.',
                },
                anombre_de: {
                    type: 'string',
                    description: 'Nombre de la persona a cuyo nombre se registrará la compra. Siempre preguntarlo al usuario.',
                },
            },
            required: ['pq_id', 'us_id', 'anombre_de'],
        },
    },
];
//# sourceMappingURL=tools.js.map