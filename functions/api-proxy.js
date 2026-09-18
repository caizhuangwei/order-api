export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  // 获取需要代理的目标地址
  const targetUrl = requestUrl.searchParams.get('url');

  if (!targetUrl) {
    return new Response('缺少 url 参数', { status: 400 });
  }

  // 拼接 Vercel 代理接口
  const vercelProxyUrl = 'https://order-api-a6sv-10kytk5hs-caizhuangwei299.vercel.app/api/proxy?url=' + encodeURIComponent(targetUrl);

  try {
    const res = await fetch(vercelProxyUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const data = await res.text();

    return new Response(data, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      }
    });
  } catch (err) {
    return new Response('代理异常: ' + err.message, { status: 502 });
  }
}
