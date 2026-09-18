export async function onRequest(context) {
  const url = new URL(context.request.url);
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response('缺少 url 参数', { status: 400 });
  }

  // 拼接 Vercel 代理地址（Cloudflare 服务器在海外，它可以直连 Vercel）
  const vercelProxy = 'https://order-api-a6sv-efz52366g-caizhuangwei299.vercel.app/api/proxy?url=' + encodeURIComponent(targetUrl);

  try {
    const res = await fetch(vercelProxy, {
      method: context.request.method,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    const data = await res.text();

    return new Response(data, {
      status: res.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': res.headers.get('Content-Type') || 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    return new Response('中转失败: ' + err.message, { status: 502 });
  }
}
