/* Vercel serverless key store used by Flint & Fire for room codes and the
   WebRTC handshake. Set either KV_REST_API_URL / KV_REST_API_TOKEN (Vercel KV)
   or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN in the project env.

   POST /api/kv  { op: 'get'|'set'|'del', key, value?, ttl? }  ->  { value } */

const URL_  = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(path) {
  const r = await fetch(`${URL_}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`upstash ${r.status}`);
  return (await r.json()).result;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!URL_ || !TOKEN) return res.status(500).json({ error: 'Key store is not configured' });

  const { op, key, value, ttl } = req.body || {};
  if (!key || !/^[A-Za-z0-9:_-]{1,120}$/.test(key))
    return res.status(400).json({ error: 'Bad key' });

  try {
    if (op === 'get')  return res.status(200).json({ value: await redis(`get/${key}`) });
    if (op === 'del')  return res.status(200).json({ value: await redis(`del/${key}`) });
    if (op === 'set') {
      const body = encodeURIComponent(String(value ?? ''));
      const secs = Math.min(Math.max(parseInt(ttl, 10) || 3600, 30), 86400);
      await redis(`set/${key}/${body}?EX=${secs}`);
      return res.status(200).json({ value: 'OK' });
    }
    return res.status(400).json({ error: 'Unknown op' });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
