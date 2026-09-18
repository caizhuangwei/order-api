// functions/proxy.js
// 访问路径：https://order-api.pages.dev/proxy?url=...

const ALLOWED_HOSTS = [
  '54.169.181.40:8082',
  // 以后如果有其他接口域名，加到这里
];

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    });
  }

  if (!target) {
    return json({ error: 'missing url' }, 400);
  }

  // 白名单校验，防 SSRF
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return json({ error: 'invalid url' }, 400);
  }
  if (!ALLOWED_HOSTS.includes(targetUrl.host)) {
    return json({ error: 'host not allowed: ' + targetUrl.host }, 403);
  }

  try {
    const res = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cf: { cacheTtl: 0 },
    });
    const text = await res.text();

    return new Response(text, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return json({ error: 'fetch failed', detail: String(e) }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
