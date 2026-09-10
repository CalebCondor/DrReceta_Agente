declare module 'nodemailer' {
  interface Address {
    name?: string;
    address: string;
  }

  interface Envelope {
    from?: string;
    to?: string[];
  }

  interface MessageAttachment {
    filename?: string;
    content?: string | Buffer;
    path?: string;
    contentType?: string;
  }

  interface MessageHeaders {
    [key: string]: string | string[] | undefined;
  }

  interface SendMailOptions {
    from?: string | Address;
    to?: string | Address | Array<string | Address>;
    cc?: string | Address | Array<string | Address>;
    bcc?: string | Address | Array<string | Address>;
    subject?: string;
    text?: string;
    html?: string;
    attachments?: MessageAttachment[];
    headers?: MessageHeaders;
    envelope?: Envelope;
  }

  interface SentMessageInfo {
    envelope: Envelope;
    messageId: string;
    accepted: string[];
    rejected: string[];
    pending: string[];
    response: string;
  }

  interface Transporter<SMTP = unknown> {
    sendMail: (
      options: SendMailOptions,
      callback?: (err: Error | null, info: SentMessageInfo) => void,
    ) => Promise<SentMessageInfo>;
    verify: (
      callback?: (err: Error | null, success: boolean) => void,
    ) => Promise<boolean>;
    close: () => void;
  }

  interface TransportOptions {
    service?: string;
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: { user: string; pass: string };
    tls?: { rejectUnauthorized?: boolean };
  }

  interface SMTPTransportOptions extends TransportOptions {
    service?: string;
  }

  function createTransport(options: SMTPTransportOptions | string): Transporter;
  function createTransport(
    options: SMTPTransportOptions,
  ): Transporter<SMTPTransport.SentMessageInfo>;

  namespace SMTPTransport {
    interface SentMessageInfo {
      envelope: Envelope;
      messageId: string;
      accepted: string[];
      rejected: string[];
      pending: string[];
      response: string;
    }
  }

  const _default: {
    createTransport: typeof createTransport;
  };
  export default _default;
}
