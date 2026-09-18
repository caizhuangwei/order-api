// api/proxy.js
// Vercel 访问路径：https://order-api-beta.vercel.app/api/proxy?url=...

const ALLOWED_HOSTS = ['54.169.181.40:8082'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'missing url' });

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return res.status(400).json({ error: 'invalid url' });
  }

  if (!ALLOWED_HOSTS.includes(targetUrl.host)) {
    return res.status(403).json({ error: 'host not allowed: ' + targetUrl.host });
  }

  try {
    const r = await fetch(targetUrl.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const text = await r.text();
    res.status(r.status);
    res.setHeader(
      'Content-Type',
      r.headers.get('content-type') || 'application/json; charset=utf-8'
    );
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: 'fetch failed', detail: String(e) });
  }
}
