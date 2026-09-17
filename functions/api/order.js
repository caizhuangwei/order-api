export async function onRequest(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!id) {
    return new Response(JSON.stringify({ error: '缺少 id 参数' }), { status: 400, headers: corsHeaders });
  }

  try {
    const orderData = await env.ORDER_KV.get(id);
    if (!orderData) {
      return new Response(JSON.stringify({ error: '订单不存在或已过期' }), { status: 404, headers: corsHeaders });
    }

    const { phone, api } = JSON.parse(orderData);

    // 纯净转发，不加任何多余参数
    const res = await fetch(api, {
      cf: {
        cacheTtl: 0,
        cacheEverything: false
      }
    });

    const data = await res.text();

    return new Response(data, {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: '请求接码平台失败', detail: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
