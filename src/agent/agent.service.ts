// src/agent/agent.service.ts
// Núcleo del agente: usa el SDK de Anthropic apuntando al endpoint
// Anthropic-compatible de MiniMax. Esto hace que el razonamiento venga
// en bloques separados `type: "thinking"`, que filtramos para que NUNCA
// lleguen al usuario (solo los bloques `type: "text"` son visibles).

import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  client,
  ANTHROPIC_MODEL,
  conversations,
  // minimaxConversations, // legacy, ya no se usa
  // MiniMaxMessage, MiniMaxToolCall, // legacy
  // USE_ANTHROPIC, // legacy
} from './state';
import { TOOLS } from './tools';
import { executeTool } from './executor';
import { buildSystem, containsUnverifiedClaims, ToolStatus } from './system';
import { DbService } from './db.service';
import { ChatGateway } from '../chat/chat.gateway';

/**
 * Limpia texto generado por el assistant eliminando:
 *   • Bloques `<pre>...</pre>` completos (multilínea).
 *   • Frases prohibidas específicas que el modelo imita desde su historial
 *     viejo aunque el system prompt las prohíba (p.ej.: "Solo los hospitales
 *     X y Y registran actividad", "tasa de recuperación global").
 *   • Frases hechas tipo "Se observa que…", "En resumen…", "Como podemos
 *     ver…", "Esto sugiere que…", "En conclusión…".
 *   • Líneas finales sueltas que son solo interpretación (sin números) y
 *     quedaron tras una respuesta de datos.
 *
 * Se aplica al texto del assistant ANTES de:
 *   (a) pasarlo al modelo como parte del historial en `loadHistoryIfEmpty`,
 *       evitando que el modelo copie el formato viejo.
 *   (b) guardarlo en BD con `persistMessage`, evitando acumular más
 *       respuestas contaminadas.
 */
