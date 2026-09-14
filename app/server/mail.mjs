/**
 * Transactional mail. Resend when RESEND_API_KEY is set; otherwise
 * `mailConfigured()` is false and the API hands dev links back instead
 * (never in production).
 */
const from = () => process.env.COHIVE_MAIL_FROM || 'Cohive <hello@cohive.app>';

export function mailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendMagicLink({ to, link }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('mail_not_configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: from(),
      to: [to],
      subject: 'Your Cohive sign-in link',
      text: `Tap to sign in to Cohive:\n\n${link}\n\nThe link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`,
      html: `<p>Tap to sign in to Cohive:</p><p><a href="${link}">${link}</a></p><p>The link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.</p>`,
    }),
  });
  if (!res.ok) throw new Error('mail_failed');
}
