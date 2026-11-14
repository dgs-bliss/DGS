import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeHourlyRateLimit,
  validateApplicationPayload,
  verifyTurnstile,
  type RateLimitKV,
} from '../src/lib/apply-form.ts';

const now = 1_800_000_000_000;
const valid = {
  name: 'Test Applicant',
  email: 'applicant@example.com',
  link: 'https://example.com/profile',
  referrer: 'No one yet',
  topic: 'A practical workflow that is working right now.',
  hotseat: 'Improving agency operations.',
  company_website: '',
  form_started_at: now - 5_000,
  'cf-turnstile-response': 'token',
};

test('accepts a valid application', () => {
  const result = validateApplicationPayload(valid, now);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.email, 'applicant@example.com');
});

test('rejects a submission made in under three seconds', () => {
  const result = validateApplicationPayload({ ...valid, form_started_at: now - 2_999 }, now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 429);
});

test('silently accepts the honeypot without delivering', () => {
  const result = validateApplicationPayload({ ...valid, company_website: 'spam.example' }, now);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 200);
    assert.equal(result.spam, true);
  }
});

test('returns field-specific validation errors', () => {
  const result = validateApplicationPayload({ ...valid, email: 'bad', link: 'javascript:alert(1)', topic: 'short' }, now);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 422);
    assert.deepEqual(Object.keys(result.fields || {}).sort(), ['email', 'link', 'topic']);
  }
});

test('enforces five submissions in an hour', async () => {
  const values = new Map<string, string>();
  const kv: RateLimitKV = {
    async get(key) { return values.get(key) || null; },
    async put(key, value) { values.set(key, value); },
  };
  for (let count = 1; count <= 5; count += 1) {
    const result = await consumeHourlyRateLimit(kv, 'ip-hash', now + count);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 5 - count);
  }
  const blocked = await consumeHourlyRateLimit(kv, 'ip-hash', now + 6);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  const reopened = await consumeHourlyRateLimit(kv, 'ip-hash', now + 3_600_001);
  assert.equal(reopened.allowed, true);
});

test('requires a successful Turnstile result for an allowed hostname', async () => {
  const success = await verifyTurnstile(
    'secret',
    'token',
    '203.0.113.10',
    ['staging.digitalgrowthsociety.org'],
    async () => new Response(JSON.stringify({ success: true, hostname: 'staging.digitalgrowthsociety.org' }), { status: 200 }),
  );
  assert.equal(success.success, true);

  const wrongHost = await verifyTurnstile(
    'secret',
    'token',
    '203.0.113.10',
    ['staging.digitalgrowthsociety.org'],
    async () => new Response(JSON.stringify({ success: true, hostname: 'evil.example' }), { status: 200 }),
  );
  assert.equal(wrongHost.success, false);
});
