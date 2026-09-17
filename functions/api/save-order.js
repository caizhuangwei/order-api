export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: '仅支持 POST' }), { status: 405, headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const { phone, api } = body;
    if (!phone || !api) {
      return new Response(JSON.stringify({ error: '缺少 phone 或 api' }), { status: 400, headers: corsHeaders });
    }

    // 生成 8 位随机短 ID
    const id = Math.random().toString(36).substring(2, 10);
    // 存入 KV，设置 7 天过期（604800 秒），可按需调整
    await env.ORDER_KV.put(id, JSON.stringify({ phone, api }), { expirationTtl: 604800 });

    return new Response(JSON.stringify({ id }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: '保存失败', detail: err.message }), { status: 500, headers: corsHeaders });
  }
}
