# Email Setup

This document covers email infrastructure for Track Your Regions. Email is used for account verification — when a user registers with email/password, they receive a verification link they must click before they can log in.

## Development

**No setup needed.** When SMTP is not configured, emails are printed to the backend console:

```
============================================================
📧 VERIFICATION EMAIL (dev mode — copy the link below)
============================================================
To: user@example.com
Subject: Verify your email — Track Your Regions

🔗 Verification link:
   http://localhost:5173/verify-email?token=abc123...

============================================================
```

Just copy the verification link from the terminal and paste it into your browser.

## Production Setup

### Option 1: Resend (Recommended)

[Resend](https://resend.com) offers a generous free tier (100 emails/day) and excellent deliverability.

1. Sign up at [resend.com](https://resend.com)
2. Add your domain → Resend gives you DNS records to add
3. Add the DNS records in your DNS provider (Cloudflare, etc.)
4. Create an API key
5. Set environment variables:

```bash
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_XXXXXXXXXXXX  # Your Resend API key
EMAIL_FROM=noreply@yourdomain.com
```

### Option 2: SendGrid

1. Sign up at [sendgrid.com](https://sendgrid.com)
2. Verify your sender domain
3. Create an API key with "Mail Send" permission
4. Set environment variables:

```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG.XXXXXXXXXXXX  # Your SendGrid API key
EMAIL_FROM=noreply@yourdomain.com
```

### Option 3: Any SMTP Provider

Any SMTP-capable email provider works (Mailgun, Postmark, Amazon SES, etc.):

```bash
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587    # or 465 for SSL
SMTP_USER=your-username
SMTP_PASS=your-password
EMAIL_FROM=noreply@yourdomain.com
```

## DNS Records

For production email deliverability, configure these DNS records:

| Record | Type | Purpose |
|--------|------|---------|
| **SPF** | TXT | Tells receiving servers which IPs can send email for your domain |
| **DKIM** | TXT | Cryptographic signature proving the email wasn't tampered with |
| **DMARC** | TXT | Policy for handling emails that fail SPF/DKIM checks |

Your email provider will give you the exact records to add. In Cloudflare:
1. Go to DNS → Records
2. Add each TXT record provided by your email service
3. Wait for DNS propagation (usually minutes, sometimes up to 48h)

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SMTP_HOST` | Production only | — | SMTP server hostname |
| `SMTP_PORT` | No | `587` | SMTP port (587 for STARTTLS, 465 for SSL) |
| `SMTP_USER` | Production only | — | SMTP authentication username |
| `SMTP_PASS` | Production only | — | SMTP authentication password or API key |
| `EMAIL_FROM` | No | `noreply@localhost` | Sender email address |
| `FRONTEND_URL` | No | `http://localhost:5173` | Used to construct verification links |

## How Email Verification Works

1. User registers with email/password
2. Server creates user (email_verified=false) and sends verification email
3. User clicks the link → `GET /verify-email?token=...`
4. Frontend calls `POST /api/auth/verify-email` with the token
5. Server verifies token hash, sets email_verified=true, auto-logs in
6. Verification tokens expire after 24 hours
7. Users can request a new token via "Resend verification email"

**Anti-enumeration**: Registration always returns the same response ("Check your email") regardless of whether the email is new or already registered. This prevents attackers from discovering which emails have accounts.

## Troubleshooting

### Emails landing in spam
- Ensure SPF, DKIM, and DMARC DNS records are configured
- Use a reputable email provider (Resend, SendGrid)
- Avoid sending from free email domains (gmail.com, etc.)

### Connection refused
- Check `SMTP_HOST` and `SMTP_PORT` are correct
- Verify your server can reach the SMTP host (firewall rules)
- Try port 465 with SSL if 587 with STARTTLS fails

### Authentication errors
- Double-check `SMTP_USER` and `SMTP_PASS`
- For Resend: user is literally `resend`, pass is the API key
- For SendGrid: user is literally `apikey`, pass is the API key

### No emails in development
- Check the backend console output — emails are printed there
- Ensure the backend is running (`npm run dev:backend`)
