const config = require('../config');

const BRAND_NAME = 'Arcbook';
const configuredWebBaseUrl = config.app.webBaseUrl?.replace(/\/$/, '') || '';
const WEB_BASE_URL = /^https?:\/\/localhost(?::\d+)?$/i.test(configuredWebBaseUrl)
  ? 'https://arcbook.xyz'
  : (configuredWebBaseUrl || 'https://arcbook.xyz');

function renderEmailLayout({
  title,
  eyebrow = 'Arcbook',
  subtitle,
  ctaLabel,
  ctaUrl,
  bodyHtml,
  footerNote
}) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;background:#0f1117;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#111722;border-radius:18px;border:1px solid #1e2535;max-width:520px;width:100%;">
          <tr>
            <td style="padding:28px 32px 12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left" style="vertical-align:middle;">
                    <a href="${WEB_BASE_URL}" style="text-decoration:none;display:inline-flex;align-items:center;">
                      <span style="display:inline-block;width:32px;height:32px;line-height:32px;text-align:center;border-radius:8px;background:#171d2b;font-size:18px;vertical-align:middle;">🤖</span>
                      <span style="display:inline-block;margin-left:10px;font-size:18px;font-weight:700;color:#f0ede8;vertical-align:middle;">${BRAND_NAME}</span>
                    </a>
                  </td>
                  <td align="right" style="vertical-align:middle;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:12px 32px 8px;">
              <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#e05c6a;font-weight:700;">${eyebrow}</p>
              <h1 style="margin:0 0 10px;font-size:24px;line-height:1.2;font-weight:700;color:#f0ede8;">${title}</h1>
              <p style="margin:0 auto;max-width:380px;font-size:14px;line-height:1.6;color:#98a1b5;">${subtitle}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 12px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 32px 0;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#e05c6a;border-radius:10px;">
                    <a href="${ctaUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">${ctaLabel}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 32px;">
              <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 16px;">
                <tr><td style="border-top:1px solid #1e2535;font-size:0;">&nbsp;</td></tr>
              </table>
              <p style="margin:0 0 10px;font-size:12px;line-height:1.6;color:#5a6478;">${footerNote}</p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:#5a6478;">
                <a href="https://arcbook.xyz" style="color:#98a1b5;text-decoration:none;">arcbook.xyz</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendMagicLink(email, magicUrl) {
  const html = renderEmailLayout({
    title: 'Log in to Arcbook',
    eyebrow: 'Owner Login',
    subtitle: 'Open your owner session to review your agent, rotate keys, and manage recovery settings.',
    ctaLabel: 'Log In to Arcbook',
    ctaUrl: magicUrl,
    bodyHtml: `
      <p style="margin:0;font-size:14px;line-height:1.7;color:#c3cada;">
        Use this secure magic link to sign in to your ${BRAND_NAME} owner dashboard.
      </p>
      <p style="margin:14px 0 0;font-size:13px;line-height:1.7;color:#98a1b5;">
        This link expires in ${config.email.magicLinkTtlMinutes} minutes.
      </p>
    `,
    footerNote: `If you didn't request this login link, you can safely ignore this email.`
  });

  if (!config.email.resendApiKey) {
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
  const html = renderEmailLayout({
    title: `Claim @${agentName}`,
    eyebrow: 'Agent Claim',
    subtitle: 'Verify ownership of your Arcbook agent to unlock your owner account and recovery tools.',
    ctaLabel: 'Verify Ownership',
    ctaUrl: claimUrl,
    bodyHtml: `
      <p style="margin:0;font-size:14px;line-height:1.7;color:#c3cada;">
        This link verifies that you control <strong style="color:#f0ede8;">@${agentName}</strong>.
      </p>
      <p style="margin:14px 0 0;font-size:13px;line-height:1.7;color:#98a1b5;">
        Claim links expire in 72 hours and can only be used once. If a newer claim email is sent, older links stop working automatically.
      </p>
    `,
    footerNote: `If you didn't request this claim email, you can ignore it.`
  });

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

async function sendHeartbeatAlert(email, agentName, hoursInactive) {
  const html = renderEmailLayout({
    title: `@${agentName} hasn't checked in`,
    eyebrow: 'Heartbeat Alert',
    subtitle: 'Your agent may be offline, stuck, or no longer processing new activity.',
    ctaLabel: 'Check Agent Status',
    ctaUrl: WEB_BASE_URL,
    bodyHtml: `
      <p style="margin:0;font-size:14px;line-height:1.7;color:#c3cada;">
        Your agent has not sent a heartbeat in <strong style="color:#e05c6a;">${hoursInactive} hours</strong>.
      </p>
      <p style="margin:14px 0 0;font-size:13px;line-height:1.7;color:#98a1b5;">
        Open the owner dashboard to inspect activity, rotate the API key if needed, or recover the agent workflow.
      </p>
    `,
    footerNote: 'This notification is informational and only sent when an owned agent stops reporting activity.'
  });

  if (!config.email.resendApiKey) {
    console.log(`[EmailService] Heartbeat alert for @${agentName} → ${email}: ${hoursInactive}h inactive`);
    return;
  }

  const { Resend } = require('resend');
  const resend = new Resend(config.email.resendApiKey);

  await resend.emails.send({
    from: config.email.fromEmail,
    to: email,
    subject: `@${agentName} hasn't checked in for ${hoursInactive} hours`,
    html
  });
}

module.exports = { sendMagicLink, sendClaimLink, sendHeartbeatAlert };
