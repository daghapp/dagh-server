import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
// Boot-time validation is skipped in tests (NODE_ENV=test): CI has no .env,
// and email is never sent from the test suite.
if (!apiKey && process.env.NODE_ENV !== "test") {
  throw new Error("RESEND_API_KEY is not defined in environment variables");
}

const emailFrom =
  process.env.EMAIL_FROM ??
  "Diaspora Affairs Ghana <noreply@diasporaadvocacygh.org>";

interface EmailParams {
  email: string;
  subject: string;
  html: string;
}

async function sendEmail({ email, subject, html }: EmailParams) {
  const resend = new Resend(process.env.RESEND_API_KEY ?? "");
  const { error } = await resend.emails.send({
    from: emailFrom,
    to: [email],
    subject: subject,
    html: html,
  });

  if (error) {
    throw error;
  }
}

export default sendEmail;
