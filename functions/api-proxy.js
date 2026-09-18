export async function onRequest(context) {
  const urlObj = new URL(context.request.url);
  const targetUrl = urlObj.searchParams.get('url');

  if (!targetUrl) {
    return new Response('缺少 url 参数', { status: 400 });
  }

  // 服务端代理给 Vercel 函数，Vercel 再去抓取 IP 端口数据
  const vercelApi = 'https://order-api-a6sv-10kytk5hs-caizhuangwei299.vercel.app/api/proxy?url=' + encodeURIComponent(targetUrl);

  try {
    const res = await fetch(vercelApi, {
      method: 'GET',
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
    return new Response('Proxy Error: ' + err.message, { status: 502 });
  }
}
