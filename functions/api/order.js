export async function onRequest(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const shortId = searchParams.get('id');

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!shortId) {
    return new Response(JSON.stringify({ error: '缺少 id 参数' }), { status: 400, headers: corsHeaders });
  }

  try {
    // 从 KV 中获取订单数据
    const rawData = await env.SMS_KV.get(shortId);
    if (!rawData) {
      return new Response(JSON.stringify({ error: '订单已过期或不存在' }), { status: 404, headers: corsHeaders });
    }

    const { phone, apiUrl } = JSON.parse(rawData);

    // 代理请求接码平台的接口
    const upstreamRes = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const upstreamText = await upstreamRes.text();

    let parsed = null;
    try {
      parsed = JSON.parse(upstreamText);
    } catch (e) {
      parsed = null;
    }

    // 将手机号与最新短信一起返回给前端
    return new Response(JSON.stringify({
      phone: phone,
      raw: parsed || upstreamText
    }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: '拉取短信失败', detail: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
