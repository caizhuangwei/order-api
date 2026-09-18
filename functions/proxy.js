export async function onRequest(context) {
  const { request } = context;

  // 跨域响应头设置
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };

  // 1. 处理浏览器的预检请求 (OPTIONS)
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 2. 获取前端传过来的 target 目标链接
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("target");

  if (!targetUrl) {
    return new Response("Missing 'target' parameter", { 
      status: 400, 
      headers: corsHeaders 
    });
  }

  try {
    // 3. 代理请求第三方接口
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
        "Accept": "*/*"
      }
    });

    const responseBody = await response.text();

    // 4. 继承原响应头并强制加上 CORS 允许头
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      newHeaders.set(key, value);
    }

    return new Response(responseBody, {
      status: response.status,
      headers: newHeaders
    });
  } catch (err) {
    return new Response(`Proxy Error: ${err.message}`, {
      status: 500,
      headers: corsHeaders
    });
  }
}
