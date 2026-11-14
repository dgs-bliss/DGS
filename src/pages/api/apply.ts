import type { APIRoute } from 'astro';
import { env as cloudflareEnv } from 'cloudflare:workers';
import {
  consumeHourlyRateLimit,
  hashRateLimitKey,
  validateApplicationPayload,
  verifyTurnstile,
  type ApplicationData,
  type RateLimitKV,
} from '../../lib/apply-form';
import { sendSmtpMessages, type EmailMessage } from '../../lib/smtp';

export const prerender = false;

const ALLOWED_HOSTNAMES = [
  'digitalgrowthsociety.org',
  'www.digitalgrowthsociety.org',
  'staging.digitalgrowthsociety.org',
  'preview.digitalgrowthsociety.org',
] as const;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function envString(name: string, fallback = '') {
  const runtimeValue = (cloudflareEnv as Record<string, unknown>)[name];
  if (typeof runtimeValue === 'string' && runtimeValue.trim()) return runtimeValue.trim();
  const processValue = process.env[name];
  return typeof processValue === 'string' && processValue.trim() ? processValue.trim() : fallback;
}

function requestOriginHostname(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return '';
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isAllowedOrigin(request: Request) {
  const hostname = requestOriginHostname(request);
  return ALLOWED_HOSTNAMES.includes(hostname as (typeof ALLOWED_HOSTNAMES)[number]);
}

function clientIp(request: Request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] || character);
}

