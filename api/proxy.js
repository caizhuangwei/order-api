export default async function handler(req, res) {
  // 设置跨域响应头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url: targetUrl } = req.query;

  if (!targetUrl) {
    return res.status(400).send('缺少 url 参数');
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const text = await response.text();
    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/plain; charset=utf-8');
    return res.status(response.status).send(text);
  } catch (error) {
    return res.status(502).send('Proxy Error: ' + error.message);
  }
}
