import "server-only";
import { logger } from "@/lib/logger";

export type MailMessage = { to: string; subject: string; text: string; html?: string };

/** Pluggable email transport: console (development) or SMTP. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Development transport: prints the email to the server terminal. */
export class ConsoleMailer implements Mailer {
  async send(message: MailMessage) {
    if (process.env.NODE_ENV === "production") {
      logger.warn("mail.console_transport_in_production", { subject: message.subject });
      return;
    }
    console.log(
      `\n────────── EMAIL (dev console transport) ──────────\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n────────────────────────────────────────────────────\n`,
    );
  }
}

/** SMTP transport (EMAIL_TRANSPORT="smtp"). Works with Gmail app passwords, Zoho, SES, Brevo… */
export class SmtpMailer implements Mailer {
  private transporter: import("nodemailer").Transporter | null = null;
  private async get() {
    if (this.transporter) return this.transporter;
    const nodemailer = await import("nodemailer");
    const port = Number(process.env.SMTP_PORT ?? 587);
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      requireTLS: port === 587,
    });
    return this.transporter;
  }
  async send(message: MailMessage) {
    const t = await this.get();
    await t.sendMail({ from: process.env.EMAIL_FROM ?? "FinSight360 <no-reply@finsight360.local>", to: message.to, subject: message.subject, text: message.text, html: message.html });
  }
}

let mailer: Mailer | null = null;

export function getMailer(): Mailer {
  if (!mailer) mailer = process.env.EMAIL_TRANSPORT === "smtp" && process.env.SMTP_HOST ? new SmtpMailer() : new ConsoleMailer();
  return mailer;
}

/** Test hook. */
export function setMailer(m: Mailer | null) {
  mailer = m;
}
