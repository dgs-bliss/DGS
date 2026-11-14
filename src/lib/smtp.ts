import { connect, type Socket } from 'cloudflare:sockets';

export type SmtpConfig = {
  hostname: string;
  port: number;
  username: string;
  password: string;
  heloName: string;
};

export type EmailMessage = {
  fromEmail: string;
  fromName: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
};

const encoder = new TextEncoder();

function utf8Base64(value: string) {
  const bytes = encoder.encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function header(value: string) {
  return `=?UTF-8?B?${utf8Base64(value)}?=`;
}

function messageId(fromEmail: string) {
  const domain = fromEmail.split('@')[1] || 'digitalgrowthsociety.org';
  return `<${crypto.randomUUID()}@${domain}>`;
}

function normalizeLineEndings(value: string) {
  return value.replace(/\r?\n/g, '\r\n');
}

function dotStuff(value: string) {
  return normalizeLineEndings(value).replace(/(^|\r\n)\./g, '$1..');
}

export function buildMimeMessage(message: EmailMessage) {
  const boundary = `dgs-${crypto.randomUUID()}`;
  const lines = [
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId(message.fromEmail)}`,
    `From: ${header(message.fromName)} <${message.fromEmail}>`,
    `To: <${message.to}>`,
    ...(message.replyTo ? [`Reply-To: <${message.replyTo}>`] : []),
    `Subject: ${header(message.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    message.text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    message.html,
    '',
    `--${boundary}--`,
  ];
  return dotStuff(lines.join('\r\n'));
}

class SmtpChannel {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private decoder = new TextDecoder();
  private pending = '';

  constructor(private socket: Socket) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  async command(command: string, expected: number | number[]) {
    await this.writer.write(encoder.encode(`${command}\r\n`));
    return this.reply(expected);
  }

  async data(message: string) {
    await this.writer.write(encoder.encode(`${message}\r\n.\r\n`));
    return this.reply(250);
  }

  async reply(expected: number | number[]) {
    const accepted = Array.isArray(expected) ? expected : [expected];
    let code = 0;
    const lines: string[] = [];
    while (true) {
      const line = await this.readLine();
      lines.push(line);
      const match = /^(\d{3})([ -])/.exec(line);
      if (!match) continue;
      code = Number(match[1]);
      if (match[2] === ' ') break;
    }
    if (!accepted.includes(code)) {
      throw new Error(`SMTP command failed with ${code}: ${lines.join(' | ').slice(0, 500)}`);
    }
    return { code, lines };
  }

  release() {
    this.reader.releaseLock();
    this.writer.releaseLock();
  }

  async close() {
    try {
      await this.command('QUIT', 221);
    } catch {
      // The message has already been accepted; some SMTP servers close before 221.
    }
    this.release();
    await this.socket.close();
  }

  private async readLine(): Promise<string> {
    while (!this.pending.includes('\n')) {
      const { value, done } = await this.reader.read();
      if (done) throw new Error('SMTP connection closed unexpectedly.');
      this.pending += this.decoder.decode(value, { stream: true });
    }
    const index = this.pending.indexOf('\n');
    const line = this.pending.slice(0, index).replace(/\r$/, '');
    this.pending = this.pending.slice(index + 1);
    return line;
  }
}

export async function sendSmtpMessages(config: SmtpConfig, messages: EmailMessage[]) {
  if (!messages.length) return;
  const plainSocket = connect(
    { hostname: config.hostname, port: config.port },
    { secureTransport: 'starttls' },
  );
  let channel = new SmtpChannel(plainSocket);
  await channel.reply(220);
  await channel.command(`EHLO ${config.heloName}`, 250);
  await channel.command('STARTTLS', 220);
  channel.release();

  const secureSocket = plainSocket.startTls();
  channel = new SmtpChannel(secureSocket);
  await channel.command(`EHLO ${config.heloName}`, 250);
  await channel.command('AUTH LOGIN', 334);
  await channel.command(utf8Base64(config.username), 334);
  await channel.command(utf8Base64(config.password), 235);

  for (const message of messages) {
    await channel.command(`MAIL FROM:<${message.fromEmail}>`, 250);
    await channel.command(`RCPT TO:<${message.to}>`, [250, 251]);
    await channel.command('DATA', 354);
    await channel.data(buildMimeMessage(message));
    await channel.command('RSET', 250);
  }

  await channel.close();
}