function applicationMessages(data: ApplicationData, fromEmail: string, toEmail: string): EmailMessage[] {
  const cold = data.referrer === 'No one yet';
  const subject = `${cold ? '[Cold] ' : ''}New DGS speaker application — ${data.name}`;
  const hotseat = data.hotseat || 'Not provided';
  const internalText = [
    'A new Digital Growth Society speaker application was submitted.',
    '',
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `LinkedIn or website: ${data.link}`,
    `Who knows them: ${data.referrer}`,
    '',
    'Proposed presentation:',
    data.topic,
    '',
    'Requested hot seat:',
    hotseat,
  ].join('\n');
  const internalHtml = `
    <h1>New DGS speaker application</h1>
    <table cellpadding="8" cellspacing="0" style="border-collapse:collapse">
      <tr><th align="left">Name</th><td>${escapeHtml(data.name)}</td></tr>
      <tr><th align="left">Email</th><td><a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a></td></tr>
      <tr><th align="left">LinkedIn or website</th><td><a href="${escapeHtml(data.link)}">${escapeHtml(data.link)}</a></td></tr>
      <tr><th align="left">Who knows them</th><td>${escapeHtml(data.referrer)}</td></tr>
    </table>
    <h2>Proposed presentation</h2>
    <p>${escapeHtml(data.topic).replace(/\n/g, '<br>')}</p>
    <h2>Requested hot seat</h2>
    <p>${escapeHtml(hotseat).replace(/\n/g, '<br>')}</p>
  `.trim();

  const firstName = data.name.split(/\s+/)[0] || 'there';
  const confirmationText = [
    `Hi ${firstName},`,
    '',
    'Thank you for applying to present to the Digital Growth Society.',
    'A member reads every application. We will review yours and follow up within a few days.',
    '',
    'Your proposed presentation:',
    data.topic,
    '',
    'Digital Growth Society',
    'Greater together.',
  ].join('\n');
  const confirmationHtml = `
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Thank you for applying to present to the Digital Growth Society.</p>
    <p>A member reads every application. We will review yours and follow up within a few days.</p>
    <h2 style="font-size:18px">Your proposed presentation</h2>
    <p>${escapeHtml(data.topic).replace(/\n/g, '<br>')}</p>
    <p>Digital Growth Society<br><strong>Greater together.</strong></p>
  `.trim();

  return [
    {
      fromEmail,
      fromName: 'Digital Growth Society Applications',
      to: toEmail,
      replyTo: data.email,
      subject,
      text: internalText,
      html: internalHtml,
    },
    {
      fromEmail,
      fromName: 'Digital Growth Society',
      to: data.email,
      replyTo: fromEmail,
      subject: 'We received your Digital Growth Society speaker application',
      text: confirmationText,
      html: confirmationHtml,
    },
  ];
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAllowedOrigin(request)) return json({ ok: false, message: 'Origin not allowed.' }, 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json({ ok: false, message: 'Expected a JSON request.' }, 415);
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 20_000) return json({ ok: false, message: 'Application is too large.' }, 413);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, message: 'Invalid JSON request.' }, 400);
  }

  const validation = validateApplicationPayload(payload);
  if (!validation.ok) {
    if (validation.spam) return json({ ok: true, message: validation.message });
    return json({ ok: false, message: validation.message, fields: validation.fields || {} }, validation.status);
  }

  const turnstileSecret = envString('TURNSTILE_SECRET_KEY');
  const smtpPassword = envString('SMTP_PASSWORD');
  const rateLimitSalt = envString('RATE_LIMIT_SALT');
  const rateKv = (cloudflareEnv as Record<string, unknown>).SESSION as RateLimitKV | undefined;
  const missingConfiguration = [
    !turnstileSecret && 'TURNSTILE_SECRET_KEY',
    !smtpPassword && 'SMTP_PASSWORD',
    !rateLimitSalt && 'RATE_LIMIT_SALT',
    !rateKv && 'SESSION',
  ].filter(Boolean);
  if (missingConfiguration.length) {
    console.error('DGS application form runtime configuration is incomplete.', missingConfiguration);
    return json({ ok: false, message: 'Applications are temporarily unavailable. Please try again later.' }, 503);
  }

  const ip = clientIp(request);
  const turnstile = await verifyTurnstile(
    turnstileSecret,
    validation.turnstileToken,
    ip,
    ALLOWED_HOSTNAMES,
  );
  if (!turnstile.success) {
    console.warn('DGS application Turnstile verification failed.', turnstile.errors);
    return json({ ok: false, message: 'The security check could not be verified. Please try again.', fields: { turnstile: 'Complete the security check again.' } }, 422);
  }

  const key = await hashRateLimitKey(ip, rateLimitSalt);
  const rate = await consumeHourlyRateLimit(rateKv!, key);
  if (!rate.allowed) {
    return json(
      { ok: false, message: 'Too many applications were submitted from this connection. Please try again later.' },
      429,
      { 'retry-after': String(rate.retryAfter), 'x-ratelimit-remaining': '0' },
    );
  }

  const fromEmail = envString('APPLY_FROM_EMAIL', 'applications@digitalgrowthsociety.org');
  const toEmail = envString('APPLY_TO_EMAIL', 'applications@digitalgrowthsociety.org');
  try {
    await sendSmtpMessages(
      {
        hostname: envString('SMTP_HOST', 'mail.blissdrive.net'),
        port: Number(envString('SMTP_PORT', '587')),
        username: envString('SMTP_USERNAME', fromEmail),
        password: smtpPassword,
        heloName: 'digitalgrowthsociety.org',
      },
      applicationMessages(validation.data, fromEmail, toEmail),
    );
  } catch (error) {
    console.error('DGS application SMTP delivery failed.', error instanceof Error ? error.message : 'Unknown SMTP error');
    return json({ ok: false, message: 'We could not send your application. Your entries are still here; please try again.' }, 502);
  }

  const firstName = validation.data.name.split(/\s+/)[0] || 'there';
  return json(
    { ok: true, message: `Thanks, ${firstName}. Your application has been received. We will follow up within a few days.` },
    200,
    { 'x-ratelimit-remaining': String(rate.remaining) },
  );
};

export const ALL: APIRoute = () => json({ ok: false, message: 'Method not allowed.' }, 405, { allow: 'POST' });
