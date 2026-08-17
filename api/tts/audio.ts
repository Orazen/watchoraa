import { createHash, randomUUID } from 'node:crypto';
import WebSocket from 'ws';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0`;
const WIN_EPOCH = 11644473600;
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const SYNTH_TIMEOUT_MS = 25_000;

function generateSecMsGec(nowMs: number = Date.now()): string {
  let ticks = nowMs / 1000;
  ticks += WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 1e9 / 100;
  const strToHash = `${Math.round(ticks)}${TRUSTED_CLIENT_TOKEN}`;
  return createHash('sha256').update(strToHash, 'ascii').digest('hex').toUpperCase();
}

let clockSkewSeconds = 0;

function nowMs(): number {
  return Date.now() + clockSkewSeconds * 1000;
}

function parseRfc2616Date(date: string): number | null {
  const ms = Date.parse(date);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

function wssUrl(): string {
  const gec = generateSecMsGec(nowMs());
  return (
    `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
    `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${gec}` +
    `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}` +
    `&ConnectionId=${randomUUID().replaceAll('-', '')}`
  );
}

function wsHeaders(): Record<string, string> {
  return {
    'User-Agent': USER_AGENT,
    Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    Pragma: 'no-cache',
    'Cache-Control': 'no-cache',
    'Sec-MS-GEC': generateSecMsGec(nowMs()),
    'Sec-MS-GEC-Version': SEC_MS_GEC_VERSION,
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

function escXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rateToSsml(rate: number): string {
  const clamped = Math.min(2, Math.max(0.5, rate));
  const pct = Math.round((clamped - 1) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

function synthesizeChunk(text: string, voice: string, rate: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wssUrl(), { headers: wsHeaders() });
    const audio: Buffer[] = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.terminate();
        reject(new Error('TTS synthesis timed out'));
      }
    }, SYNTH_TIMEOUT_MS);

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve(Buffer.concat(audio));
    };

    ws.on('unexpected-response', (_request, response) => {
      const dateHeader = response.headers['date'];
      const serverTime = typeof dateHeader === 'string' ? parseRfc2616Date(dateHeader) : null;
      if (serverTime != null) {
        clockSkewSeconds = serverTime - Date.now() / 1000;
      }
      response.resume();
      finish(new Error(`TTS 403 (skew corrected)`));
    });

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        const s = data.toString('utf8');
        if (s.includes('turn.end')) finish();
        return;
      }
      const buf = data as Buffer;
      const marker = Buffer.from('Path:audio\r\n');
      const idx = buf.indexOf(marker);
      if (idx === -1) return;
      audio.push(buf.subarray(idx + marker.length));
    });

    ws.on('error', (e: Error) => finish(e));
    ws.on('close', () => {
      if (!settled && audio.length > 0) finish();
      else if (!settled) finish(new Error('TTS connection closed'));
    });

    ws.on('open', () => {
      const requestId = randomUUID().replaceAll('-', '');
      const timestamp = new Date().toISOString();
      const configMsg =
        `X-Timestamp:${timestamp}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
                outputFormat: OUTPUT_FORMAT,
              },
            },
          },
        });

      const ssmlRate = rateToSsml(rate);
      const ssml =
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">` +
        `<voice name="${escXml(voice)}">` +
        `<prosody rate="${ssmlRate}" pitch="+0Hz">` +
        `${escXml(text)}` +
        `</prosody>` +
        `</voice>` +
        `</speak>`;

      const ssmlMsg =
        `X-RequestId:${requestId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${timestamp}Z\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;

      ws.send(configMsg, (err) => {
        if (err) finish(err);
        else ws.send(ssmlMsg, (err2) => { if (err2) finish(err2); });
      });
    });
  });
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const text = (req.query.text as string) || 'Hello from Watchora';
  const voice = (req.query.voice as string) || 'en-US-JennyNeural';
  const rate = parseFloat(req.query.rate as string) || 1.0;

  try {
    const audioBuffer = await synthesizeChunk(text, voice, rate);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.status(200).send(audioBuffer);
  } catch (err: any) {
    console.error('Vercel TTS error:', err);
    res.status(500).json({ error: 'TTS synthesis failed', details: err?.message || String(err) });
  }
}
