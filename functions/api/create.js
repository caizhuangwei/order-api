export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    const { order } = await request.json();
    if (!order || !order.includes('----')) {
      return new Response(JSON.stringify({ error: '订单格式错误' }), { status: 400, headers: corsHeaders });
    }

    const parts = order.split('----');
    const phone = parts[0].trim();
    const apiUrl = parts[1].trim();

    // 生成一个 6 位的随机短码 (如 k7x2m9)
    const shortId = Math.random().toString(36).substring(2, 8);

    // 将手机号和完整链接存入 Cloudflare KV，设置 1200 秒（20分钟）后自动过期删除
    await env.SMS_KV.put(shortId, JSON.stringify({ phone, apiUrl }), {
      expirationTtl: 1200
    });

    return new Response(JSON.stringify({ code: 200, id: shortId, phone }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: '保存失败', detail: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
