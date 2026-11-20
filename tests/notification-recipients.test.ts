import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNotificationRecipients, parseNotificationRecipients } from '../src/lib/notification-recipients.ts';

const fallback = 'applications@example.com';
const reply = (notificationRecipients: unknown) => Response.json({ data: { config: { contactForm: { notificationRecipients } } } });

test('accepts multiple comma-separated addresses and removes duplicates', () => {
  assert.deepEqual(parseNotificationRecipients(' Hello@example.com, sales+site@example.com, hello@example.com '), ['Hello@example.com', 'sales+site@example.com']);
});
test('rejects malformed lists, control characters and excessive recipient counts', () => {
  for (const value of ['not-mail', 'a@example.com,', 'Display <a@example.com>', 'a@example.com\r\nBcc:b@example.com', Array(11).fill('a@example.com').join(',')]) {
    assert.equal(parseNotificationRecipients(value), null);
  }
});
test('reads current recipients from the selected Tina branch', async () => {
  const request: typeof fetch = async (url, options) => {
    assert.equal(url, 'https://content.tinajs.io/2.4/content/test-id/github/fix%2Ftest');
    assert.equal(options?.cache, 'no-store');
    assert.match(String(options?.body), /config\(relativePath:.*notificationRecipients/);
    return reply('hello@example.com, team@example.com');
  };
  assert.deepEqual(await loadNotificationRecipients('test-id', 'fix/test', 'dummy', fallback, request), ['hello@example.com', 'team@example.com']);
});
test('preserves existing destination on blank, invalid, stale schema, HTTP failure or outage', async () => {
  const results = [() => reply(''), () => reply(undefined), () => reply('a@example.com, bad'), () => Response.json({ errors: [{ message: 'Field not indexed' }] }), () => new Response(null, { status: 503 }), () => { throw new Error('offline'); }];
  for (const result of results) assert.deepEqual(await loadNotificationRecipients('id', 'main', 'dummy', fallback, async () => result()), [fallback]);
});
