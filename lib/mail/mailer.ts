import "server-only";
import { logger } from "@/lib/logger";

export type MailMessage = { to: string; subject: string; text: string; html?: string };

/** Pluggable email transport (SMTP / provider adapters are added in the notifications phase). */
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

let mailer: Mailer | null = null;

export function getMailer(): Mailer {
  if (!mailer) mailer = new ConsoleMailer();
  return mailer;
}

/** Test hook. */
export function setMailer(m: Mailer | null) {
  mailer = m;
}
