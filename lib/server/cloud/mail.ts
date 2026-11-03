import "server-only";
import { newId } from "../ids";
import { UserError } from "../errors";
import { cloud, devMailbox, smtpConfigured } from "./config";
import { db } from "./db";

// Account emails: sent through any SMTP server (SMTP_URL or SMTP_HOST/PORT/USER/PASSWORD).
// Without one, they land in the built-in dev inbox (/dev/mail), which exists only outside production.

let transport: import("nodemailer").Transporter | null = null;

export const mailAvailable = () => smtpConfigured() || devMailbox();

export async function sendMail(to: string, subject: string, text: string) {
  if (smtpConfigured()) {
    const nodemailer = await import("nodemailer");
    transport ??= cloud.smtp.url
      ? nodemailer.createTransport(cloud.smtp.url)
      : nodemailer.createTransport({ host: cloud.smtp.host, port: cloud.smtp.port, secure: cloud.smtp.port === 465, auth: cloud.smtp.user ? { user: cloud.smtp.user, pass: cloud.smtp.pass } : undefined });
    try {
      await transport.sendMail({ from: cloud.smtp.from, to, subject, text });
    } catch (e) {
      console.error(`[mail] sending failed: ${(e as Error).message.slice(0, 200)}`);
      throw new UserError("We couldn't send the email right now. Please try again in a few minutes.", "mail_failed", 502);
    }
    return;
  }
  if (devMailbox()) {
    await (await db()).query("insert into dev_mail (id, to_addr, subject, text_body) values ($1, $2, $3, $4)", [newId(), to, subject, text]);
    return;
  }
  throw new UserError("This server can't send email yet, so this step isn't available. The administrator needs to set up SMTP.", "mail_unavailable", 503);
}

export async function devInbox(): Promise<{ id: string; to_addr: string; subject: string; text_body: string; created_at: Date }[]> {
  if (!devMailbox()) return [];
  return (await db()).query("select * from dev_mail order by created_at desc limit 50");
}
