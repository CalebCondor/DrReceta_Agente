// src/test-mail-alert.ts
// Dispara manualmente la alerta para probar el envío por Resend.
// Ejecutar con: npx ts-node src/test-mail-alert.ts

import 'dotenv/config';
import { MailAlertService } from './agent/mail-alert.service';

async function main() {
  const svc = new MailAlertService();
  svc.onModuleInit();
  await svc.notifyTokensExhausted(
    'TEST manual desde src/test-mail-alert.ts — ignora este correo.',
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
