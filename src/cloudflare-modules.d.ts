declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}

declare module 'cloudflare:sockets' {
  export type Socket = {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    startTls(): Socket;
    close(): Promise<void>;
  };

  export function connect(
    address: { hostname: string; port: number } | string,
    options?: { secureTransport?: 'off' | 'on' | 'starttls'; allowHalfOpen?: boolean },
  ): Socket;
}

interface Window {
  turnstile?: { reset(widgetId?: string | HTMLElement): void };
}