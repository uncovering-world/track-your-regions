import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

// =============================================================================
// Configuration
// =============================================================================

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@localhost';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const isSmtpConfigured = SMTP_HOST && SMTP_USER && SMTP_PASS;

// =============================================================================
// Transport Setup
// =============================================================================

let transporter: Transporter;

if (isSmtpConfigured) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
  console.log(`📧 Email transport: SMTP (${SMTP_HOST}:${SMTP_PORT})`);
} else {
  // Development fallback: log emails to console
  transporter = nodemailer.createTransport({
    jsonTransport: true,
  });
  console.log('📧 Email transport: console (no SMTP configured — emails will be printed to stdout)');
}

// =============================================================================
// Email Sending
// =============================================================================

/**
 * Send a verification email with a clickable link.
 * In development (no SMTP), the email content is printed to the console.
 */
export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const verificationUrl = `${FRONTEND_URL}/verify-email?token=${encodeURIComponent(token)}`;

  const subject = 'Verify your email — Track Your Regions';
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
      <h2 style="color: #1a1a1a; margin-bottom: 16px;">Verify your email</h2>
      <p style="color: #4a4a4a; line-height: 1.5;">
        Click the button below to verify your email address and activate your account.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${verificationUrl}"
           style="background: #1976d2; color: #fff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block;">
          Verify Email
        </a>
      </div>
      <p style="color: #888; font-size: 13px; line-height: 1.5;">
        Or copy and paste this link into your browser:<br>
        <a href="${verificationUrl}" style="color: #1976d2; word-break: break-all;">${verificationUrl}</a>
      </p>
      <p style="color: #888; font-size: 13px;">
        This link expires in 24 hours. If you didn't create an account, you can ignore this email.
      </p>
    </div>
  `;

  const text = `Verify your email\n\nClick this link to verify your email address:\n${verificationUrl}\n\nThis link expires in 24 hours. If you didn't create an account, you can ignore this email.`;

  const info = await transporter.sendMail({
    from: EMAIL_FROM,
    to,
    subject,
    text,
    html,
  });

  if (!isSmtpConfigured) {
    // Development: parse the JSON transport output and log a clear message
    console.log('\n' + '='.repeat(60));
    console.log('📧 VERIFICATION EMAIL (dev mode — copy the link below)');
    console.log('='.repeat(60));
    try {
      const message = JSON.parse(info.message);
      console.log(`To: ${message.to}`);
      console.log(`Subject: ${message.subject}`);
    } catch {
      console.log(`Raw message: ${info.message}`);
    }
    console.log(`\n🔗 Verification link:\n   ${verificationUrl}\n`);
    console.log('='.repeat(60) + '\n');
  }
}
