// Carga la base de conocimiento oficial de Retina Care (tabla
// `conocimiento_especifico`) con las preguntas frecuentes sobre síntomas y
// enfermedades de retina.
//
// Uso:  npx ts-node scripts/seed-conocimiento-retina.ts
//       node -r ts-node/register scripts/seed-conocimiento-retina.ts
//
// Es idempotente: si la pregunta ya existe, NO la duplica (solo actualiza la
// respuesta si cambió). Se puede volver a ejecutar en cualquier momento.
//
// Las respuestas son material educativo general. NO substituyen la
// evaluación del retinólogo: el asistente virtual debe derivar al personal
// humano y solo usar estos textos como información general.

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface Entrada {
  pregunta: string;
  respuesta: string;
}

const ENTRADAS: Entrada[] = [
  // ── Síntomas visuales ────────────────────────────────────────────────
  {
    pregunta: '¿Qué significa ver puntos negros flotantes en la visión?',
    respuesta:
      'Los puntos negros flotantes, conocidos como miodesopsias, son pequeñas manchas, hilos o sombras que parecen desplazarse al mover los ojos. Suelen deberse a cambios en el humor vítreo. Si aparecen de repente, aumentan en cantidad o vienen con destellos de luz o una sombra en la visión, pueden indicar un desgarro o desprendimiento de retina y requieren evaluación urgente el mismo día.',
  },
  {
    pregunta: '¿Dónde se encuentran ubicados los puntos negros flotantes?',
    respuesta:
      'Los puntos negros flotantes (miodesopsias) se encuentran dentro del ojo, en el humor vítreo, que es la sustancia gelatinosa que llena el ojo. Por eso los ve como manchas, hilos o sombras que se mueven cuando mueve los ojos. Ubicarlos anatómicamente es normal y en sí mismo no es una emergencia. Lo importante es cómo aparecieron: si los notó de repente, si han aumentado en cantidad o si vienen con destellos de luz o una sombra o cortina en la visión, eso sí es una urgencia y debe acudir a urgencias o llamar al 9-1-1 de inmediato. Si los ha tenido desde hace tiempo y no han cambiado, se puede agendar una evaluación de retina con nuestro personal.',
  },
  {
    pregunta: '¿Son una urgencia los puntos negros flotantes?',
    respuesta:
      'Depende de cómo aparecieron. Los puntos negros flotantes que se han mantenido iguales por mucho tiempo y sin otros síntomas suelen ser benignos y se revisan en consulta programada. En cambio, si aparecen de repente, si aumentan en cantidad o si vienen con destellos de luz o con una sombra o cortina oscura en la visión, puede tratarse de un desgarro o desprendimiento de retina: en ese caso es una urgencia y debe acudir a urgencias o llamar al 9-1-1 de inmediato, sin esperar y sin conducir. Si tiene dudas, comuníquese con nuestro personal indicando su nombre y número de teléfono y le orientamos.',
  },
  {
    pregunta: '¿Qué son los destellos o flashes de luz en la visión?',
    respuesta:
      'Los destellos o flashes de luz son: luzzas breves y súbitas, similar a un relámpago, que aparecen al mover los ojos o en la oscuridad. Suelen deberse a tracciones del vítreo sobre la retina. Si aparecen de forma repentina, especialmente junto con puntos negros flotantes o una sombra en la visión, pueden indicar un desgarro de retina y requieren evaluación urgente el mismo día: acuda a urgencias o llame al 9-1-1 de inmediato.',
  },
  {
    pregunta: '¿Qué significa ver una sombra o cortina oscura en la visión?',
    respuesta:
      'Ver una sombra, cortina o cortinilla oscura en el campo de visión es un signo de que la retina se ha desprendido. El desprendimiento de retina es una urgencia oftalmológica: la pérdida de visión puede ser irreversible si no se trata a tiempo. Acuda de inmediato a urgencias o llame al 9-1-1 y no conduzca.',
  },
  {
    pregunta: '¿Qué significa ver una mancha oscura o sombra fija en un ojo?',
    respuesta:
      'Una mancha oscura o sombra fija en el campo visual puede deberse a una lesión de la retina, una hemorragia, una degeneración macular o una oclusión de los vasos de la retina. No se puede saber la causa sin una evaluación con equipo especializado (OCT y angiografía fluoresceínica). Es necesario programar una consulta de retina para determinar el origen y el tratamiento adecuado.',
  },
  {
    pregunta: '¿Por qué veo doble (visión doble o diplopía)?',
    respuesta:
      'Ver doble puede deberse a múltiples causas: problemas de la retina o del nervio óptico, alteraciones en la cornea o el cristalino, o condiciones neurológicas. Si la visión doble aparece de forma repentina, especialmente si también hay debilidad, dificultad para hablar o mareo, es una emergencia y debe ir a urgencias de inmediato. Si es gradual, se necesita una evaluación oftalmológica para determinar la causa.',
  },
  {
    pregunta: '¿Qué significa ver curvado o distorsionado las líneas rectas?',
    respuesta:
      'Ver las líneas rectas como curvas o onduladas se conoce como metamorfopsia y puede indicar edema o alteraciones en la mácula, la zona central de la retina responsable de la visión de detalle. Es una de las señales de la degeneración macular relacionada con la edad y de otras enfermedades de la mácula. Requiere una consulta de retina con OCT para evaluar la mácula.',
  },
  {
    pregunta: '¿Qué es la pérdida gradual de la visión central?',
    respuesta:
      'La pérdida gradual de la visión central, mientras la visión periférica se conserva, es el patrón típico de la degeneración macular relacionada con la edad. Afecta la mácula, el centro de la retina, y es una de las causas más comunes de pérdida visual en personas mayores. Se diagnostica y trata en consulta de retina con OCT y, cuando corresponde, tratamientos como inyecciones intravítreas o láser.',
  },
  {
    pregunta: '¿Qué significa tener visión borrosa de repente?',
    respuesta:
      'La visión borrosa de inicio súbito puede deberse a múltiples causas: un desprendimiento de retina, una hemorragia en el vítreo, un bloqueo de los vasos retinianos, inflamación o el inicio de una retinopatía diabética. Si la visión borrosa aparece de repente, especialmente con puntos negros, destellos o una sombra, es una urgencia: acuda a urgencias o llame al 9-1-1 de inmediato.',
  },
  {
    pregunta: '¿Qué significa tener los ojos secos o irritados?',
    respuesta:
      'Los ojos secos, irritados o con sensación de arenilla son condiciones frecuentes, especialmente por el uso prolongado de pantallas. En la mayoría de los casos se manejan con lágrimas artificiales y descansos visuales. Si persiste, si hay dolor intenso, o si hay enrojecimiento intenso con visión borrosa, debe consultarse para descartar inflamación ocular u otra condición que requiera tratamiento.',
  },

  // ── Enfermedades de retina ─────────────────────────────────────────
  {
    pregunta: '¿Qué es el desprendimiento de retina?',
    respuesta:
      'El desprendimiento de retina ocurre cuando la retina se separa del tejido que la sostiene en el interior del ojo. Puede ser provocado por un desgarro o por acumulación de líquido. El síntoma principal es una sombra o cortina oscura en la visión, y puede causar pérdida de visión irreversible si no se trata con rapidez. Es una urgencia oftalmológica: ante la duda, acuda a urgencias de inmediato.',
  },
  {
    pregunta: '¿Qué es la degeneración macular?',
    respuesta:
      'La degeneración macular es una enfermedad que afecta la mácula, el centro de la retina, y degrada la visión central. Se presenta en dos formas: seca, donde la mácula se deteriora gradualmente, y húmeda, donde se forman vasos anormales que filtran líquido y pueden causar pérdida visual rápida. Se diagnostica con OCT y angiografía fluoresceínica. La forma húmeda se trata con inyecciones intravítreas.',
  },
  {
    pregunta: '¿Qué es la catarata?',
    respuesta:
      'La catarata es la opacificación del cristalino, la lente natural del ojo, y causa visión borrosa y sensibilidad a la luz. Es muy frecuente en personas mayores y su tratamiento es quirúrgico. Retina Care se especializa en retina y vítreo, por lo que no realizamos cirugía de catarata; si tiene catarata, nuestro personal puede orientarle hacia un especialista en segmento anterior o indicar a su médico de atención primaria para que le refiera. Comúníquese con nosotros para más información.',
  },
  {
    pregunta: '¿Qué es la retinopatía diabética?',
    respuesta:
      'La retinopatía diabética es una complicación de la diabetes que daña los vasos de sangre de la retina. Puede comenzar sin síntomas y avanzar hasta causar pérdida de visión. Por eso las personas con diabetes deben realizarse una evaluación anual de retina con OCT y fotografía digital. El tratamiento depende de su etapa: control estricto de la glucosa, tratamiento láser, o inyecciones intravítreas.',
  },
  {
    pregunta: '¿Qué es el glaucoma?',
    respuesta:
      'El glaucoma es una enfermedad en la que el nervio óptico se daña, generalmente por aumento de la presión dentro del ojo. Es conocido como el "ladrón silencioso de la visión" porque en sus etapas iniciales no produce dolor ni pérdida visible de visión, y el paciente a menudo no nota el problema hasta que el daño es avanzado. Por eso es tan importante la evaluación de la presión intraocular y del nervio óptico de forma periódica.',
  },
  {
    pregunta: '¿Qué es una oclusión de un vaso de la retina?',
    respuesta:
      'Una oclusión es el bloqueo de la arteria o la vena que alimenta la retina. La oclusión de la vena central o de una rama de la retina causa visión borrosa o una sombra de forma súbita, y la de la arteria causa una pérdida de visión mucho más brusca y grave. Es una urgencia: ante una pérdida visual súbita debe acudir a urgencias o llamar al 9-1-1 de inmediato, porque el tiempo de tratamiento es clave para mejorar las probabilidades de recuperar visión.',
  },
  {
    pregunta: '¿Qué es un desprendimiento posterior del vítreo?',
    respuesta:
      'El desprendimiento posterior del vítreo ocurre cuando el vítreo, la sustancia gelatinosa que llena el ojo, se separa de la retina. Es un proceso muy frecuente después de los 50 años y por lo general no es grave. Puede producir destellos y puntos negros flotantes. Sin embargo, cuando ocurre un desgarro de retina durante este proceso, es una urgencia y debe evaluarse el mismo día.',
  },
  {
    pregunta: '¿Qué es la degeneración en lattice?',
    respuesta:
      'La degeneración en lattice (una alteración en forma de reja) es un padecimiento del ojo donde áreas de retina se adelgazan. Es una causa frecuente de desgarros de retina y desprendimiento, y suele ser un hallazgo en pacientes con miopía alta. Los pacientes con esta condición deben recibir seguimiento retinal periódico, y deben evitar actividades de alto riesgo de impacto hasta ser evaluados por el retinólogo.',
  },

  // ── Procedimientos y tratamientos ───────────────────────────────────
  {
    pregunta: '¿Qué es un examen OCT y para qué sirve?',
    respuesta:
      'El OCT es una tomografía de coherencia óptica: un examen de imagen, indoloro y rápido, que permite ver las capas de la retina con gran precisión y medir su grosor. Es fundamental para diagnosticar y seguir el edema macular, la degeneración macular, el desprendimiento de retina y la retinopatía diabética, así como para decidir si se necesita tratamiento. Se realiza en consulta sin necesidad de anestesia.',
  },
  {
    pregunta: '¿Qué es la angiografía fluoresceínica?',
    respuesta:
      'La angiografía fluoresceínica es un estudio diagnóstico en el que se inyecta un tinte fluorescente en el brazo y se toman fotografías del fondo del ojo mientras el tinte circula por los vasos retinianos. Permite detectar fugas, bloqueos y alteraciones de la circulación de la retina. Se usa para planear tratamientos con láser y para evaluar la retinopatía diabética y la degeneración macular. La exploración es breve y las pupilas quedan dilatadas por unas horas.',
  },
  {
    pregunta: '¿Qué son las inyecciones intravítreas y para qué se usan?',
    respuesta:
      'Las inyecciones intravítreas son aplicaciones de medicamento directamente dentro del ojo, en el espacio del vítreo. Se utilizan principalmente para tratar el edema macular y la forma húmeda de la degeneración macular, y en algunos casos de retinopatía diabética. El medicamento se administra con una aguja muy fina y el procedimiento es breve. El paciente puede sentir presión y algo de molestia; es normal que después se vea el ojo rojo o con visión borrosa por unas horas.',
  },
  {
    pregunta: '¿Qué es el láser de retina?',
    respuesta:
      'El láser de retina se utiliza para tratar de forma precisa algunas enfermedades de la retina. En la retinopatía diabética se aplica para tratar los vasos anormales y prevenir el desprendimiento de retina; en los desgarros de retina se usa para sellarlos y evitar que se desprendan. El procedimiento se realiza con anestesia local, con gotas, en consulta, y suele ser de pocos minutos.',
  },
  {
    pregunta: '¿En qué consiste la cirugía de retina?',
    respuesta:
      'La cirugía de retina se realiza para corregir problemas como el desprendimiento de retina, los desgarros, las membranas que se forman sobre la mácula y otras alteraciones del vítreo. Se efectúa con técnicas de microcirugía, como la vitrectomía, en la que se extrae el vítreo y se reemplaza con una solución o gas para mantener la retina en su lugar. Se realiza en un centro quirúrgico, bajo anestesia, y el personal le explicará el procedimiento y los cuidados en consulta.',
  },
  {
    pregunta: '¿Cada cuánto debe una persona diabética revisar su retina?',
    respuesta:
      'Las personas con diabetes deben realizarse una evaluación de retina al menos una vez al año, aunque no tengan síntomas, porque la retinopatía diabética puede dañar la visión sin que el paciente note nada. Si ya existe retinopatía o el control de la glucosa es difícil, la evaluación puede ser más frecuente. La consulta incluye OCT y fotografía digital del fondo del ojo.',
  },
  {
    pregunta: '¿Qué pruebas se hacen en una consulta de retina?',
    respuesta:
      'En una consulta de retina se revisa el fondo del ojo con equipo especializado. Según el caso, se realizan fotografía digital de retina, OCT, angiografía fluoresceínica y medición de la presión intraocular. El Dr. Andrés Emanuelli determina, basándose en la evaluación, qué pruebas hacen falta en cada caso y cuál es el plan de tratamiento. Las pupilas se dilatan durante la consulta, por lo que la visión puede verse borrosa y sensible a la luz por unas horas.',
  },

  // ── Clínica y logística ─────────────────────────────────────────────
  {
    pregunta: '¿Aceptan el plan Vital?',
    respuesta:
      'Sí, Retina Care acepta Medicaid (Vital) y los principales planes médicos de Puerto Rico, incluyendo Triple-S, MCS, MMM, Humana y Medicare Advantage. Para confirmar la cobertura de tu plan específico o conocer los requisitos de referencial, comunícate con nuestro personal indicando tu nombre y número de teléfono y con gusto te orientamos.',
  },
  {
    pregunta: '¿Qué planes médicos acepta Retina Care?',
    respuesta:
      'Retina Care acepta los principales planes médicos de Puerto Rico, incluyendo Triple-S, MCS, MMM, Humana, Medicare Advantage y Medicaid (Vital). Para confirmar la cobertura de tu plan específico o conocer los requisitos de referencial, comunícate con nuestro personal indicando tu nombre y número de teléfono.',
  },
  {
    pregunta: '¿Dónde está Retina Care y cómo se coordina una cita?',
    respuesta:
      'Retina Care está en el #452 Ave. Dr. Rivera Aulet, Arecibo, PR 00612, y atiende de Lunes a Viernes de 7:30am a 2:30pm. El horario de atención y citas es de Lunes a Viernes de 7:30am a 2:30pm. Para coordinar, confirmar o cancelar una cita, déjenos su nombre completo y número de teléfono; nuestro personal se comunicará con usted tan pronto como sea posible. También puede llamar al 787-680-7222.',
  },
];

