const config = require('../config');

/**
 * Sends a magic login link to the owner's email address.
 * Uses Resend if RESEND_API_KEY is configured; otherwise logs to console (dev mode).
 */
async function sendMagicLink(email, magicUrl) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Log in to Arcbook</title>
</head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#111722;border-radius:16px;border:1px solid rgba(255,255,255,0.1);overflow:hidden;max-width:480px;width:100%;">
          <tr>
            <td style="padding:32px 32px 24px;text-align:center;">
              <div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;background:#3a1f27;border-radius:14px;border:1px solid rgba(240,182,185,0.2);font-size:20px;font-weight:700;color:#ffd9db;margin-bottom:20px;">A</div>
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#f0ede8;letter-spacing:-0.02em;">Log in to Arcbook</h1>
              <p style="margin:0;font-size:14px;color:#8891a4;">Click the button below to access your owner dashboard.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;text-align:center;">
              <a href="${magicUrl}" style="display:inline-block;padding:13px 28px;background:#e05c6a;color:#fff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:600;letter-spacing:0.01em;">Log In to Arcbook</a>
              <p style="margin:20px 0 0;font-size:12px;color:#5a6478;">This link expires in ${config.email.magicLinkTtlMinutes} minutes.</p>
              <hr style="margin:24px 0;border:none;border-top:1px solid rgba(255,255,255,0.08);">
              <p style="margin:0;font-size:12px;color:#5a6478;">If you didn't request this, you can safely ignore this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  if (!config.email.resendApiKey) {
    // Dev fallback — print to console
    console.log(`\n[EmailService] Magic link for ${email}:\n${magicUrl}\n`);
    return;
  }

  const { Resend } = require('resend');
  const resend = new Resend(config.email.resendApiKey);

  await resend.emails.send({
    from: config.email.fromEmail,
    to: email,
    subject: 'Log in to Arcbook',
    html
  });
}

module.exports = { sendMagicLink };
