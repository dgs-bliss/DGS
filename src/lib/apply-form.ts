export const APPLICATION_REFERRERS = [
  'Richard Fong',
  'Chris Koszo',
  'Andrew Ansley',
  'Brian Winum',
  'Chris Castillo',
  'Chas Henry',
  'Chris Labbate',
  'Cory Hubbell',
  'Mike Merlino',
  'Brian Kato',
  'Brian Hong',
  'Simon Cornelius',
  'A past guest or advisor',
  'We met at an event',
  'No one yet',
] as const;

export type ApplicationData = {
  name: string;
  email: string;
  link: string;
  referrer: string;
  topic: string;
  hotseat: string;
};

export type ValidationResult =
  | { ok: true; data: ApplicationData; turnstileToken: string }
  | { ok: false; status: number; message: string; fields?: Record<string, string>; spam?: boolean };

const FIELD_LIMIT = 2_000;
const MIN_SUBMISSION_MS = 3_000;
const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1_000;

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateApplicationPayload(payload: unknown, now = Date.now()): ValidationResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, status: 400, message: 'Invalid application payload.' };
  }

  const input = payload as Record<string, unknown>;
  const honeypot = text(input.company_website);
  if (honeypot) {
    return { ok: false, status: 200, message: 'Application received.', spam: true };
  }

  const fields: Record<string, string> = {};
  const values = {
    name: text(input.name),
    email: text(input.email).toLowerCase(),
    link: text(input.link),
    referrer: text(input.referrer),
    topic: text(input.topic),
    hotseat: text(input.hotseat),
  };

  for (const [name, value] of Object.entries(values)) {
    if (value.length > FIELD_LIMIT) fields[name] = `Must be ${FIELD_LIMIT.toLocaleString()} characters or fewer.`;
  }

  if (values.name.length < 2 || values.name.length > 100 || /[\r\n]/.test(values.name)) {
    fields.name = 'Enter your name using 2–100 characters.';
  }
  if (values.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email) || /[\r\n]/.test(values.email)) {
    fields.email = 'Enter a valid email address.';
  }
  try {
    const url = new URL(values.link);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  } catch {
    fields.link = 'Enter a complete LinkedIn or website URL beginning with http:// or https://.';
  }
  if (!(APPLICATION_REFERRERS as readonly string[]).includes(values.referrer)) {
    fields.referrer = 'Choose who in the group knows you.';
  }
  if (values.topic.length < 10 || values.topic.length > FIELD_LIMIT) {
    fields.topic = `Describe your proposed presentation using 10–${FIELD_LIMIT.toLocaleString()} characters.`;
  }

  const startedAt = Number(input.form_started_at);
  if (!Number.isFinite(startedAt) || startedAt <= 0 || now - startedAt > MAX_FORM_AGE_MS) {
    return { ok: false, status: 400, message: 'This form session expired. Refresh the page and try again.' };
  }
  if (now - startedAt < MIN_SUBMISSION_MS) {
    return { ok: false, status: 429, message: 'Please take a moment to review your application before submitting.' };
  }

  const turnstileToken = text(input['cf-turnstile-response']);
  if (!turnstileToken) {
    fields.turnstile = 'Complete the security check.';
  }

  if (Object.keys(fields).length) {
    return { ok: false, status: 422, message: 'Please correct the highlighted fields.', fields };
  }

  return { ok: true, data: values, turnstileToken };
}

export type RateLimitKV = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

export async function hashRateLimitKey(ip: string, salt: string) {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function consumeHourlyRateLimit(
  kv: RateLimitKV,
  key: string,
  now = Date.now(),
  limit = 5,
): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  const storageKey = `dgs-apply-rate:v1:${key}`;
  const hour = 60 * 60 * 1_000;
  let state = { windowStartedAt: now, count: 0 };
  const current = await kv.get(storageKey);
  if (current) {
    try {
      const parsed = JSON.parse(current) as { windowStartedAt?: number; count?: number };
      if (
        Number.isFinite(parsed.windowStartedAt) &&
        Number.isFinite(parsed.count) &&
        now - Number(parsed.windowStartedAt) < hour
      ) {
        state = { windowStartedAt: Number(parsed.windowStartedAt), count: Number(parsed.count) };
      }
    } catch {
      // Invalid/expired limiter data starts a fresh window.
    }
  }

  const retryAfter = Math.max(1, Math.ceil((state.windowStartedAt + hour - now) / 1_000));
  if (state.count >= limit) return { allowed: false, remaining: 0, retryAfter };

  state.count += 1;
  await kv.put(storageKey, JSON.stringify(state), { expirationTtl: retryAfter });
  return { allowed: true, remaining: Math.max(0, limit - state.count), retryAfter };
}

export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string,
  expectedHostnames: readonly string[],
  fetcher: typeof fetch = fetch,
) {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp && remoteIp !== 'unknown') body.set('remoteip', remoteIp);
  const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  if (!response.ok) return { success: false, errors: ['verification-unavailable'] };
  const result = (await response.json()) as {
    success?: boolean;
    hostname?: string;
    'error-codes'?: string[];
  };
  const hostname = String(result.hostname || '').toLowerCase();
  const testSecret = '1x0000000000000000000000000000000AA';
  const hostnameAllowed = secret === testSecret
    ? hostname === 'dummy-key-pass'
    : expectedHostnames.map((item) => item.toLowerCase()).includes(hostname);
  return {
    success: result.success === true && hostnameAllowed,
    errors: result['error-codes'] || (hostnameAllowed ? [] : ['hostname-mismatch']),
  };
}