async function main(): Promise<void> {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  let insertadas = 0;
  let actualizadas = 0;
  let sinCambios = 0;

  try {
    for (const e of ENTRADAS) {
      // Compara normalizando acentos, signos y espacios, para que un leve
      // cambio en el texto de la pregunta ACTUALICE la fila en vez de crear
      // una duplicada.
      const { rows } = await pool.query(
        `SELECT id, pregunta, respuesta FROM conocimiento_especifico
         WHERE lower(regexp_replace(unaccent(pregunta), '[^a-z0-9]+', ' ', 'g'))
            = lower(regexp_replace(unaccent($1), '[^a-z0-9]+', ' ', 'g'))
         LIMIT 1`,
        [e.pregunta],
      );

      if (rows.length === 0) {
        await pool.query(
          `INSERT INTO conocimiento_especifico (pregunta, respuesta, fuente)
           VALUES ($1, $2, 'clinica_oficial')`,
          [e.pregunta, e.respuesta],
        );
        insertadas++;
      } else if (
        rows[0].respuesta !== e.respuesta ||
        rows[0].pregunta !== e.pregunta
      ) {
        await pool.query(
          `UPDATE conocimiento_especifico
           SET pregunta = $2, respuesta = $3, fuente = 'clinica_oficial', updated_at = now()
           WHERE id = $1`,
          [rows[0].id, e.pregunta, e.respuesta],
        );
        actualizadas++;
      } else {
        sinCambios++;
      }
    }

    const total = await pool.query(
      'SELECT COUNT(*)::int AS n FROM conocimiento_especifico',
    );
    console.log(
      `OK — insertadas: ${insertadas}, actualizadas: ${actualizadas}, sin cambios: ${sinCambios}. Total en base: ${total.rows[0].n}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