function sanitizeAssistantText(text: string): string {
  if (!text) return text;

  // 1) Eliminar TODO bloque <pre ...>...</pre> (incluso multilínea).
  let out = text.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, '');

  // 2) Eliminar frases hechas prohibidas (al inicio, en medio, o como
  //    línea completa). Coincide con tolerancia a mayúsculas iniciales y
  //    posibles caracteres intermedios.
  const forbiddenFragments: RegExp[] = [
    // Bloques genéricos
    /^.*\bSolo los hospitales? .*registran actividad\.?\s*$/gim,
    /^.*\bLos hospitales? .*no tienen datos\.?\s*$/gim,
    /^.*\btasa de recuperación\b.*$/gim,
    /^.*\btasa de aprobación\b.*$/gim,
    /^.*\btasa global\b.*$/gim,
    // Frases hechas
    /^.*\bSe observa que\b.*$/gim,
    /^.*\bEn resumen\b.*$/gim,
    /^.*\bComo podemos ver\b.*$/gim,
    /^.*\bEsto sugiere que\b.*$/gim,
    /^.*\bEn conclusión\b.*$/gim,
    /^.*\bNótese que\b.*$/gim,
    /^.*\bCabe destacar que\b.*$/gim,
    /^.*\bEs importante señalar que\b.*$/gim,
    // Filtraciones de tool calls / JSON crudo / tablas (NUNCA debe aparecer en respuesta al usuario)
    /^.*\bJSON crudo\b.*$/gim,
    /^.*\bAqui está el JSON\b.*$/gim,
    /^.*\bAquí está el JSON\b.*$/gim,
    /^.*\bEl sistema añadió\b.*$/gim,
    /^.*\bLa tabla (anterior|anterior|con|que se muestra)\b.*$/gim,
    /^.*\b(tabla con|tabla anterior|tabla arriba|tabla de arriba)\b.*$/gim,
    /^.*\bdevuelt[oa]s? por (la herramienta|el (endpoint|sistema|backend))\b.*$/gim,
    /^.*\b(raw|rawJson|rawjson|tool[_ ]?result)\b.*$/gi,
    /^.*\b(Respuesta|HTTP) (cruda|sin procesar)\b.*$/gim,
    // ANUNCIOS DE ACCIÓN SIN EJECUTAR (deben pasar por ANUNCIO_SIN_ACCION, pero
    // también los bloqueamos aquí para que el cliente no vea el texto filtrado).
    /^.*\bllamando( (a(l)?|del?))? (la |el |los |las )?(cat[áa]logo|hospitales?|planes?|herramienta|tool|endpoint|consulta|api)\b.*$/gim,
    /^.*\bconsultando( (a(l)?|del?))? (la |el |los |las )?(cat[áa]logo|hospitales?|planes?|herramienta|tool|endpoint|consulta|api)\b.*$/gim,
    /^.*\bejecutando( (la|el|los|las))? (consulta|tool|llamada|herramienta)\b.*$/gim,
    /^.*\biniciando (consulta|llamada)\b.*$/gim,
    /^.*\bobteniendo (datos|informaci[oó]n)\b.*$/gim,
    /^.*\bno puedo ejecutar( la consulta| la herramienta)?\b.*$/gim,
    /^.*\bcon (los|las|tus) filtros (de |de la )(consulta|pregunta|solicitud) anterior\b.*$/gim,
    /^.*\busando (los|las) (mismos|anteriores) filtros\b.*$/gim,
    // AFIRMAR RESULTADOS SIN HABER LLAMADO A UNA TOOL
    /^.*\bno (tengo|hay|existen) (resultados?|datos?)\b.*$/gim,
    /^.*\b(no se|pude) (obtener|conseguir) (datos?|resultados?)\b.*$/gim,
    /^.*\bla consulta (no|no ha) (devolvi[oó]|retorn[oó]|tuvo)\b.*$/gim,
    // RENDICIÓN: ofrecer "calcular" o "confirmar" en vez de mostrar el dato
    /^.*\b¿(prefieres|quieres|deseas) (que (calcule|te calcule|calcule|usemos|yo)|calcule|que confirme)\b.*$/gim,
    /^.*\bpara (responder|consultar) con datos v[aá]lidos[, ]+(¿(prefieres|quieres)|qu[eé])\b.*$/gim,
    /^.*\b(no dispongo|no cuento) de (una )?herramienta(s)? que (devuelvan?|de) (directamente|el campo)\b.*$/gim,
    /^.*\bno (dispongo|cuento) de (un|una|el|los|las)?\s*(campo|herramienta|tool|funci[oó]n) (directo|directamente|que|para|que devuelva)\b.*$/gim,
    /^.*\b(no dispongo|no cuento) de (un|una|el|los|las)?\s*campo (directo|directamente|llamado)\b.*$/gim,
    // FÓRMULA DENEGADO − RECUPERADO (prohibida — solo aplica a dinero, no a días)
    /^.*\b(aplicando|usando) (la )?f[oó]rmula (DENEGADO|APROBADO)\s*[\-−]\s*(RECUPERADO|DENEGADO)\b.*$/gim,
    /^.*\bDENEGADO\s*[\-−]\s*RECUPERADO\b.*$/gim,
    // EL BOT NO DEBE CALCULAR SU PROPIO PORCENTAJE CUANDO LA API LO DEVUELVE
    /^.*\b(yo )?calcul[eé] (el|la|los|las)?\s*(%|porcentaje|tasa)/i,
    /^.*\bcalcul[eé] (el|la)?\s*(%|porcentaje) (de (la )?distribuci[oó]n|de (los|las) (datos|porcentajes)|sobre el total)\b/i,
    /^.*\b(la|el) % (de la distribuci[oó]n|sobre el total|de (los|las) datos)\b/i,
    // DIVISIÓN MANUAL DE MONTOS PARA OBTENER PORCENTAJE: "$X / $Y = Z% de ..."
    /[^\n]*\$\s*[\d,.]+\s*\)?\s*[\u00f7\u002f\\\/÷]\s*\$?\s*[\d,.]+\s*\)?\s*=\s*[\d,.]+\s*%\s*de\s+(p[eé]rdida|recuperaci[oó]n|aprobaci[oó]n|denegaci[oó]n|denegados|rechazo|rechazados)\b[^\n]*/gi,
    /[^\n]*\$\s*[\d,.]+\s*[\u00f7\u002f\\\/÷]\s*\$?\s*[\d,.]+\s*=\s*[\d,.]+\s*%[^\n]*/gi,
    /[^\n]*=\s*[\d,.]+\s*%\s*de\s+(p[eé]rdida|recuperaci[oó]n|aprobaci[oó]n|denegaci[oó]n)\b[^\n]*/gi,
    // "X% de pérdida" / "X% de recuperación" sin mostrar la fórmula
    /[^\n]*[\d,.]+\s*%\s*de\s+(p[eé]rdida|recuperaci[oó]n|aprobaci[oó]n|denegaci[oó]n|rechazo)\b[^\n]*/gi,
    // "aplicando la fórmula % pérdida = perdido ÷ facturado"
    /[^\n]*\baplicando (la )?f[oó]rmula\b[^\n]*%[^\n]*/gi,
    /[^\n]*\bf[oó]rmula\s+%\s+(p[eé]rdida|recuperaci[oó]n|aprobaci[oó]n|denegaci[oó]n)\s*=[^\n]*/gi,
    // PEDIR AÑO / MES / HOSPITAL / PLAN CUANDO YA SE DISCUTIÓ EN ESTA CONVERSACIÓN
    /^.*\b¿(para|en|a|de) (qué|cu[áa]l|cu[áa]les) (a[ñn]o|mes|periodo|período|hospital(es)?|plan(es)?|indicador(es)?)\??\s*$/i,
    /^.*\b¿(para|en|a|de) (20\d{2}|20\d{2} o 20\d{2})\??\s*$/i,
    /^.*\b(20\d{2})\s+o\s+(20\d{2})\??\s*$/i,
    /^.*\b(a[ñn]o|mes|periodo|hospital|plan)s?\s+(anterior(es)?|previo(s)?|pasado(s)?)\??\s*$/i,
    // EXCUSAS DEL BOT PARA NO LLAMAR A LA API
    /[^\n]*\bla api (devolvi[oó]|retorn[oó]|muestra) (los mismos|el mismo|las mismas) (datos?|totales?|valores?|resultados?)[^\n]*/gi,
    /[^\n]*\bpese a (pedir|solicitar|indicar|mencionar) (solo|solamente|[uú]nicamente)[^\n]*/gi,
    /[^\n]*\bsin (filtro|cambio|modificaci[oó]n) (de |del |de la |de los |de las )(hospital|plan|mes|a[ñn]o|periodo)[^\n]*/gi,
    /[^\n]*\bno se aprecia (un |el |la )?(corte|filtro|distinci[oó]n|cambio)[^\n]*/gi,
    /[^\n]*\b(para ver|para obtener) (octubre|noviembre|...?) (real|de verdad|concreto|espec[ií]fico)[^\n]*/gi,
    // EXCUSAS DE "NO DISPONGO" / "NO HAY ENDPOINT" / "LAS HERRAMIENTAS NO DEVUELVEN"
    /[^\n]*\bno dispongo de (un|una|el|los|las)?\s*(campo|herramienta|tool|funci[oó]n|endpoint|m[eé]todo|recurso)\b[^\n]*/gi,
    /[^\n]*\b(las herramientas|las tools|los endpoints) (de (audita|la api))?\s*(no |s[oó]lo )?(entregan|devuelven|tienen|traen|muestran|exponen|cubren|soportan|ofrecen)\b[^\n]*/gi,
    /[^\n]*\bno (hay|tengo|existe|existen) (un|una|el|los|las)?\s*(campo|herramienta|tool|endpoint|m[eé]todo)\b[^\n]*/gi,
    /[^\n]*\b(esa|esta) (informaci[oó]n|m[eé]trica|consulta|pregunta) (no (est[aá])? (disponible|expuesta|soportada|cubierta|accesible)|est[aá] (disponible|expuesta|soportada|cubierta|accesible))\b[^\n]*/gi,
    // EXCUSAS DE "NO CUENTO CON" / "NO TENGO" / "NO POSEO" / "LO QUE PUEDO"
    /[^\n]*\bno (cuento con|tengo|poseo|dispongo de) (un|una|el|los|las|alguna?)?\s*(herramienta|tool|funci[oó]n|capacidad|m[eé]todo|endpoint|recurso|forma|manera)\b[^\n]*/gi,
    /[^\n]*\b(disculpa|perd[oó]n|lo siento),?\s+pero (no puedo|no me es posible|no tengo)\b[^\n]*/gi,
    /[^\n]*\bno puedo (cumplir|ejecutar|atender|procesar|realizar|seguir|continuar) (esa|esa|esta|las?|los?)\b[^\n]*/gi,
    /[^\n]*\bno puedo (cumplir|ejecutar|atender|procesar|realizar|seguir|continuar)\s+al pie de la letra\b[^\n]*/gi,
    /[^\n]*\bno puedo (cumplir|ejecutar|atender|procesar|realizar|seguir|continuar) (esa|esta) (instrucci[oó]n|cadena|solicitud|petic[ií]on)\b[^\n]*/gi,
    /[^\n]*\bno (es posible|puedo) (consultar|obtener|ver|mostrar|agrupar|comparar|calcular|filtrar|desglosar)\b[^\n]*/gi,
    /[^\n]*\blo que (puedo|s[ií]) (consultar|hacer|ofrecer|es) (es |son )?\b[^\n]*/gi,
    /[^\n]*\b(la herramienta|el endpoint|el m[eé]todo) (no|s[oó]lo) (permite|soporta|devuelve|cubre|hace)\b[^\n]*/gi,
    // PREGUNTAR CONFIRMACIÓN DESPUÉS DE QUE EL USUARIO YA PIDIÓ COMPARAR/ANALIZAR
    /[^\n]*¿[Qq]uieres que (compare|compre|calcule|vea|muestre|consulte|intente|filtre|agrupe|desglose|busque|haga)\b[^\n]*\?/gi,
    /[^\n]*¿[Dd]eseas que (compare|compre|calcule|vea|muestre|consulte|intente|filtre|agrupe|desglose|busque|haga)\b[^\n]*\?/gi,
    /[^\n]*¿[Pp]refieres que (compare|compre|calcule|vea|muestre|consulte|intente|filtre|agrupe|desglose|busque|haga)\b[^\n]*\?/gi,
    /[^\n]*¿[Qq]uieres (que (lo|la) )?(intente|filtre|agrupe|desglose|busque|haga|consulte)\b[^\n]*\?/gi,
    /[^\n]*¿[Ll]o (intente|intento|agrego|aplico|hago|consulto)\b[^\n]*\?/gi,
    // EXCUSAS DE "PARA RESPONDER NECESITARÍA" / "FALTARÍA QUE"
    /[^\n]*\bpara (responder|contestar|resolver) (con (precisi[oó]n|datos?))? (necesitar[ií]a|hace falta|faltar[ií]a)\b[^\n]*/gi,
    /[^\n]*\bnecesitar[ií]a\s+(que\s+)?(un|una|el|los|las)?\s*(hospital|plan|mes|a[ñn]o|filtro|categor[ií]a|nivel)\b[^\n]*/gi,
    /[^\n]*\b(la herramienta|el endpoint|el m[eé]todo) (no|s[oó]lo) (permite|soporta|devuelve|cubre|hace|entrega|expone|ofrece)\b[^\n]*/gi,
    /[^\n]*\b(la herramienta|el endpoint) (no|s[oó]lo) (da|entrega|expone|ofrece|soporta) (totales|desglose|detalle|datos?)\b[^\n]*/gi,
    // EXCUSAS DE "NO SE ENVIÓ FILTRO" / "FALTA ENVIAR"
    /[^\n]*\bsin (desglose|detalle|informaci[oó]n) (por|de) (plan|hospital|mes|a[ñn]o|nivel|categor[ií]a) (porque )?no (se |te )?(envi[oó]|incluy[oó]|pas[oó]|agreg[oó]) (el |los |un |una |filtro )?\b[^\n]*/gi,
    /[^\n]*\b(no se (envi[oó]|incluy[oó]|pas[oó]|agreg[oó])|falta (enviar|incluir|pasar|agregar)) (el |los |un |una |filtro )?(de )?(plan|hospital|mes|a[ñn]o|nivel|categor[ií]a)\b[^\n]*/gi,
    /[^\n]*\bno (se |te )?(envi[oó]|incluy[oó]|pas[oó]|agreg[oó]) (filtro|el filtro|los filtros|par[aá]metros) (de |del |de la |de los |de las )?(plan|hospital|mes|a[ñn]o|nivel|categor[ií]a)\b[^\n]*/gi,
    // EXCUSAS DE "INDÍCAME CUÁL O TODOS" / "DIME CUÁL O TODOS"
    /[^\n]*\bsi quieres[ ,]+(puedo|te (puedo|env[ií]o|mando|muestro)|puedo (traer|mostrar|enviar|consultar|calcular))\b[^\n]*/gi,
    /[^\n]*\bsi quieres[ ,]+puedo (traer|mostrar|enviar|consultar|calcular|ver|agregar|filtrar)\b[^\n]*/gi,
    /[^\n]*\b(los datos|el registro|la informacion|el resultado|la respuesta)\s+(de|del|para)\s+([a-z]+\s+){0,3}(no|solo)\s+(incluye|incluyen|contiene|contienen|trae|traen|devuelve|devuelven|muestra|muestran|apoya|apoyan|soporta|soportan|cubre|cubren)\b[^\n]*/gi,
    /[^\n]*\b(los datos|el registro|la informaci[oó]n|el resultado|la respuesta)[^\n]{0,40}?(no|si[oó]lo) (incluye|incluyen|contiene|contienen|trae|traen|devuelve|devuelven|muestra|muestran|soporta|soportan|cubre|cubren)\b[^\n]*/gi,
    /[^\n]*\b(los datos|el registro|la informacion|el resultado)\s+(solo\s+)?(contiene|contienen|trae|traen|devuelve|devuelven|muestra|muestran|soporta|soportan|cubre|cubren)\s+(totales|desglose|detalle|datos?)\b[^\n]*/gi,
    /[^\n]*\b(ind[ií]came|dime|pasame|p[aá]same) (cu[aá]l|cu[aá]les|qu[eé] plan|qu[eé] planes?)\s+(quieres|deseas|prefieres|te interesa|quieres ver|en espec[íi]fico|concreto|particular|exacto)\b[^\n]*/gi,
    /[^\n]*\b(ind[ií]came|dime|pasame|p[aá]same) (cu[aá]l|cu[aá]les)\s*(o|y|,)?\s*(todos|ambos)\b[^\n]*/gi,
    /[^\n]*¿(alg[uú]n|alguno|alguna|algunos|algunas|cu[aá]l|cu[aá]les|qu[eé]) plan(es)?[^\n]*\?/gi,
    // PEDIR HOSPITAL/PLAN CUANDO YA ESTÁ EN EL CONTEXTO
    /¿(agrego|filtrar|filtramos)\s+(un|una|el|la|los|las)\s+(hospital|plan|hospitales|planes)[^\n]*/gi,
    /¿(qu[eé]|cu[aá]l|cu[aá]les)\s+(hospital|plan|hospitales|planes)\s+(quieres|deseas|prefieres|te gustar[ií]a|concreto|espec[ií]fico)[^\n]*\??/gi,
    // PEDIR IDs AL USUARIO (NUNCA — el modelo debe mapear internamente con tools de catálogo)
    /^.*\b(ind[ií]came|indica|dame|dime|p[aá]same|m[aá]ndame|env[ií]ame|necesito|requiero|facil[ií]tame|comparte) (el |los )?(id|ID|Id|c[oó]digo|identificador)( (num[eé]rico|de (hospital|plan|hospitales|planes)))?\b.*$/gim,
    /^.*\b(¿)?(cu[aá]l|cu[aá]les) (es|son) (el|los) (id|ID|Id|c[oó]digo|identificador)( (num[eé]rico|de (hospital|plan|hospitales|planes)))?\??/gim,
    /^.*\b(id|ID) (del|de la) (hospital|plan|hospitales|planes)\b.*$/gim,
    /^.*\b(el|los) (id|ID) (del|de la|de los|de las) (hospital|plan|hospitales|planes)\b.*$/gim,
    /^.*\bpara identificar\b.*$/gim,
    /^.*\bID o nombre\b.*$/gim,
    /^.*\bnombre o ID\b.*$/gim,
    /^.*\bidentificador o nombre\b.*$/gim,
    /^.*\bnombre o identificador\b.*$/gim,
    /^.*\bID o n[uú]mero\b.*$/gim,
    /^.*\bn[uú]mero o ID\b.*$/gim,
    /^.*\b(?:[a[ñn]o|mes|periodo|per[ií]odo)\b.*\bID\b.*$/gim,
    /^.*\bID\b.*\b(?:[a[ñn]o|mes|periodo|per[ií]odo)\b.*$/gim,
    /^.*\bind[ií]came:?\s+.*\bID\b.*$/gim,
    /^.*\b(?:necesito|requiero|p[áa]same|comparte)[\s:]+\s*(?:el|los)?\s*(?:id|ID)\b.*$/gim,
    // PREGUNTAR POR EL AÑO (NUNCA — siempre se infiere currentYear)
    /^.*\b(¿)?(de qu[eé]|qu[eé]|para qu[eé]|en qu[eé]|a qu[eé]) (a[ñn]o|periodo|per[ií]odo)\b.*$/gim,
    /^.*\b(¿)?qu[eé] (a[ñn]o|periodo|per[ií]odo)\b.*$/gim,
    /^.*\b(ind[ií]came|indica|dame|dime) (el|el) a[ñn]o\b.*$/gim,
    /^.*\b(¿)?(de|a|para) cu[aá]l a[ñn]o\b.*$/gim,
    /^.*\b(¿)?(en|a) qu[eé] (a[ñn]o|periodo|per[ií]odo) (es|se|te refieres|dices|dijiste|mencionas)\b.*$/gim,
    /^.*\bel a[ñn]o en cuesti[oó]n\b.*$/gim,
    /^.*\b(?:ind[ií]came|indica|dame|dime)[:\s]+.*\ba[ñn]o\b.*$/gim,
    // PEDIR TIPO DE CONCEPTO (NUNCA — "concepto" en este contexto siempre = determinación adversa)
    /^.*\b(por|qu[eé]) (tipo de )?concepto\b.*$/gim,
    /^.*\b(qu[eé]|cu[aá]l) (tipo |clase de )?concepto\b.*$/gim,
    /^.*\b(¿)?(qu[eé]|cu[aá]l) (es|son) (el|los) (tipo |clase de )?concepto\b.*$/gim,
    // PEDIR CONFIRMACIÓN DE FILTROS INNECESARIA (el modelo ya tiene lo que necesita)
    /^.*\b(¿)?(qu[eé]|cu[aá]l) (filtros?|valores?|par[aá]metros?) (aplico|uso|utilizo|le pongo|debo usar|hay que usar)\b.*$/gim,
    /^.*\b(¿)?(qu[eé]|cu[aá]les) (aplico|uso|utilizo)\b.*$/gim,
    /^.*\baplicar (esos |estos |los )?filtros\b.*$/gim,
    /^.*\b(¿)?confirmo\b.*$/gim,
    /^.*\b(¿)?(qu[eé]) (te gustar[ií]a |quieres? |prefieres? )?aplicar\b.*$/gim,
    // DECIR QUE LA HERRAMIENTA NO SE PUEDE USAR (incorrecto, sí se puede)
    /^.*\bno (se puede|puede) usar (la herramienta|el endpoint|la api)\b.*$/gim,
    /^.*\b(la herramienta|el endpoint) (no funciona|no aplica|no soporta) (sin|si no (hay|tiene))\b.*$/gim,
    /^.*\bsin (filtro de )?(plan|mes|periodo|a[ñn]o).*no (se puede|puede)\b.*$/gim,
    // "Necesito que indiques/me digas/dé…"
    /^.*\bnecesito que (indiques?|me digas|me indiques?|proporciones?|me proporciones?|me (digas|des)|me confirmes)\b.*$/gim,
    /^.*\bnecesito (el |los |que me des |que me digas |saber )?(el|los|a[ñn]o|mes|periodo|plan|hospital|indicador|filtro|par[aá]metro)\b.*$/gim,
    /^.*\bpara (poder )?(consultar|responder|usar|llamar|ejecutar).*necesito\b.*$/gim,
    /^.*\b(indica|dime|dame|comparte) (el |los )?(a[ñn]o|mes|periodo|plan|hospital|indicador|filtro)\b.*$/gim,
    // RE-PEDIR FILTROS YA DISCUTIDOS EN LA CONVERSACIÓN
    /^.*\bpara (responder|consultar|poder (responder|consultar)) correctamente\b.*$/gim,
    /^.*\bconfirma (los |tus )?filtros\b.*$/gim,
    /^.*\bvuelve(?: a)? (confirmar|indicar|pedir|decirme|dame|solicitar)\b.*$/gim,
    /^.*\b(de nuevo|nuevamente) (confirma|indica|decime|dame)\b.*$/gim,
  ];
  for (const re of forbiddenFragments) {
    out = out.replace(re, '');
  }

  // 3) Eliminar porcentaje suelto pegado a "tasa" o "porcentaje":
  //    "...es del 8.0%."  o "...fue del 8%."
  out = out.replace(
    /(?:^|\s)(?:[A-ZÁÉÍÓÚÑ][^.\n]{2,160}?)\s+(?:es|fue|equivale a|representa|corresponde a)\s+(?:del?|al?)\s+\d[\d.,]*%\.?/gi,
    '',
  );

  // 4) Recortar líneas vacías duplicadas y espacios sobrantes.
  out = out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return out;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly db: DbService,
    private readonly chatGateway: ChatGateway,
  ) {}

  // toOpenAITools ya no se usa: el SDK de Anthropic recibe las tools
  // directamente en su formato nativo.

  /** Carga el historial desde la base de datos si la memoria en vivo está vacía */
  private async loadHistoryIfEmpty(
    chatId: number,
  ): Promise<Anthropic.MessageParam[]> {
    if (!conversations.has(chatId)) {
      try {
        const { rows } = await this.db.query(
          `SELECT [role], content
           FROM historial_mensajes
           WHERE chat_id = $1
           ORDER BY created_at ASC
           OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY`,
          [chatId],
        );
        const history: Anthropic.MessageParam[] = rows
          .map((r: { role: string; content: unknown }) => {
            let text = '';
            if (typeof r.content === 'string') {
              try {
                const parsed = JSON.parse(r.content) as unknown;
                if (typeof parsed === 'string') {
                  // Formato antiguo (anterior a SQL Server 2025): contenido
                  // guardado como JSON string entre comillas (`'"hola"'`).
                  // JSON.parse devuelve el string original.
                  text = parsed;
                } else if (
                  parsed !== null &&
                  typeof parsed === 'object' &&
                  'text' in (parsed as Record<string, unknown>) &&
                  typeof (parsed as { text?: unknown }).text === 'string'
                ) {
                  // Formato actual: contenido guardado como objeto
                  // `{"text":"..."}` (SQL Server 2025 ISJSON solo acepta
                  // objetos/arrays). Extraemos el campo `text` para que el
                  // modelo vea solo texto plano y no imite el envoltorio.
                  text = (parsed as { text: string }).text;
                } else {
                  // Otros objetos/arrays: caemos al string plano por seguridad.
                  text = JSON.stringify(parsed);
                }
              } catch {
                text = r.content;
              }
            } else if (r.content !== null && r.content !== undefined) {
              text = JSON.stringify(r.content);
            }
            const role: 'user' | 'assistant' =
              r.role === 'assistant' ? 'assistant' : 'user';
            // Sanitizamos los mensajes del assistant al cargarlos: elimina
            // bloques <pre>, frases hechas y conclusiones interpretativas
            // que el modelo podría imitar de mensajes antiguos guardados
            // antes de que se reforzaran las reglas de formato.
            if (role === 'assistant') {
              text = sanitizeAssistantText(text);
            }
            return { role, content: text } as Anthropic.MessageParam;
          })
          .filter((m: Anthropic.MessageParam) => m.content);
        conversations.set(chatId, history);
      } catch (e) {
        this.logger.error(`Error loading history for ${chatId}: ${e}`);
        conversations.set(chatId, []);
      }
    }
    return conversations.get(chatId)!;
  }

  /** Guarda un mensaje en la base de datos */
  private async persistMessage(
    chatId: number,
    role: string,
    content: unknown,
  ): Promise<void> {
    // La columna `content` es NVARCHAR(MAX) con CHECK (ISJSON(content)=1).
    //
    // IMPORTANTE: en SQL Server 2025 (compat level 170) `ISJSON()` SOLO
    // acepta objetos y arrays — devuelve 0 para escalares JSON (cadenas,
    // números, booleans, null). Esto rompe el formato anterior donde
    // guardábamos el contenido como un string JSON entre comillas
    // (`'"hola"'`). Ahora lo envolvemos siempre en un objeto
    // `{"text":"..."}`, que sí pasa `ISJSON()` en cualquier versión.
    //
    // Al LEER el historial (`loadHistoryIfEmpty`), extraemos el campo
    // `text` del objeto, de modo que el modelo nunca ve el envoltorio
    // y no imita la estructura en sus respuestas.
    let stored: string;
    try {
      const str =
        typeof content === 'string'
          ? content
          : content == null
            ? ''
            : JSON.stringify(content);
      stored = `{"text":${JSON.stringify(str)}}`;
    } catch {
      stored = '{"text":""}';
    }

    // Defensa: validamos con `JSON.parse` que `stored` sea JSON válido
    // antes de mandarlo. Si no lo es, caemos al fallback y logueamos el
    // contenido para diagnosticar.
    try {
      JSON.parse(stored);
    } catch {
      const preview =
        stored.length > 300
          ? `${stored.slice(0, 300)}...[+${stored.length - 300}]`
          : stored;
      this.logger.error(
        `[persistMessage] stored no es JSON valido (chat=${chatId}, role=${role}, ` +
          `len=${stored.length}): ${preview}`,
      );
      stored = '{"text":""}';
    }

    try {
      await this.db.query(
        'INSERT INTO historial_mensajes (chat_id, [role], content) VALUES ($1, $2, $3)',
        [chatId, role, stored],
      );
    } catch (e) {
      const preview =
        stored.length > 300
          ? `${stored.slice(0, 300)}...[+${stored.length - 300}]`
          : stored;
      this.logger.error(
        `Error persisting message (chat=${chatId}, role=${role}, ` +
          `content_len=${stored.length}): ${e}. Content: ${preview}`,
      );
    }
  }

  private appendToHistory(
    chatId: number,
    msgs: Anthropic.MessageParam[],
  ): void {
    const history = conversations.get(chatId) ?? [];
    for (const m of msgs) {
      history.push(m);
    }
    if (history.length > 50) history.splice(0, history.length - 50);
    conversations.set(chatId, history);
  }

  /**
   * Núcleo del agente. Usa el SDK de Anthropic apuntando al endpoint
   * Anthropic-compatible de MiniMax. El razonamiento viene en bloques
   * `type: "thinking"` separados; aquí SOLO tomamos los `type: "text"`
   * para construir la respuesta al usuario.
   */
  private async runAgentCore(
    chatId: number,
    userText: string,
  ): Promise<string> {
    const history = await this.loadHistoryIfEmpty(chatId);

    history.push({ role: 'user', content: userText });
    if (history.length > 50) history.splice(0, history.length - 50);
    await this.persistMessage(chatId, 'user', userText);

    const collected: string[] = [];

    // Tracking acumulado de TODAS las tools llamadas en este turno (a través
    // de todas las rondas del loop). Se usa para validar que las cifras que
    // el modelo escriba provengan de un resultado de herramienta, y no sean
    // alucinaciones. Si no se llama ninguna tool y el draft contiene cifras,
    // se rechaza y se reintenta con una corrección inyectada al historial.
    const turnToolCalls: string[] = [];
    const turnToolResults: string[] = [];
    const turnToolStatuses: ToolStatus[] = [];

    // Buffer circular de los últimos drafts de texto del modelo. Sirve
    // para detectar BUCLES: si el modelo produce el mismo texto (o muy
    // parecido) varias rondas seguidas, sabemos que está "atorado" en
    // una respuesta alucinada o de "no puedo". En ese caso, en lugar
    // de seguir iterando (lo que al final acepta la alucinación al
    // agotar el round limit), cortamos y devolvemos un mensaje útil.
    const recentDrafts: string[] = [];
    const MAX_RECENT_DRAFTS = 4;

    // Bandera: el modelo YA llamó a una tool de datos en esta
    // conversación. Si detecta BUCLE después de tener datos disponibles,
    // NO cortamos: forzamos un retry con un mensaje fuerte de "USA LOS
    // DATOS QUE YA TIENES" en lugar de aceptar la alucinación o devolver
    // un mensaje genérico de error técnico.
    let dataToolCalledInConversation = false;

    // Bandera: en el próximo round, forzar al modelo a usar una tool
    // (Anthropic soporta `tool_choice: 'any'`). Se activa cuando detectamos
    // que el modelo ANUNCIA una acción ("reintentando", "vuelvo a consultar")
    // sin ejecutarla. Si lo dejamos, el modelo se queda en un bucle de
    // "digo que voy a llamar a la tool" sin llamarla nunca.
    let forceToolChoice: 'any' | undefined;

    // Extraemos el último mensaje del usuario para usarlo en
    // detectFilterMismatch (re-llamada obligatoria cuando cambian filtros).
    const lastUserMsg = [...history]
      .reverse()
      .find((m) => m.role === 'user');
    let userMessageText = '';
    if (lastUserMsg) {
      const c = lastUserMsg.content;
      if (typeof c === 'string') userMessageText = c;
      else if (Array.isArray(c)) {
        for (const b of c) {
          const bb = b as { type?: string; text?: string };
          if (bb.type === 'text' && typeof bb.text === 'string') {
            userMessageText = bb.text;
            break;
          }
        }
      }
    }

    for (let round = 0; round < 10; round++) {
      const systemPrompt = await buildSystem(chatId, this.db);

      // ─── Depurador: qué tools tiene disponibles el modelo en este turno ───
      // Logueamos los nombres de las tools disponibles y el historial para
      // poder diagnosticar por qué el modelo elige (o NO elige) una tool
      // concreta. Especialmente útil cuando el modelo alucina "no dispongo
      // de herramienta X" pese a estar listada.
      this.logger.log(
        `[DEBUG round=${round}] tools_disponibles=[${TOOLS.map((t) => t.name).join(', ')}] ` +
          `history.len=${history.length} force_tool_choice=${forceToolChoice ?? '-'}`,
      );

      const response = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: TOOLS,
        // Si la ronda anterior detectó un anuncio sin ejecución, forzamos
        // al modelo a llamar a una tool en esta ronda. Si no, lo dejamos
        // en `auto` (default) para que pueda responder sin tool a saludos
        // u otras consultas.
        ...(forceToolChoice
          ? { tool_choice: { type: forceToolChoice } as const }
          : {}),
        messages: [...history],
      });
      // Consumir la bandera: solo se usa una vez por rechazo.
      forceToolChoice = undefined;

      // Separar los bloques por tipo
      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      );
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      const thinkingBlocks = response.content.filter(
        (b): b is Anthropic.ThinkingBlock => b.type === 'thinking',
      );

      this.logger.log(
        `[Anthropic] round=${round} stop_reason=${response.stop_reason} ` +
          `usage(in={input:${response.usage?.input_tokens ?? 0},` +
          `output:${response.usage?.output_tokens ?? 0}}) ` +
          `text=${textBlocks.length} tool=${toolUseBlocks.length} thinking=${thinkingBlocks.length}`,
      );

      if (thinkingBlocks.length > 0) {
        const len = thinkingBlocks.reduce(
          (acc, b) => acc + (b.thinking?.length ?? 0),
          0,
        );
        this.logger.log(
          `[Anthropic] thinking separado: ${thinkingBlocks.length} bloques, ${len} chars. NO se muestra al usuario.`,
        );
      }

      const assistantText = textBlocks
        .map((b) => b.text)
        .join('')
        .trim();

      this.logger.log(
        `[Anthropic] round=${round} assistantText.len=${assistantText.length} ` +
          `preview="${assistantText.slice(0, 120).replace(/\n/g, ' ')}"`,
      );

      // Sin tool calls → respuesta final
      if (
        toolUseBlocks.length === 0 ||
        response.stop_reason === 'end_turn' ||
        response.stop_reason === 'stop_sequence'
      ) {
        const fallback = collected.join('\n');
        let textToSave = assistantText || fallback;

        // ═══ DETECCIÓN DE BUCLE ═══
        // Si el modelo lleva N rondas produciendo textos muy parecidos
        // (≥80% idénticos) sin llamar tools de datos, está atorado
        // alucinando. Cortamos y devolvemos un mensaje útil en vez de
        // seguir iterando hasta agotar el round limit (que al final
        // termina aceptando la alucinación).
        recentDrafts.push(textToSave);
        if (recentDrafts.length > MAX_RECENT_DRAFTS) recentDrafts.shift();
        if (recentDrafts.length >= 3) {
          const last = recentDrafts[recentDrafts.length - 1];
          const similarCount = recentDrafts.filter(
            (d) => d.slice(0, 80) === last.slice(0, 80),
          ).length;
          if (similarCount >= 3) {
            // BUCLE detectado. Si el modelo YA llamó a una tool de datos
            // en esta conversación, está ignorando los datos reales de
            // la API y re-produciendo el texto alucinado. NO cortamos:
            // forzamos un último retry con un mensaje muy explícito de
            // "USA LOS DATOS QUE YA TIENES". Sólo cuando NO hay datos
            // disponibles (todas las alucinaciones vienen del vacío)
            // cortamos y devolvemos el mensaje genérico de error.
            if (dataToolCalledInConversation) {
              this.logger.warn(
                `[Anthropic] BUCLE_CON_DATOS (chat=${chatId}): ` +
                  `el modelo repite la misma respuesta ${similarCount} rondas ` +
                  `PERO YA tiene datos en el historial. Forzando retry con ` +
                  `mensaje fuerte de "USA LOS DATOS".`,
              );
              history.push({ role: 'assistant', content: response.content });
              history.push({
                role: 'user',
                content:
                  '[SISTEMA — ÚLTIMO INTENTO] Estás repitiendo textualmente la ' +
                  'misma respuesta que ya diste antes, IGNORANDO los datos ' +
                  'reales que la herramienta de datos te devolvió en rondas ' +
                  'anteriores. Esos datos están en tu historial como mensajes ' +
                  'de rol `user` con prefijo `[Resultado de herramienta...]`.\n\n' +
                  'Tienes que:\n' +
                  '  1. LEER los valores numéricos que la herramienta devolvió ' +
                  '(porcentajes, días, montos).\n' +
                  '  2. RESPONDER usando EXCLUSIVAMENTE esos valores, citándolos ' +
                  'explícitamente en tu respuesta (ej: "según los datos: días ' +
                  'denegados = 138, % denegado = 39.2%").\n' +
                  '  3. Si la herramienta devolvió un objeto agregado (no una ' +
                  'lista por hospital), EXPLÍCALO: "Esta herramienta devuelve ' +
                  'totales agregados para los hospitales filtrados; no desglosa ' +
                  'por hospital individual. Para ver el desglose por hospital ' +
                  'usa otra herramienta."\n\n' +
                  'PROHIBIDO: re-producir el mismo texto, inventar números, o ' +
                  'mencionar nombres de herramientas al usuario.',
              });
              forceToolChoice = undefined;
              continue;
            }
            this.logger.warn(
              `[Anthropic] BUCLE detectado (chat=${chatId}): ` +
                `el modelo repite la misma respuesta ${similarCount} rondas. Cortando.`,
            );
            const loopMsg =
              'Tuve un problema técnico al procesar tu consulta. ¿Puedes reformularla? ' +
              'Por ejemplo: "días denegados del Hospital San Lucas en octubre 2026".';
            await this.persistMessage(chatId, 'assistant', loopMsg);
            return loopMsg;
          }
        }

        // ═══ VALIDACIÓN ANTI-ALUCINACIÓN ═══
        // Verifica que las cifras/IDs/nombres del draft provengan de los
        // resultados de herramientas llamadas en este turno. Si NO se
        // llamó ninguna tool de datos y el draft contiene cifras, o si
        // las cifras no aparecen en los resultados, RECHAZAMOS la
        // respuesta, inyectamos una corrección en el historial y dejamos
        // que el modelo lo intente de nuevo. Esto evita que el modelo
        // invente IDs (como "1123 — Plan B") cuando debería estar
        // llamando a `obtener_planes_disponibles`.
        if (textToSave) {
          // ── Detector: mismatch de porcentaje vs. término del usuario ──
          // Si el usuario pidió un porcentaje específico ("% sobre LOS",
          // "% aprobados", "% de denegados", "% de pérdida", "% de
          // recuperación", "% facturado") y el bot está usando un campo
          // de porcentaje con un nombre DIFERENTE al que pidió el usuario,
          // RECHAZAMOS. Esto evita que el bot devuelva "porcentaje
          // facturado" cuando se pidió "porcentaje de aprobados", o
          // "porcentaje de denegación" cuando se pidió "porcentaje sobre
          // LOS".
          if (round < 4 && userMessageText) {
            const um = userMessageText.toLowerCase();
            const tm = textToSave.toLowerCase();
            const hasPercent = /\d[\d.,]*\s?%/.test(textToSave);
            if (hasPercent) {
              const checks: Array<{
                userPattern: RegExp;
                requiredInResponse: RegExp;
                label: string;
                fieldHint: string;
              }> = [
                {
                  userPattern: /\b(sobre|segun|según|en)\s+los\b/i,
                  requiredInResponse: /\b(los|length of stay)\b/i,
                  label: 'sobre LOS',
                  fieldHint: 'porcentajeSobreLos',
                },
                {
                  userPattern: /\b(aprobad[oa]s?|tasa de aprobaci[oó]n|% de aprobaci[oó]n|porcentaje de aprobaci[oó]n)\b/i,
                  requiredInResponse: /\b(aprobad[oa]s?|aprobaci[oó]n)\b/i,
                  label: 'aprobados',
                  fieldHint: 'porcentajeAprobado',
                },
                {
                  userPattern: /\b(denegad[oa]s?)\b/i,
                  requiredInResponse: /\b(denegad[oa]s?|denegaci[oó]n)\b/i,
                  label: 'denegados',
                  fieldHint: 'porcentajeDenegado',
                },
                {
                  userPattern: /\b(p[eé]rdid[oa]s?|tasa de p[eé]rdida)\b/i,
                  requiredInResponse: /\b(p[eé]rdid[oa]s?|p[eé]rdida)\b/i,
                  label: 'perdida',
                  fieldHint: 'porcentajePerdida',
                },
                {
                  userPattern: /\b(recuperad[oa]s?|tasa de recuperaci[oó]n)\b/i,
                  requiredInResponse: /\b(recuperad[oa]s?|recuperaci[oó]n)\b/i,
                  label: 'recuperados',
                  fieldHint: 'porcentajeRecuperado',
                },
                {
                  userPattern: /\b(facturad[oa]s?|tasa de facturaci[oó]n)\b/i,
                  requiredInResponse: /\b(facturad[oa]s?|facturaci[oó]n)\b/i,
                  label: 'facturado',
                  fieldHint: 'porcentajeFacturado',
                },
              ];
              let mismatch: typeof checks[number] | null = null;
              for (const c of checks) {
                if (c.userPattern.test(um) && !c.requiredInResponse.test(tm)) {
                  mismatch = c;
                  break;
                }
              }
              if (mismatch) {
                this.logger.warn(
                  `[Anthropic] round=${round} PORCENTAJE_MISMATCH (chat=${chatId}): user asked for "${mismatch.label}" but response doesn't mention it. Rejecting.`,
                );
                history.push({ role: 'assistant', content: response.content });
                history.push({
                  role: 'user',
                  content:
                    `[SISTEMA] El usuario pidió específicamente el porcentaje de "${mismatch.label}" y tu respuesta NO menciona ese término. ` +
                    `Tu respuesta debe incluir exactamente "${mismatch.label}" (no otra métrica similar como "denegación", "facturado" o "pérdida" si el usuario no las pidió). ` +
                    `Lee la respuesta de la herramienta y muestra el campo que coincida con "${mismatch.label}" (p.ej. si la herramienta devuelve un campo con ese nombre, úsalo). ` +
                    `Si la herramienta NO devuelve ese campo, di literalmente: "Ese porcentaje específico no lo devuelve la herramienta con esos filtros; los porcentajes disponibles son [lista de los campos que sí trae]."`,
                });
                continue;
              }
            }
          }

          // ── Detector: PORCENTAJE SIN TOOL CALL ──
          // Si el usuario pidió un porcentaje (% aprobado, % denegado, % sobre
          // LOS, % de pérdida, % de recuperación, % facturado) y el bot
          // responde con un porcentaje SIN haber llamado a una tool de datos
          // en este turno, RECHAZAMOS. El bot está alucinando el porcentaje
          // desde datos viejos o inventándolo. Tiene que RE-LLAMAR la
          // herramienta de datos con los filtros actuales y mostrar el campo
          // exacto que la API devuelve.
          if (
            round < 4 &&
            userMessageText &&
            /\b(porcentaje|% |tasa de|qué porcentaje|cu[aá]l es el porcentaje)\b/i.test(
              userMessageText,
            ) &&
            /\d[\d.,]*\s?%/.test(textToSave) &&
            turnToolCalls.length === 0
          ) {
            this.logger.warn(
              `[Anthropic] round=${round} PORCENTAJE_SIN_TOOL (chat=${chatId}): ` +
                `user asked for percentage but model responded without tool call. ` +
                `preview="${textToSave.slice(0, 80)}"`,
            );
            history.push({ role: 'assistant', content: response.content });
            history.push({
              role: 'user',
              content:
                '[SISTEMA] Tu respuesta anterior fue rechazada. El usuario pidió un ' +
                'porcentaje (aprobados, denegados, sobre LOS, pérdida, recuperación, ' +
                'facturado, etc.) y tú respondiste con una cifra SIN haber llamado a ' +
                'ninguna herramienta de datos en este turno. Esa cifra es INVENTADA.\n\n' +
                'Tienes que EJECUTAR la herramienta de datos correspondiente con los ' +
                'filtros del usuario (año, hospital, plan, meses, loc) y mostrar el ' +
                'campo de porcentaje que la API devuelva. El campo exacto depende de ' +
                'lo que el usuario pidió:\n' +
                '  - "% aprobados" / "% de aprobación" → campo `porcentajeAprobado`\n' +
                '  - "% denegados" / "% de denegación" → campo `porcentajeDenegado`\n' +
                '  - "% sobre LOS" / "% según LOS" → campo `porcentajeSobreLos`\n' +
                '  - "% de pérdida" → campo `porcentajePerdida`\n' +
                '  - "% de recuperación" → campo `porcentajeRecuperado`\n' +
                '  - "% facturado" → campo `porcentajeFacturado`\n' +
                'Si la herramienta no devuelve ese campo exacto, di literalmente: ' +
                '"Ese porcentaje específico no lo devuelve la herramienta con esos ' +
                'filtros; los porcentajes disponibles son [lista]". NO INVENTES el valor.',
            });
            forceToolChoice = 'any';
            continue;
          }

          // ── Detector: anuncio de acción sin ejecución ──
          // El modelo a veces responde con frases como "Reintentando…",
          // "Vuelvo a consultar…", "Permíteme un momento…", "Dame un
          // momento" SIN haber llamado a una tool. Es un bucle sin salida:
          // el modelo se queda diciendo que va a actuar y nunca lo hace.
          // Cuando detectamos este patrón sin tool call, RECHAZAMOS la
          // respuesta, inyectamos una corrección muy explícita y forzamos
          // `tool_choice: 'any'` en el siguiente round para que el modelo
          // ESTÉ OBLIGADO a llamar a una tool antes de volver a hablar.
          const announceRe =
            /\b(reintent(ando|o(?:r)?)?|vuelvo a (intentar|consultar|llamar|hacer|mostrar)|perm[íi]teme|dame un momento|ahora (mismo )?(lo )?(consulto|llamo|veo)|dame un segundo|espera un momento|un momento por favor|aquí (va|está|tienes)|voy a (consultar|llamar|verificar|revisar|mostrar|proceder|reintentar|mapear|buscar)|procedo a|te (muestro|cuento|digo)|aquí te (muestro|cuento)|aqu[ií] va|el resultado|los resultados|llamando( (a(l)?|del?))? (la |el |los |las )?(cat[áa]logo|hospitales?|planes?|herramienta|tool|endpoint|consulta|api)|consultando( (a(l)?|del?))? (la |el |los |las )?(cat[áa]logo|hospitales?|planes?|herramienta|tool|endpoint|consulta|api)|ejecutando( (la|el|los|las))? (consulta|tool|llamada|herramienta)|iniciando (consulta|llamada)|obteniendo (datos|informaci[oó]n)|(no puedo|no puedo) ejecutar( la consulta| la herramienta)?|no tengo (en contexto|los?) (el|los?) (id|hosid|planid)|con (los|las|tus) filtros (de |de la )(consulta|pregunta|solicitud) anterior|usando (los|las) (mismos|anteriores) filtros)\b/i;
          if (
            announceRe.test(textToSave) &&
            turnToolCalls.length === 0 &&
            round < 4
          ) {
            this.logger.warn(
              `[Anthropic] round=${round} ANUNCIO_SIN_ACCION (chat=${chatId}): ` +
                `modelo anunció acción sin tool call. preview="${textToSave.slice(0, 80)}"`,
            );
            history.push({ role: 'assistant', content: response.content });
            history.push({
              role: 'user',
              content:
                '[SISTEMA] Tu respuesta anterior fue rechazada porque anunciaste una ' +
                'acción ("reintentando", "llamando al catálogo", "voy a…", ' +
                '"no puedo ejecutar la consulta", "no tengo en contexto los IDs", etc.) ' +
                'pero NO ejecutaste ninguna herramienta. Está prohibido anunciar.\n\n' +
                'Cuando el usuario menciona un hospital o plan por nombre, tienes que ' +
                'EJECUTAR inmediatamente la herramienta de catálogo (catálogo de ' +
                'hospitales o de planes) para mapear el nombre al identificador ' +
                'interno. Después, ejecuta la herramienta de datos con los ' +
                'identificadores correctos. Si ya tienes los identificadores, ejecuta ' +
                'directamente la herramienta de datos. En tu próxima respuesta, el ' +
                'primer elemento debe ser la llamada a la herramienta, no texto.',
            });
            forceToolChoice = 'any';
            continue;
          }

          const validation = containsUnverifiedClaims(
            textToSave,
            turnToolCalls,
            turnToolResults,
            turnToolStatuses,
            // Pasamos también los tool_results previos del historial para que
            // el validador no rechace al modelo cuando REUSA datos que ya
            // obtuvo en turnos anteriores (p.ej. listas de catálogos).
            extractHistoricalToolResults(history),
          );
          if (validation.suspicious && round < 4) {
            // (deja la lógica de abajo con el mensaje de alucinación)

            this.logger.warn(
              `[Anthropic] round=${round} RECHAZADO (chat=${chatId}): ` +
                validation.reasons.join(' | '),
            );
            history.push({ role: 'assistant', content: response.content });
            history.push({
              role: 'user',
              content:
                '[SISTEMA] Tu respuesta anterior fue rechazada porque contenía ' +
                'cifras o datos concretos que NO provienen de una herramienta de ' +
                'datos en este turno. Esos números son INVENTADOS.\n\n' +
                'El usuario hace una pregunta concreta (ranking de planes, días ' +
                'denegados, facturado, etc.). Para responder con datos reales, ' +
                'tienes que EJECUTAR las herramientas necesarias. Si el usuario ' +
                'menciona un hospital o plan por nombre, primero ejecuta la ' +
                'herramienta de catálogo correspondiente para mapear el nombre al ' +
                'identificador. Después, ejecuta la herramienta de datos que ' +
                'corresponda al indicador. En tu próxima respuesta, el primer ' +
                'elemento debe ser la llamada a la herramienta, no texto.',
            });
            // Forzamos al modelo a llamar a una tool en el siguiente round.
            // Sin esto, el modelo puede volver a inventar texto.
            forceToolChoice = 'any';
            continue;
          }

          // ═══ RECHAZO POR "RENDICIÓN" EN RONDAS POSTERIORES ═══
          // Si el modelo ya fue rechazado al menos una vez (round >= 1) y
          // aún así NO llamó a una herramienta de datos, y su respuesta es
          // una "pregunta vaga al usuario" (no saludo, no respuesta
          // concreta), RECHAZAMOS otra vez. Esto evita que el modelo se
          // rinda con "¿de qué hospital/plan/año quieres?" cuando ya fue
          // corregido explícitamente. El bot debe seguir intentando llamar
          // a la tool hasta agotar el round limit.
          if (
            round >= 1 &&
            turnToolCalls.length === 0 &&
            turnToolResults.length === 0 &&
            // No es una respuesta final de "no tengo datos" (eso se filtra
            // por sanitización más abajo). Aquí solo capturamos "preguntas
            // vagas" que parecen rinden al modelo.
            /\b(para (responder|consultar|eso|ello|esto) (correctamente|necesito|te pido)|¿?(de|cu[áa]l|cu[áa]les|qu[ée])\s+(hospital(es)?|plan(es)?|a[ñn]o|mes|periodo|indicador|filtro)|d[ií]game? (el|los) (hospital|plan|a[ñn]o|mes|indicador|filtro)|qu[ée] (hospital|plan|a[ñn]o|mes|indicador|filtro) (quieres|deseas|necesitas))\b/i.test(
              textToSave,
            )
          ) {
            this.logger.warn(
              `[Anthropic] round=${round} RENDICION (chat=${chatId}): ` +
                `modelo no llamó tool y pidió filtros ya discutidos. preview="${textToSave.slice(0, 80)}"`,
            );
            history.push({ role: 'assistant', content: response.content });
            history.push({
              role: 'user',
              content:
                '[SISTEMA] Tu respuesta anterior fue rechazada porque pediste ' +
                'filtros que el usuario YA DIJO o que ya están en el contexto. ' +
                'No pidas de nuevo el hospital, plan, año o mes si ya fueron ' +
                'mencionados. Tampoco pidas "todos los planes" o "algún plan en ' +
                'específico": cuando el usuario pide un ranking, debes llamar ' +
                'a la herramienta de catálogo de planes, obtener todos los ' +
                'identificadores y luego llamar a la herramienta de datos con ' +
                'todos los identificadores. En tu próxima respuesta, ejecuta ' +
                'directamente la herramienta correspondiente sin pedir filtros ' +
                'de nuevo.',
            });
            forceToolChoice = 'any';
            continue;
          }

          // ═══ RECHAZO POR FILTROS DESACTUALIZADOS ═══
          // Si el modelo no llamó a una tool en este turno, podría estar
          // reusando datos del historial que ya NO aplican porque el
          // usuario cambió un filtro (periodo, hospital, plan). Detectamos
          // este caso comparando los filtros del último tool_call con el
          // mensaje actual del usuario. Si no coinciden, RECHAZAMOS y
          // forzamos una re-llamada a la tool.
          if (round >= 1 && turnToolCalls.length === 0) {
            const lastDataToolInput = [
              'consultar_resumen_financiero_hospitales',
              'consultar_montos_por_estado',
              'consultar_determinacion_adversa_mas_frecuente',
              'consultar_concepto_mas_dias_denegados',
              'consultar_determinacion_adversa_monto',
            ]
              .map((tn) => extractLastToolInput(history, tn))
              .find((x) => x !== null && x !== undefined) ?? null;
            const mismatch = detectFilterMismatch(
              userMessageText,
              lastDataToolInput,
            );
            if (mismatch && round < 4) {
              this.logger.warn(
                `[Anthropic] round=${round} FILTROS_DESACTUALIZADOS (chat=${chatId}): ${mismatch}`,
              );
              history.push({ role: 'assistant', content: response.content });
              history.push({
                role: 'user',
                content:
                  '[SISTEMA — FILTROS DESACTUALIZADOS] Tu respuesta anterior reutilizó ' +
                  'datos de una consulta anterior con filtros DIFERENTES a los que el ' +
                  'usuario pide ahora.\n\n' +
                  'PROBLEMA: ' +
                  mismatch +
                  '\n\n' +
                  'ACCIÓN OBLIGATORIA: re-llama a la herramienta de datos con los ' +
                  'filtros actualizados que corresponden al mensaje actual del usuario. ' +
                  'NO reuses el resultado anterior.',
              });
              forceToolChoice = 'any';
              continue;
            }
          }

          // ═══ RECHAZO POR "SIN DATOS" SIN LLAMAR A TOOL DE DATOS ═══
          // Si el bot responde con "sin registros" / "no hay datos" /
          // "sin información" / "0 resultados" pero NO llamó a ninguna
          // herramienta de datos en este turno, está ALUCINANDO ausencia
          // de datos. La única forma válida de saber si hay datos es
          // llamar a la herramienta. RECHAZAMOS y forzamos la llamada.
          const sinDatosRe =
            /\b(sin registros?|sin datos|no hay datos|no hay registros|no se encontraron|0 resultados?|sin resultados?|sin informaci[oó]n|informaci[oó]n no disponible|sin montos?|sin d[ií]as? (denegados?|aprobados?|recuperados?))\b/i;
          const llamoDataTool = turnToolCalls.some((name) =>
            [
              'consultar_resumen_financiero_hospitales',
              'consultar_montos_por_estado',
              'consultar_determinacion_adversa_mas_frecuente',
              'consultar_concepto_mas_dias_denegados',
              'consultar_determinacion_adversa_monto',
            ].includes(name),
          );
          if (
            sinDatosRe.test(textToSave) &&
            !llamoDataTool &&
            round < 4
          ) {
            this.logger.warn(
              `[Anthropic] round=${round} SIN_DATOS_SIN_TOOL (chat=${chatId}): ` +
                `modelo dijo "sin datos" sin llamar a tool de datos. preview="${textToSave.slice(0, 100)}"`,
            );
            history.push({ role: 'assistant', content: response.content });
            history.push({
              role: 'user',
              content:
                '[SISTEMA] Tu respuesta anterior fue rechazada porque dijiste ' +
                '"sin registros" / "no hay datos" / "sin información" SIN HABER ' +
                'LLAMADO a una herramienta de datos en este turno. Eso es ' +
                'alucinar ausencia de datos.\n\n' +
                'La única forma válida de saber si hay datos es ejecutar la ' +
                'herramienta de datos correspondiente (la de montos, la de ' +
                'resumen financiero, la de determinación o la de conceptos) y ' +
                'recibir el resultado real de la API. Si ya ejecutaste la ' +
                'herramienta de catálogo en este turno pero no la de datos, ' +
                'ahora tienes que ejecutar la de datos con los identificadores ' +
                'obtenidos. En tu próxima respuesta, ejecuta la herramienta de ' +
                'datos correspondiente. NO respondas con "sin registros" hasta ' +
                'que la API te devuelva un resultado vacío real.',
            });
            forceToolChoice = 'any';
            continue;
          }

          // Sanitizamos ANTES de persistir y de devolver al usuario, así
          // no acumulamos más respuestas con bloques <pre>, frases hechas
          // o tasas no pedidas en la BD, y el cliente recibe el texto
          // ya limpio.
          textToSave = sanitizeAssistantText(textToSave);
          if (!textToSave && round < 9) {
            // La respuesta quedó vacía tras sanitizar: contenía SOLO
            // frases prohibidas (p. ej. "indícame el ID del hospital"
            // o "¿de qué año?"). Forzamos regeneración inyectando
            // una corrección del sistema, igual que cuando el validador
            // de cifras rechaza.
            this.logger.warn(
              `[Anthropic] round=${round} RECHAZADO (chat=${chatId}): ` +
                `respuesta vacía tras sanitizar (solo contenía frases prohibidas).`,
            );
            history.push({ role: 'assistant', content: response.content });
            history.push({
              role: 'user',
              content:
                '[SISTEMA] Tu respuesta anterior contenía solo frases prohibidas ' +
                '(pedir IDs, pedir el año, "indícame el ID", excusas de "no ' +
                'tengo", "no dispongo", "necesitaría un hospital", etc.) y tras ' +
                'limpiarla quedó vacía. NO repitas esas frases.\n\n' +
                'Cuando el usuario pregunta algo concreto, tienes que llamar a ' +
                'la herramienta tú mismo. Si la consulta tiene hospital o plan ' +
                'por nombre, primero llamas al catálogo correspondiente para ' +
                'obtener el identificador, y luego llamas a la herramienta de ' +
                'datos. Si la consulta ya está completa, llamas directamente a ' +
                'la herramienta de datos. En tu próxima respuesta, ejecuta la ' +
                'herramienta sin pedir filtros que el usuario ya dio, sin ' +
                'pedir IDs, sin preguntar el año (usa 2026 por defecto), y ' +
                'sin excusas.',
            });
            forceToolChoice = 'any';
            continue;
          }
          if (textToSave) {
            // Si `collected` ya tiene entries (de un tool_use previo),
            // sobreescribimos la última con el texto final del assistant.
            // Si `collected` está vacío (respuesta directa sin tools),
            // hay que hacer PUSH — usar `arr[-1] = x` no agrega nada en JS.
            if (collected.length > 0) {
              collected[collected.length - 1] = textToSave;
            } else {
              collected.push(textToSave);
            }
            history.push({ role: 'assistant', content: response.content });
            await this.persistMessage(chatId, 'assistant', textToSave);
          } else {
            this.logger.warn(
              `Respuesta del modelo quedó vacía tras sanitizar para chat ${chatId}.`,
            );
          }
        } else {
          this.logger.warn(
            `Respuesta del modelo quedó vacía para chat ${chatId}.`,
          );
        }
        return collected.join('\n');
      }

      // Con tool calls → guardar el turno del asistente (con tool_use) y ejecutar
      history.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUseBlocks) {
        const args = (tu.input ?? {}) as Record<string, unknown>;
        const toolStart = Date.now();
        this.logger.log(
          `[DEBUG] >>> TOOL_CALL name=${tu.name} id=${tu.id} input=${JSON.stringify(args)}`,
        );

        // ═══ RECHAZO POR FILTROS INVENTADOS ═══
        // Si el bot llama a una tool de DATOS con filtros DIFERENTES al
        // último tool_call del mismo tipo, y el usuario NO mencionó ningún
        // cambio en su mensaje actual, RECHAZAMOS la llamada y forzamos
        // una re-llamada con los filtros de la conversación previa.
        // Esto evita que el bot "inente" idHospitales o idPlanes sin que
        // el usuario lo pida.
        const DATA_TOOLS = new Set([
          'consultar_resumen_financiero_hospitales',
          'consultar_montos_por_estado',
          'consultar_determinacion_adversa_mas_frecuente',
          'consultar_concepto_mas_dias_denegados',
          'consultar_determinacion_adversa_monto',
        ]);
        if (DATA_TOOLS.has(tu.name) && round < 4) {
          dataToolCalledInConversation = true;
          const lastInput = extractLastToolInput(history, tu.name);
          if (lastInput) {
            const newHospitals: number[] = Array.isArray(args.idHospitales)
              ? (args.idHospitales as number[])
              : [];
            const lastHospitals: number[] = Array.isArray(lastInput.idHospitales)
              ? (lastInput.idHospitales as number[])
              : [];
            const newPlanes: number[] = Array.isArray(args.idPlanes)
              ? (args.idPlanes as number[])
              : [];
            const lastPlanes: number[] = Array.isArray(lastInput.idPlanes)
              ? (lastInput.idPlanes as number[])
              : [];

            const hospitalChanged =
              newHospitals.length !== lastHospitals.length ||
              !newHospitals.every((h) => lastHospitals.includes(h));
            const planChanged =
              newPlanes.length !== lastPlanes.length ||
              !newPlanes.every((p) => lastPlanes.includes(p));

            // Verificamos si el usuario mencionó el cambio en su mensaje.
            // Si no, rechazamos.
            const userMsgLower = userMessageText.toLowerCase();
            const userMentionsHospitalChange =
              /\b(todos los hospitales|cada hospital|los dem[aá]s|los otros)\b/.test(
                userMsgLower,
              ) ||
              /\b(solo|solamente|[\u00fanicamente])\b.*\b(hospital|hospitales)\b/.test(
                userMsgLower,
              );
            const userMentionsPlanChange =
              /\b(ese|el mismo|este|el plan|mismo plan|distinto plan|otro plan|cambiar plan)\b/.test(
                userMsgLower,
              );

            if (hospitalChanged && !userMentionsHospitalChange) {
              this.logger.warn(
                `[Anthropic] round=${round} FILTROS_INVENTADOS_HOSPITAL (chat=${chatId}): tool=${tu.name} last=[${lastHospitals.join(',')}] new=[${newHospitals.join(',')}]`,
              );
              toolResults.push({
                type: 'tool_result',
                tool_use_id: tu.id,
                is_error: true,
                content: JSON.stringify({
                  _sistema: 'FILTROS_INVENTADOS',
                  error:
                    'INVENTASTE idHospitales. El usuario NO pidió cambiar el filtro de hospitales en este turno. La última consulta de esta misma herramienta usó idHospitales: [' +
                    lastHospitals.join(', ') +
                    ']. DEBES re-llamar esta herramienta con ESE MISMO idHospitales. NO inventes otros IDs.',
                }),
              });
              continue;
            }
            if (planChanged && !userMentionsPlanChange) {
              this.logger.warn(
                `[Anthropic] round=${round} FILTROS_INVENTADOS_PLAN (chat=${chatId}): tool=${tu.name} last=[${lastPlanes.join(',')}] new=[${newPlanes.join(',')}]`,
              );
              toolResults.push({
                type: 'tool_result',
                tool_use_id: tu.id,
                is_error: true,
                content: JSON.stringify({
                  _sistema: 'FILTROS_INVENTADOS',
                  error:
                    'INVENTASTE idPlanes. El usuario NO pidió cambiar el filtro de planes en este turno. La última consulta de esta misma herramienta usó idPlanes: [' +
                    lastPlanes.join(', ') +
                    ']. DEBES re-llamar esta herramienta con ESE MISMO idPlanes. NO inventes otros IDs.',
                }),
              });
              continue;
            }

            // ═══ RECHAZO POR IDPLANCES_INCOMPLETO ═══
            // Si el bot llama a una tool de DATOS con `idPlanes` con un
            // subconjunto pequeño (1, 2 o 3 planes) y el usuario pidió
            // "todos los planes" / "el plan que más facturó" / "ranking" /
            // "qué plan" sin mencionar un plan específico, RECHAZAMOS.
            // El bot debe llamar a `obtener_planes_disponibles` primero y
            // luego pasar TODOS los IDs a la herramienta de datos.
            const userMsgLowerPlan = userMessageText.toLowerCase();
            const userWantsAllPlans =
              /\b(todos los planes|el plan(es)? (que m[áa]s|con m[áa]s)|qu[ée] plan|qu[ée] planes|plan(es)? (m[áa]s|principal)|ranking|cu[áa]l(es)? (es|son) (el|los) plan(es)?|mejor plan|plan ganador|plan top|top de planes)\b/.test(
                userMsgLowerPlan,
              );
            const userMentionedSpecificPlan =
              /\b(plan\s+(MAPFRE|HUMANA|IMC|ACAA|AUXILIO|TRIPLE|BLUE|FIRST|COMPREHENSIVE|MMM|TRIPLE S|MMM ADVANTAGE|TRIPLE S VITAL|TRIPLE S ADVANTAGE|TRIPLE S COMERCIAL|TRIPLE S BASICO|TRIPLE S SELECTO|TRIPLE S PLATINO|TRIPLE S ORO|TRIPLE S PLATA|HUMANA ADVANTAGE|HUMANA PREV|HUMANA CHOICE))\b/i.test(
                userMessageText,
              ) ||
              /\b(id\s*plan|plan\s*id)\b/i.test(userMsgLowerPlan);
            if (
              userWantsAllPlans &&
              !userMentionedSpecificPlan &&
              newPlanes.length > 0 &&
              newPlanes.length < 4 &&
              tu.name === 'consultar_montos_por_estado'
            ) {
              this.logger.warn(
                `[Anthropic] round=${round} IDPLANCES_INCOMPLETO (chat=${chatId}): tool=${tu.name} user pidió todos los planes pero solo envió [${newPlanes.join(',')}].`,
              );
              toolResults.push({
                type: 'tool_result',
                tool_use_id: tu.id,
                is_error: true,
                content: JSON.stringify({
                  _sistema: 'IDPLANCES_INCOMPLETO',
                  error:
                    'ENVISTE SOLO ' +
                    newPlanes.length +
                    ' PLANES. El usuario pidió "todos los planes" / "el plan que más facturó" / "ranking". NO puedes hacer ranking con un subconjunto.\n\n' +
                    'FLUJO CORRECTO:\n' +
                    '1. PRIMER tool_use = `obtener_planes_disponibles` con `input = {}` para obtener TODOS los IDs.\n' +
                    '2. SEGUNDO tool_use = `consultar_montos_por_estado` con `idPlanes: [TODOS_LOS_IDS]` (TODOS, no una selección).\n' +
                    '3. La API devolverá `porHospital[].planes[]` con cada plan y su `totalFacturado`. Identifica el de mayor monto.\n\n' +
                    'ACCIÓN OBLIGATORIA: llama primero a `obtener_planes_disponibles` para resolver TODOS los IDs, luego re-llama a `consultar_montos_por_estado` con el array COMPLETO de `idPlanes`.',
                }),
              });
              continue;
            }
          }
        }

        const resultStr = await executeTool(tu.name, args, chatId, this.db);
        const toolElapsed = Date.now() - toolStart;

        // Status rápido para depuración
        let quickStatus = 'ok';
        try {
          const j = JSON.parse(resultStr) as { success?: boolean };
          if (j?.success === false) quickStatus = 'error';
        } catch {
          if (/error|exception|fail/i.test(resultStr.slice(0, 200))) {
            quickStatus = 'error';
          }
        }

        this.logger.log(
          `[DEBUG] <<< TOOL_RESULT name=${tu.name} ${toolElapsed}ms status=${quickStatus} ` +
            `result.len=${resultStr.length} preview="${resultStr.slice(0, 300).replace(/\n/g, ' ')}"`,
        );

        // Tracking acumulado para `containsUnverifiedClaims`. Necesitamos
        // registrar nombre + resultado crudo + status (ok/empty/error) de
        // CADA tool llamada, para que el validador pueda comparar las
        // cifras del draft final contra los valores reales.
        turnToolCalls.push(tu.name);
        turnToolResults.push(resultStr);
        let toolStatus: ToolStatus = 'ok';
        try {
          const parsed = JSON.parse(resultStr) as {
            success?: boolean;
            error?: string;
            message?: string;
          };
          if (parsed.success === false) toolStatus = 'error';
          else if (
            Array.isArray((parsed as { resultados?: unknown[] }).resultados) &&
            (parsed as { resultados: unknown[] }).resultados.length === 0
          ) {
            toolStatus = 'empty';
          }
        } catch {
          /* resultStr no es JSON — lo tratamos como ok si no es error */
          if (/error|exception|fail/i.test(resultStr.slice(0, 200))) {
            toolStatus = 'error';
          }
        }
        turnToolStatuses.push(toolStatus);

        // Capturar formatted_html si la herramienta lo devuelve
        try {
          const parsed = JSON.parse(resultStr) as {
            success?: boolean;
            formatted_html?: string;
          };
          if (parsed.success && parsed.formatted_html) {
            collected.push(parsed.formatted_html);
          }
        } catch {
          /* no es JSON */
        }

        // Strip formatted_html antes de devolver al modelo (ya capturado)
        let resultForModel = resultStr;
        try {
          const parsed = JSON.parse(resultStr) as Record<string, unknown>;
          if (parsed.formatted_html) {
            delete parsed.formatted_html;
            resultForModel = JSON.stringify(parsed);
          }
        } catch {
          /* no es JSON */
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: resultForModel,
        });
      }

      // En Anthropic, los tool_results van como un mensaje `user`
      history.push({ role: 'user', content: toolResults });
    }

    // Resumen de depuración al final del turno: qué tools se llamaron (o NO)
    this.logger.log(
      `[DEBUG] FIN chat=${chatId} tools_llamadas=[${turnToolCalls.join(', ') || 'NINGUNA'}] ` +
        `status=[${turnToolStatuses.join(', ') || '-'}]`,
    );
    if (turnToolCalls.length === 0) {
      this.logger.warn(
        `[DEBUG] chat=${chatId} ⚠️  el modelo NO llamó ninguna tool de datos en este turno`,
      );
    }

    return collected.join('\n');
  }

  /** Limpia historial corrupto y reintenta con historial vacío */
  private async retryWithFreshHistory(
    chatId: number,
    userText: string,
  ): Promise<string> {
    this.logger.warn(
      `Historial corrupto para chat ${chatId}. Limpiando y reintentando...`,
    );
    conversations.delete(chatId);
    try {
      await this.db.query('DELETE FROM historial_mensajes WHERE chat_id = $1', [
        chatId,
      ]);
    } catch (e) {
      this.logger.error(`Error cleaning history: ${e}`);
    }

    const systemPrompt = await buildSystem(chatId, this.db);
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOLS,
      messages: [{ role: 'user', content: userText }],
    });

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    const finalText = textBlocks
      .map((b) => b.text)
      .join('')
      .trim();

    if (finalText) {
      // Sanitizamos la respuesta del assistant antes de devolverla al
      // usuario y antes de guardarla en BD.
      const sanitized = sanitizeAssistantText(finalText);
      if (sanitized) {
        conversations.set(chatId, [
          { role: 'user', content: userText },
          { role: 'assistant', content: response.content },
        ]);
        await this.persistMessage(chatId, 'user', userText);
        await this.persistMessage(chatId, 'assistant', sanitized);
        return sanitized;
      }
    }
    return finalText;
  }

  /**
   * Punto de entrada público: procesa un mensaje y devuelve la respuesta del agente.
   */
  async chat(chatId: number, userText: string): Promise<string> {
    try {
      const { rows } = await this.db.query(
        `SELECT TOP 1 1
         FROM chats_pausados
         WHERE chat_id = $1 AND reanudado_en IS NULL`,
        [chatId],
      );

      if ((rows as unknown[]).length > 0) {
        // Chat en modo humano: guardar el mensaje del usuario silenciosamente
        // y notificar al panel admin por WebSocket. La IA no responde.
        await this.persistMessage(chatId, 'user', userText);

        // Sincronizar historial en memoria para cuando se reanude
        try {
          const history = await this.loadHistoryIfEmpty(chatId);
          history.push({ role: 'user', content: userText });
          if (history.length > 50) history.splice(0, history.length - 50);
        } catch (e) {
          this.logger.warn(`No se pudo sincronizar historial: ${e}`);
        }

        // Notificar al panel admin en tiempo real (best-effort)
        try {
          this.chatGateway?.emitUserMessage?.(chatId, {
            chat_id: chatId,
            role: 'user',
            content: userText,
          });
        } catch (e) {
          this.logger.warn(`No se pudo emitir WebSocket user-message: ${e}`);
        }

        this.logger.log(
          `Chat ${chatId} pausado. Mensaje del usuario guardado.`,
        );
        return '';
      }

      return await this.runAgentCore(chatId, userText);
    } catch (e) {
      const errStr = String(e);
      if (errStr.includes('valid list') || errStr.includes('400')) {
        try {
          return await this.retryWithFreshHistory(chatId, userText);
        } catch (retryErr) {
          this.logger.error(`Retry failed: ${retryErr}`);
          throw new Error(
            'Ocurrió un error procesando tu mensaje. Por favor intenta de nuevo.',
          );
        }
      }
      this.logger.error(`Agent error: ${e}`);
      throw e;
    }
  }
}

