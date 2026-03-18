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
];
//# sourceMappingURL=tools.js.map