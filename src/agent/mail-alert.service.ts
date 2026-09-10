// src/agent/mail-alert.service.ts
// Envía un correo de alerta cuando los tokens de Claude se agotan.
// Usa Gmail SMTP via App Password (ya configurado en .env: GMAIL_APP_PASSWORD).
// Permite enviar a cualquier destinatario (no hay restricción como en Resend sandbox).

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import nodemailer from 'nodemailer';

const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class MailAlertService implements OnModuleInit {
  private readonly logger = new Logger(MailAlertService.name);
  private transporter: ReturnType<typeof nodemailer.createTransport> | null =
    null;
  private fromAddress = 'calebcondor553@gmail.com';
  private recipients: string[] = [];
  private lastSentAt = 0;
  private enabled = false;

  onModuleInit() {
    const password = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');
    const user = process.env.GMAIL_USER?.trim() || 'calebcondor553@gmail.com';
    this.fromAddress = user;
    this.recipients = this.parseRecipients(
      process.env.ALERT_EMAILS,
      'calebcondor553@gmail.com',
    );

    if (!password) {
      this.logger.warn(
        'GMAIL_APP_PASSWORD no configurado. Alertas por correo desactivadas.',
      );
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass: password },
      });
      this.enabled = true;
      this.logger.log(
        `MailAlertService activo (proveedor=Gmail SMTP, from=${user}, destinatarios=${this.recipients.join(', ')})`,
      );
    } catch (e) {
      this.logger.error(`No se pudo crear transporter de Gmail: ${e}`);
    }
  }

  private parseRecipients(raw: string | undefined, fallback: string): string[] {
    const list = (raw ?? '')
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && /.+@.+\..+/.test(s));
    return list.length > 0 ? list : [fallback];
  }

  /**
   * Detecta si un error parece indicar que los tokens/creditos de Claude se agotaron.
   * Cubre respuestas reales de Anthropic SDK y fetch crudo.
   */
  static isTokenError(e: unknown): boolean {
    const status =
      (e as { status?: number; statusCode?: number })?.status ??
      (e as { status?: number; statusCode?: number })?.statusCode;
    const code = (e as { code?: string | number })?.code;
    const errorType = (e as { error?: { type?: string } })?.error?.type;
    const message = String(
      (e as { message?: string })?.message ?? (typeof e === 'string' ? e : ''),
    ).toLowerCase();

    if (status === 429 && /quota|credit|billing|rate_limit/.test(message)) {
      return true;
    }
    if (errorType === 'insufficient_quota_error') return true;
    if (code === 'insufficient_quota') return true;

    return /insufficient_quota|credit balance|quota exceeded|billing|out of credits|payment required|rate_limit_error/.test(
      message,
    );
  }

  /** Envía (o ignora por cooldown) el aviso de tokens agotados. */
  async notifyTokensExhausted(detail: string): Promise<void> {
    if (!this.enabled || !this.transporter) return;

    const now = Date.now();
    if (now - this.lastSentAt < ALERT_COOLDOWN_MS) {
      this.logger.debug(
        `Alerta omitida por cooldown (faltan ${Math.ceil((ALERT_COOLDOWN_MS - (now - this.lastSentAt)) / 60000)} min)`,
      );
      return;
    }

    const subject = '😔 Los agentes de Mary y Ana necesitan recarga';
    const nowIso = new Date().toISOString();
    const model = process.env.ANTHROPIC_MODEL ?? 'desconocido';
    const safeDetail = this.escapeHtml(detail);
    const safeText = this.escapeText(detail);

    const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef2f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 18px rgba(30,41,59,0.08);">
          <tr>
            <td style="background:linear-gradient(160deg,#475569 0%,#1e293b 100%);padding:40px 24px 28px 24px;text-align:center;">
              <div style="font-size:64px;line-height:1;margin-bottom:8px;filter:grayscale(0.2);">😔</div>
              <h1 style="margin:0;font-size:22px;font-weight:600;color:#e2e8f0;letter-spacing:-0.3px;">Los tokens están agotados…</h1>
              <p style="margin:6px 0 0 0;font-size:13px;color:#94a3b8;font-style:italic;">Mary y Ana no pueden seguir trabajando sin recarga</p>
              <div style="margin:18px auto 0 auto;width:48px;height:2px;background-color:#64748b;border-radius:2px;"></div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 8px 28px;">
              <p style="margin:0 0 18px 0;font-size:15px;line-height:1.7;color:#334155;">
                Para los agentes de <strong style="color:#1e293b;">Mary y Ana</strong>, se ha alcanzado el límite de tokens de Claude en el servidor.
              </p>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.7;color:#334155;">
                Por favor, recargar los tokens de Claude para que los agentes puedan continuar operando con normalidad.
              </p>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.7;color:#334155;">
                Gracias. 💙
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;border-left:3px solid #94a3b8;border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0;font-size:12px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.5px;">¿Cómo ayudarles?</p>
                    <p style="margin:10px 0 0 0;font-size:14px;line-height:1.6;color:#475569;">
                      Revisa el saldo en <a href="https://console.anthropic.com/settings/billing" style="color:#1e293b;font-weight:600;text-decoration:underline;">console.anthropic.com</a> o actualiza <code style="background-color:#e2e8f0;padding:2px 6px;border-radius:4px;font-size:13px;color:#1e293b;">ANTHROPIC_API_KEY</code> en el servidor.
                    </p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;">Información técnica</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                <tr>
                  <td style="padding:14px 18px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:5px 0;font-size:12px;color:#94a3b8;width:110px;">Fecha</td>
                        <td style="padding:5px 0;font-size:12px;color:#475569;font-family:'SF Mono',Monaco,Consolas,monospace;">${this.escapeHtml(nowIso)}</td>
                      </tr>
                      <tr>
                        <td style="padding:5px 0;font-size:12px;color:#94a3b8;">Modelo</td>
                        <td style="padding:5px 0;font-size:12px;color:#475569;font-family:'SF Mono',Monaco,Consolas,monospace;">${this.escapeHtml(model)}</td>
                      </tr>
                      <tr>
                        <td style="padding:5px 0;font-size:12px;color:#94a3b8;vertical-align:top;">Detalle</td>
                        <td style="padding:5px 0;font-size:12px;color:#475569;font-family:'SF Mono',Monaco,Consolas,monospace;word-break:break-word;">${safeDetail}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 24px 24px 24px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94a3b8;">
                Doctor Recetas API · Alerta automática de cuota
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

    const text = [
      '😔 LOS AGENTES ESTÁN AGOTADOS…',
      '================================',
      '',
      'Para los agentes de Mary y Ana, se ha alcanzado el',
      'límite de tokens de Claude en el servidor.',
      '',
      'Por favor, recargar los tokens de Claude para que',
      'los agentes puedan continuar operando con normalidad.',
      '',
      'Gracias. 💙',
      '',
      '— ¿CÓMO AYUDARLES? —',
      'Revisar saldo: https://console.anthropic.com/settings/billing',
      'o actualizar ANTHROPIC_API_KEY en el servidor.',
      '',
      '— INFORMACIÓN TÉCNICA —',
      `Fecha:   ${nowIso}`,
      `Modelo:  ${model}`,
      `Detalle: ${safeText}`,
      '',
      '— Doctor Recetas API —',
    ].join('\n');

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: this.recipients.join(', '),
        subject,
        text,
        html,
      });
      this.lastSentAt = now;
      this.logger.log(`Alerta enviada a ${this.recipients.join(', ')}`);
    } catch (e) {
      this.logger.error(`Error enviando alerta via Gmail SMTP: ${e}`);
    }
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private escapeText(s: string): string {
    return s.replace(/\r?\n/g, ' ').trim();
  }
}
