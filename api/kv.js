/* Vercel serverless key store used by Flint & Fire for room codes and the
   WebRTC handshake. Set either KV_REST_API_URL / KV_REST_API_TOKEN (Vercel KV)
   or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN in the project env.

   POST /api/kv  { op: 'get'|'set'|'del', key, value?, ttl? }  ->  { value } */

const URL_  = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(path, body) {
  // Values go in the POST body, never the URL. Save blobs and multiplayer
  // snapshots run to tens of kilobytes and would blow past URL length limits.
  const opts = { headers: { Authorization: `Bearer ${TOKEN}` } };
  if (body !== undefined) { opts.method = 'POST'; opts.body = body; }
  const r = await fetch(`${URL_}/${path}`, opts);
  if (!r.ok) throw new Error(`upstash ${r.status}`);
  return (await r.json()).result;
}

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!URL_ || !TOKEN) return res.status(500).json({ error: 'Key store is not configured' });

  const { op, key, keys, value, ttl } = req.body || {};
  const okKey = k => typeof k === 'string' && /^[A-Za-z0-9:_-]{1,120}$/.test(k);

  // Batch read: one round trip instead of one per key. Halves the request count
  // against the key store, which matters on metered plans.
  if (op === 'mget') {
    if (!Array.isArray(keys) || !keys.length || keys.length > 8 || !keys.every(okKey))
      return res.status(400).json({ error: 'Bad keys' });
    try {
      const values = await redis(`mget/${keys.join('/')}`);
      return res.status(200).json({ values: Array.isArray(values) ? values : [values] });
    } catch (e) {
      return res.status(502).json({ error: String(e.message || e) });
    }
  }

  if (!okKey(key)) return res.status(400).json({ error: 'Bad key' });

  try {
    if (op === 'get')  return res.status(200).json({ value: await redis(`get/${key}`) });
    if (op === 'del')  return res.status(200).json({ value: await redis(`del/${key}`) });
    if (op === 'set') {
      const secs = Math.min(Math.max(parseInt(ttl, 10) || 3600, 30), 86400);
      await redis(`set/${key}?EX=${secs}`, String(value ?? ''));
      return res.status(200).json({ value: 'OK' });
    }
    return res.status(400).json({ error: 'Unknown op' });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
