// 跨域公共响应头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Content-Type': 'application/json; charset=utf-8'
};

// 1. 显式处理 OPTIONS 预检
export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders });
}

// 2. 核心处理逻辑函数
async function handleCreate(request, env) {
  try {
    let order = '';

    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      order = body.order;
    } else {
      const url = new URL(request.url);
      order = url.searchParams.get('order');
    }

    if (!order || !order.includes('----')) {
      return new Response(JSON.stringify({ error: '订单格式错误，必须包含【手机号----链接】' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const parts = order.split('----');
    const phone = parts[0].trim();
    const apiUrl = parts[1].trim();

    // 生成 6 位随机短码
    const shortId = Math.random().toString(36).substring(2, 8);

    // 兼容 SMS_KV 或 ORDERS 两种命名绑定
    const kv = env.SMS_KV || env.ORDERS;
    if (!kv) {
      return new Response(JSON.stringify({ error: '服务端未绑定 KV 命名空间' }), {
        status: 500,
        headers: corsHeaders
      });
    }

    // 存入 KV 并设置 20 分钟（1200 秒）后自动过期
    await kv.put(shortId, JSON.stringify({ phone, apiUrl }), {
      expirationTtl: 1200
    });

    return new Response(JSON.stringify({ code: 200, id: shortId, phone }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: '服务端异常', detail: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}

// 3. 显式导出 POST 处理函数（Cloudflare Pages 核心规范）
export async function onRequestPost(context) {
  return handleCreate(context.request, context.env);
}

// 4. 显式导出 GET 处理函数
export async function onRequestGet(context) {
  return handleCreate(context.request, context.env);
}

// 5. 兜底全能处理函数
export async function onRequest(context) {
  return handleCreate(context.request, context.env);
}
