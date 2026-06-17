# Integración de Twilio para Llamadas de Voz

## Descripción General

Este módulo integra **Twilio** para manejar llamadas telefónicas de voz con síntesis y reconocimiento de voz. Los usuarios pueden llamar al número de Twilio y interactuar con el asistente de IslandMed mediante voz natural.

## Características

✅ **Llamadas entrantes**: Recibe llamadas y responde automáticamente  
✅ **Reconocimiento de voz (Speech-to-Text)**: Convierte las palabras del usuario a texto  
✅ **Síntesis de voz (Text-to-Speech)**: Responde al usuario en voz natural  
✅ **Manejo de interrupciones**: Permite que el usuario interrumpa en cualquier momento  
✅ **Respuestas divididas**: Divide respuestas largas en párrafos cortos para una mejor experiencia  
✅ **Llamadas salientes**: Inicia llamadas desde el sistema (confirmaciones, notificaciones)  
✅ **Grabación de llamadas**: Registra las conversaciones para auditoría  
✅ **SMS integrado**: Puede enviar SMS cuando es necesario  

## Configuración

### 1. Obtener Credenciales de Twilio

1. Accede a [Twilio Console](https://console.twilio.com)
2. Obtén tu:
   - **Account SID**
   - **Auth Token**
   - **Phone Number** (número telefónico de Twilio asignado)

### 2. Variables de Entorno

Copia `.env.example` a `.env` y completa:

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+17875582742
API_URL=https://your-domain.com
```

### 3. Configurar Webhooks en Twilio

En la consola de Twilio, asegúrate de que tus números de teléfono tengan configurados los siguientes webhooks:

**Para llamadas entrantes (Voice):**
```
POST https://your-domain.com/twilio/voice-webhook
```

**Para cambios de estado de llamadas:**
```
POST https://your-domain.com/twilio/call-status
```

## Archivos del Módulo

```
src/twilio/
├── twilio.module.ts       # Definición del módulo NestJS
├── twilio.service.ts      # Lógica de integración con Twilio API
└── twilio.controller.ts   # Webhooks y endpoints
```

### twilio.service.ts

Proporciona métodos para:

- `generateVoiceResponse()`: Crea respuestas de voz en TwiML
- `initiateOutboundCall()`: Inicia una llamada saliente
- `getCallInfo()`: Obtiene información de una llamada
- `getRecording()`: Obtiene la grabación de una llamada
- `endCall()`: Termina una llamada activa
- `sendSMS()`: Envía un SMS

### twilio.controller.ts

**Endpoints:**

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/twilio/voice-webhook` | Webhook para llamadas entrantes |
| `POST` | `/twilio/process-speech` | Procesa el audio/voz del usuario |
| `POST` | `/twilio/call-status` | Notificación de cambios de estado |
| `POST` | `/twilio/initiate-call` | Inicia una llamada saliente |

## Flujo de una Llamada Entrante

```
1. Usuario llama al número de Twilio
   ↓
2. Twilio envía POST a /twilio/voice-webhook
   ↓
3. Sistema responde con TwiML + prompt de escucha
   ↓
4. Usuario habla su pregunta
   ↓
5. Twilio envía voz a /twilio/process-speech
   ↓
6. Sistema convierte voz a texto (SpeechResult)
   ↓
7. Envía el texto al servicio de chat (channel: "voice")
   ↓
8. Chat devuelve respuesta con adaptaciones para voz
   ↓
9. Sistema convierte respuesta a TwiML y la envía
   ↓
10. Twilio sintetiza la voz y se la reproduce al usuario
    ↓
11. Se repite desde paso 3
```

## Adaptaciones para Voz

El sistema automáticamente:

1. **Detección de idioma**: Identifica español vs inglés
2. **Respuestas cortas**: Limita a 2-3 frases por intervención
3. **Sin Markdown**: Elimina símbolos especiales y formatos
4. **Números deletreados**: Para teléfonos, códigos, fechas
5. **Pausas naturales**: Agrega pausas entre párrafos
6. **Confirmaciones**: Solicita confirmación para datos críticos

## Ejemplo de Uso desde el Chat

Cuando un usuario interactúa por voz, el `channel: "voice"` se pasa automáticamente al servicio de chat:

```typescript
// En twilio.controller.ts
const chatResponse = await this.chatService.chat({
  chat_id: this.hashPhoneToId(From),
  message: SpeechResult,
  channel: 'voice', // ← Indicador de canal
});
```

El `system.ts` incluye instrucciones específicas para voz cuando detecta este parámetro.

## Variables Detectadas por el Sistema

```javascript
// Detecta automáticamente en el contexto:
- X-Channel: 'voice' (header HTTP)
- channel: 'voice' (parámetro)
- user_type: 'phone' (tipo de usuario)
```

## Manejo de Errores en Voz

El controlador maneja automáticamente:

- ❌ Voz no reconocida (baja confianza < 0.5)
- ❌ Silencio excesivo (timeout 5 segundos)
- ❌ Errores de procesamiento

En cada caso, responde cordialmente y repite la solicitud.

## Llamadas Salientes

Para iniciar una llamada (confirmaciones, recordatorios):

```bash
curl -X POST http://localhost:3000/twilio/initiate-call \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+17875554321",
    "message": "Tu código de verificación es dos tres cinco ocho",
    "webhookUrl": "https://your-domain.com/twilio/process-speech"
  }'
```

## Grabación de Llamadas

Todas las llamadas se graban automáticamente. Para obtener la grabación:

```typescript
const recording = await this.twilioService.getRecording(recordingSid);
```

## Seguridad

- ✅ Validación de números de teléfono
- ✅ Verificación de confianza en reconocimiento de voz
- ✅ Límites de tiempo para respuestas
- ✅ Encriptación de credenciales en `.env`

## Pruebas Locales

Para probar localmente, necesitas:

1. **ngrok** para exponer tu localhost:
   ```bash
   ngrok http 3000
   ```

2. Usar la URL de ngrok como webhook en Twilio:
   ```
   https://xxxx-xx-xxx-xx-xx.ngrok.io/twilio/voice-webhook
   ```

3. Llamar a tu número de Twilio

## Logs

El módulo registra todos los eventos:

```
[TwilioService] Outbound call initiated: CAxxxxxxxxxxxx
[TwilioController] Incoming call: From=+17875554321, To=+17875582742, CallSid=CAxxxx
[TwilioController] Speech received: Text="Quiero comprar un paquete", Confidence=0.95
```

## Troubleshooting

### No se reciben llamadas
- ✅ Verifica que el webhook esté configurado en Twilio Console
- ✅ Confirma que el dominio sea HTTPS
- ✅ Revisa los logs de Twilio en el dashboard

### No funciona el reconocimiento de voz
- ✅ Asegúrate de que `SpeechResult` no esté vacío
- ✅ Verifica la confianza (Confidence > 0.5)
- ✅ Revisa que el micrófono esté activo

### Respuestas robóticas o lentas
- ✅ Reducir el tamaño de la respuesta
- ✅ Usar voces Polly optimizadas para voz natural
- ✅ Verificar velocidad de red

## Próximos Pasos

- [ ] Integrar análisis de emociones en voz
- [ ] Guardar métricas de llamadas
- [ ] Crear dashboard de análisis
- [ ] Configurar alertas de llamadas perdidas
- [ ] Optimizar voces por región (accento puertorriqueño)
