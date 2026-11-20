const mailbox = /^[a-z0-9][a-z0-9_+.-]*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/** Null means invalid input; an empty array means no override. */
export function parseNotificationRecipients(value: unknown): string[] | null {
  if (value == null) return [];
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) return null;
  if (!value.trim()) return [];
  const addresses = value.split(',').map((item) => item.trim());
  if (addresses.length > 10 || addresses.some((item) => item.length > 254 || item.includes('..') || !mailbox.test(item))) return null;
  const seen = new Set<string>();
  return addresses.filter((address) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function loadNotificationRecipients(
  clientId: string, branch: string, token: string, fallback: string, request: typeof fetch = fetch,
): Promise<string[]> {
  const defaults = parseNotificationRecipients(fallback);
  if (!defaults?.length) throw new Error('Invalid application notification fallback');
  if (!clientId || !token) return defaults;
  try {
    const response = await request(`https://content.tinajs.io/2.4/content/${encodeURIComponent(clientId)}/github/${encodeURIComponent(branch)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': token },
      body: JSON.stringify({ query: 'query ContactNotificationRecipients { config(relativePath: "config.json") { contactForm { notificationRecipients } } }' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(3500),
    });
    if (response.ok) {
      const body = await response.json();
      const recipients = !body.errors?.length && parseNotificationRecipients(body.data?.config?.contactForm?.notificationRecipients);
      if (recipients && recipients.length) return recipients;
    }
  } catch {
    // Keep delivering to the default mailbox if Tina is unavailable.
  }
  return defaults;
}
