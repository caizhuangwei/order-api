export async function onRequest(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!id) {
    return new Response(JSON.stringify({ error: '缺少 id 参数' }), { status: 400, headers: corsHeaders });
  }

  try {
    // 从 KV 读取订单信息
    const orderData = await env.ORDER_KV.get(id);
    if (!orderData) {
      return new Response(JSON.stringify({ error: '订单不存在或已过期' }), { status: 404, headers: corsHeaders });
    }

    const { phone, api } = JSON.parse(orderData);

    // 代理请求接码平台
    const res = await fetch(api, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    const data = await res.text();

    // 返回 phone 和原始短信内容，方便前端展示
    return new Response(JSON.stringify({ phone, sms: data }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: '请求接码平台超时或失败', detail: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
