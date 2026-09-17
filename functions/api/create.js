export async function onRequest(context) {
  const { request, env } = context;

  // 跨域与允许方法响应头
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json; charset=utf-8'
  };

  // 处理浏览器预检 OPTIONS 请求
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let order = '';

    // 兼容 POST 请求与 GET 请求
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      order = body.order;
    } else {
      const url = new URL(request.url);
      order = url.searchParams.get('order');
    }

    if (!order || !order.includes('----')) {
      return new Response(JSON.stringify({ error: '订单格式错误，必须为：手机号----链接' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const parts = order.split('----');
    const phone = parts[0].trim();
    const apiUrl = parts[1].trim();

    // 生成 6 位随机短码
    const shortId = Math.random().toString(36).substring(2, 8);

    // 存入 Cloudflare KV（兼容 SMS_KV 或 ORDERS 两种命名）
    const kv = env.SMS_KV || env.ORDERS;
    if (!kv) {
      return new Response(JSON.stringify({ error: '服务端未绑定 KV 命名空间' }), {
        status: 500,
        headers: corsHeaders
      });
    }

    // 设置 1200 秒（20分钟）过期
    await kv.put(shortId, JSON.stringify({ phone, apiUrl }), {
      expirationTtl: 1200
    });

    return new Response(JSON.stringify({ code: 200, id: shortId, phone }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: '处理异常', detail: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
