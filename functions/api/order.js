export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // 允许前端跨域
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    if (!env.ORDER_KV) {
        return Response.json({ success: false, error: '后端暂未绑定 KV 数据库' }, { headers: corsHeaders });
    }

    try {
        // 1. 处理 POST 请求：管理端保存数据 (解决超长链接问题)
        if (request.method === 'POST') {
            const body = await request.json();
            
            if (body.action === 'saveSellerLink') {
                if (!body.oid || !body.link || !body.phone) {
                    return Response.json({ success: false, error: '参数不完整' }, { headers: corsHeaders });
                }
                // 存入 KV 数据库，24小时后自动清理
                await env.ORDER_KV.put(body.oid, JSON.stringify({ phone: body.phone, link: body.link }), { expirationTtl: 86400 });
                return Response.json({ success: true }, { headers: corsHeaders });
            }
        }

        // 2. 处理 GET 请求：买家端轮询验证码
        if (request.method === 'GET') {
            const action = url.searchParams.get('action');
            
            if (action === 'getSellerCode') {
                const oid = url.searchParams.get('oid');
                if (!oid) return Response.json({ success: false, error: '缺少 oid' }, { headers: corsHeaders });

                const dataStr = await env.ORDER_KV.get(oid);
                if (!dataStr) return Response.json({ success: false, error: '订单不存在或已过期' }, { headers: corsHeaders });

                const { phone, link } = JSON.parse(dataStr);

                try {
                    // 后端代为请求卖家接口
                    const r = await fetch(link);
                    const sellerRes = await r.json();
                    return Response.json({ success: true, phone, sellerRes }, { headers: corsHeaders });
                } catch (e) {
                    return Response.json({ success: false, phone, error: '代理请求卖家接口失败' }, { headers: corsHeaders });
                }
            }
        }

        return Response.json({ success: false, error: '未知的请求类型' }, { headers: corsHeaders });

    } catch (error) {
        return Response.json({ success: false, error: error.message }, { headers: corsHeaders });
    }
}
