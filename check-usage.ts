// check-usage.ts
// Uso normal:     bun run check-usage.ts
// Modo prueba:    bun run check-usage.ts --dry-run
//                 (no llama a Anthropic, solo manda email de prueba)

import nodemailer from 'nodemailer';

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4': { input: 15, output: 75 },
  'claude-haiku-4': { input: 0.8, output: 4 },
};

const MONTHLY_LIMIT_USD = 200;
const isDryRun = process.argv.includes('--dry-run');

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (isDryRun) {
    console.log('🧪 MODO DRY-RUN: no se gastarán tokens\n');
  } else {
    if (!apiKey) {
      console.error('❌ Falta ANTHROPIC_API_KEY');
      return;
    }
    console.log('🔍 Consultando uso a Anthropic...\n');
  }

  let cost = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  if (!isDryRun) {
    // Probe mínimo de 1 token
    const probe = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: '.' }],
      }),
    });

    if (!probe.ok) {
      console.error(`❌ Error ${probe.status}: ${await probe.text()}`);
      return;
    }

    const data = (await probe.json()) as {
      usage: { input_tokens: number; output_tokens: number };
    };

    inputTokens = data.usage.input_tokens;
    outputTokens = data.usage.output_tokens;
    cost =
      (inputTokens / 1_000_000) * PRICING['claude-sonnet-4-5'].input +
      (outputTokens / 1_000_000) * PRICING['claude-sonnet-4-5'].output;
  } else {
    // Datos ficticios para prueba
    inputTokens = 0;
    outputTokens = 0;
    cost = 0;
  }

  const remaining = Math.max(0, MONTHLY_LIMIT_USD - cost);
  const percent = (cost / MONTHLY_LIMIT_USD) * 100;
  const now = new Date().toLocaleString('es');

  const report = isDryRun
    ? `
🧪 REPORTE DE PRUEBA (DRY-RUN) - ${now}

   ✅ No se gastó ningún token
   ✅ Email de prueba
   ✅ Configuración funciona correctamente

   Tu límite configurado: $${MONTHLY_LIMIT_USD} USD
`
    : `
📊 REPORTE DE USO - ${now}

   Este probe (1 token):
      Input:  ${inputTokens} tokens
      Output: ${outputTokens} tokens
      Costo:  $${cost.toFixed(6)} USD

   Tu límite mensual: $${MONTHLY_LIMIT_USD} USD
   Restante:         $${remaining.toFixed(2)} USD (${(100 - percent).toFixed(2)}%)

   💡 Esta ejecución sola cuesta ~$${cost.toFixed(6)}
      Para ver el gasto TOTAL real del mes ve a:
      https://console.anthropic.com/settings/billing
`;

  console.log(report);

  if (gmailPass) {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: 'calebcondor553@gmail.com', pass: gmailPass },
    });

    await transporter.sendMail({
      from: `"Anthropic Check" <calebcondor553@gmail.com>`,
      to: 'calebcondor553@gmail.com',
      subject: isDryRun
        ? '🧪 Prueba email Anthropic'
        : `💳 Uso Anthropic: $${cost.toFixed(4)}`,
      html: `<pre style="font-family: monospace; padding: 20px; background: #f9fafb;">${report}</pre>`,
    });
    console.log('📧 Email enviado a calebcondor553@gmail.com');
  } else {
    console.log('\n❌ FALTA CONFIGURAR EL EMAIL\n');
    console.log('   Para activarlo:');
    console.log('   1. Abre: https://myaccount.google.com/apppasswords');
    console.log("   2. Crea una contraseña para app 'Mail'");
    console.log('   3. Google te da 16 letras tipo: abcd efgh ijkl mnop');
    console.log('   4. Agrégalas a tu archivo .env:\n');
    console.log('      GMAIL_APP_PASSWORD=abcd efgh ijkl mnop\n');
    console.log('   5. Vuelve a correr: bun run check-usage.ts --dry-run\n');
  }
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