/**
 * Extrae los strings de contenido de TODOS los `tool_result` blocks presentes
 * en el historial de la conversación. Se usa para que el validador
 * `containsUnverifiedClaims` acepte como "verificadas" las cifras que el
 * modelo reusa de turnos anteriores (p.ej. listas de catálogos cacheadas).
 *
 * Soporta los dos formatos que Anthropic acepta:
 *  - `content: string` (texto plano)
 *  - `content: ContentBlock[]` (puede contener bloques `text`)
 */
export function extractHistoricalToolResults(
  history: Anthropic.Messages.MessageParam[],
): string[] {
  const out: string[] = [];
  for (const msg of history) {
    if (msg.role !== 'user') continue;
    const content = msg.content;
    if (typeof content === 'string') {
      out.push(content);
      continue;
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        const b = block as { type?: string; content?: unknown };
        if (b.type === 'tool_result') {
          const c = b.content;
          if (typeof c === 'string') {
            out.push(c);
          } else if (Array.isArray(c)) {
            for (const sub of c) {
              const sb = sub as { type?: string; text?: string };
              if (sb.type === 'text' && typeof sb.text === 'string') {
                out.push(sb.text);
              }
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * Extrae el ÚLTIMO tool_use con input de un tool_name específico del
 * historial. Devuelve el `input` parseado o `null` si no hay.
 *
 * Sirve para detectar si el bot está reusando datos viejos cuando el
 * usuario cambió filtros. Comparamos el último tool_call con los filtros
 * que el usuario pide en su mensaje actual.
 */
export function extractLastToolInput(
  history: Anthropic.Messages.MessageParam[],
  toolName: string,
): Record<string, unknown> | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== 'assistant') continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const b = block as {
        type?: string;
        name?: string;
        input?: unknown;
      };
      if (b.type === 'tool_use' && b.name === toolName) {
        return (b.input as Record<string, unknown>) ?? null;
      }
    }
  }
  return null;
}

/**
 * Compara los filtros del último tool_call con el mensaje actual del
 * usuario. Si detecta que el usuario pidió un rango/periodo/hospital
 * diferente al que usó la tool, devuelve un mensaje de validación.
 * Devuelve `null` si los filtros son consistentes o no se puede
 * determinar.
 *
 * Heurística:
 *   - Si el último tool_call tiene `meses: [10]` (solo octubre) y el
 *     usuario menciona un rango "marzo a octubre" / "entre X y Y" /
 *     varios meses → INCONSISTENTE.
 *   - Si el último tool_call tiene `idHospitales: [6]` y el usuario
 *     dice "todos los hospitales" o un nombre diferente → INCONSISTENTE.
 *   - Si el último tool_call tiene `anio: 2025` y el usuario dice
 *     "2026" → INCONSISTENTE.
 */
export function detectFilterMismatch(
  userMessage: string,
  lastInput: Record<string, unknown> | null,
): string | null {
  if (!lastInput) return null;
  const lastMeses: number[] = Array.isArray(lastInput.meses)
    ? (lastInput.meses as number[])
    : [];
  const lastAnio = typeof lastInput.anio === 'number' ? lastInput.anio : null;
  const lastHospitals: number[] = Array.isArray(lastInput.idHospitales)
    ? (lastInput.idHospitales as number[])
    : [];

  const msg = userMessage.toLowerCase();

  // Detectar mención de rango de meses en el mensaje del usuario.
  // Patrones: "entre marzo y octubre", "de marzo a octubre",
  // "marzo a octubre", "desde marzo", "hasta octubre".
  const monthNames = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];
  const monthToNum: Record<string, number> = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
  };
  const mentionedMonths: number[] = [];
  for (const m of monthNames) {
    if (msg.includes(m)) {
      mentionedMonths.push(monthToNum[m]);
    }
  }
  // Detectar rangos "entre X y Y", "de X a Y", "X a Y", "desde X hasta Y".
  if (
    /\b(entre|de|desde)\s+\w+\s+(y|a|hasta)\s+\w+/.test(msg) &&
    mentionedMonths.length >= 2
  ) {
    const sorted = [...mentionedMonths].sort((a, b) => a - b);
    const minMonth = sorted[0];
    const maxMonth = sorted[sorted.length - 1];
    const expected = Array.from(
      { length: maxMonth - minMonth + 1 },
      (_, i) => minMonth + i,
    );
    if (
      lastMeses.length !== expected.length ||
      !expected.every((m) => lastMeses.includes(m))
    ) {
      return `El usuario pidió un rango de meses (${minMonth}–${maxMonth}) pero la última consulta usó meses: [${lastMeses.join(', ')}]. DEBES re-llamar la herramienta con meses: [${expected.join(', ')}].`;
    }
  } else if (mentionedMonths.length > 0 && lastMeses.length > 0) {
    // El usuario mencionó un mes específico, ¿coincide con el último?
    const mentioned = mentionedMonths[0];
    if (lastMeses.length === 1 && lastMeses[0] !== mentioned) {
      return `El usuario pidió el mes ${mentioned} pero la última consulta usó meses: [${lastMeses.join(', ')}]. DEBES re-llamar la herramienta con meses: [${mentioned}].`;
    }
  }

  // Detectar mención de año.
  const yearMatch = msg.match(/\b(20\d{2})\b/);
  if (yearMatch && lastAnio && parseInt(yearMatch[1]) !== lastAnio) {
    return `El usuario pidió el año ${yearMatch[1]} pero la última consulta usó anio: ${lastAnio}. DEBES re-llamar la herramienta con anio: ${parseInt(yearMatch[1])}.`;
  }

  // Detectar "todos los hospitales" cuando la última consulta tenía uno.
  if (
    /\b(todos los hospitales|los dem[aá]s hospitales|los otros hospitales)\b/.test(
      msg,
    ) &&
    lastHospitals.length === 1
  ) {
    return `El usuario pidió "todos los hospitales" pero la última consulta usó idHospitales: [${lastHospitals.join(', ')}]. DEBES re-llamar la herramienta sin filtro de idHospitales (o con todos los del catálogo).`;
  }

  // Detectar mención de plan por nombre o "el mismo plan" / "ese plan" cuando
  // el último tool_call tenía un plan diferente. Esto evita que el bot cambie
  // el plan sin que el usuario lo pida explícitamente.
  const lastPlanes: number[] = Array.isArray(lastInput.idPlanes)
    ? (lastInput.idPlanes as number[])
    : [];
  const planRefPattern =
    /\b(ese|el mismo|este|el plan|el mismo plan|mismo plan)\b/i;
  if (planRefPattern.test(msg) && lastPlanes.length > 0) {
    return `El usuario hizo referencia al MISMO plan (${lastPlanes.join(', ')}) pero la última consulta usó idPlanes: [${lastPlanes.join(', ')}]. DEBES re-llamar la herramienta con el MISMO idPlanes: [${lastPlanes.join(', ')}].`;
  }

  return null;
}
