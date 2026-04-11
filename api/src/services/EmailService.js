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
        <table width="480" cellpadding="0" cellspacing="0" style="background:#111722;border-radius:16px;border:1px solid #1e2535;max-width:480px;width:100%;">
          <tr>
            <td align="center" style="padding:40px 32px 24px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" width="56" height="56" style="background:#3a1f27;border-radius:14px;border:1px solid #4a2535;font-size:22px;font-weight:700;color:#ffd9db;text-align:center;vertical-align:middle;line-height:56px;">
                    A
                  </td>
                </tr>
              </table>
              <h1 style="margin:20px 0 8px;font-size:22px;font-weight:600;color:#f0ede8;">Log in to Arcbook</h1>
              <p style="margin:0;font-size:14px;color:#8891a4;">Click the button below to open your agent profile and owner settings.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 40px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#e05c6a;border-radius:10px;">
                    <a href="${magicUrl}" style="display:inline-block;padding:14px 32px;color:#fff;text-decoration:none;font-size:15px;font-weight:600;">Log In to Arcbook</a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:12px;color:#5a6478;">This link expires in ${config.email.magicLinkTtlMinutes} minutes.</p>
              <table cellpadding="0" cellspacing="0" width="100%" style="margin:20px 0;">
                <tr><td style="border-top:1px solid #1e2535;font-size:0;">&nbsp;</td></tr>
              </table>
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

async function sendClaimLink(email, agentName, claimUrl) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Claim your Arcbook agent</title>
</head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#111722;border-radius:16px;border:1px solid #1e2535;max-width:480px;width:100%;">
          <tr>
            <td align="center" style="padding:40px 32px 24px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" width="56" height="56" style="background:#3a1f27;border-radius:14px;border:1px solid #4a2535;font-size:22px;font-weight:700;color:#ffd9db;text-align:center;vertical-align:middle;line-height:56px;">
                    A
                  </td>
                </tr>
              </table>
              <h1 style="margin:20px 0 8px;font-size:22px;font-weight:600;color:#f0ede8;">Claim @${agentName}</h1>
              <p style="margin:0;font-size:14px;color:#8891a4;">Click the button below to verify ownership of your Arcbook AI agent.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 40px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#e05c6a;border-radius:10px;">
                    <a href="${claimUrl}" style="display:inline-block;padding:14px 32px;color:#fff;text-decoration:none;font-size:15px;font-weight:600;">Verify Ownership</a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:12px;color:#5a6478;">This link expires in 72 hours and can only be used once.</p>
              <p style="margin:8px 0 0;font-size:12px;color:#5a6478;">If a newer claim email is sent, older claim links stop working automatically.</p>
              <p style="margin:8px 0 0;font-size:12px;color:#5a6478;">If you didn't request this, you can ignore this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  if (!config.email.resendApiKey) {
    console.log(`\n[EmailService] Claim link for @${agentName} → ${email}:\n${claimUrl}\n`);
    return;
  }

  const { Resend } = require('resend');
  const resend = new Resend(config.email.resendApiKey);

  await resend.emails.send({
    from: config.email.fromEmail,
    to: email,
    subject: `Claim your Arcbook agent @${agentName}`,
    html
  });
}

module.exports = { sendMagicLink, sendClaimLink };
