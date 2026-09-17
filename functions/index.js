export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    // 允许前端跨域请求 (CORS)
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
    };

    // 处理预检请求
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    // 安全校验：提示用户绑定 KV 数据库
    if (!env.ORDER_KV) {
        return Response.json(
            { success: false, error: '后端暂未绑定 KV 数据库，请在 Cloudflare 设置' }, 
            { headers: corsHeaders }
        );
    }

    try {
        // ========== 接口 1: 管理端保存订单 ==========
        if (action === 'saveSellerLink') {
            const oid = url.searchParams.get('oid');
            const phone = url.searchParams.get('phone');
            const link = url.searchParams.get('link');

            if (!oid || !link) {
                return Response.json({ success: false, error: '参数不全' }, { headers: corsHeaders });
            }

            // 存入 Cloudflare KV，设置 24小时 (86400秒) 后自动过期清理
            await env.ORDER_KV.put(oid, JSON.stringify({ phone, link }), { expirationTtl: 86400 });

            return Response.json({ success: true }, { headers: corsHeaders });
        }

        // ========== 接口 2: 买家端轮询验证码 ==========
        if (action === 'getSellerCode') {
            const oid = url.searchParams.get('oid');
            if (!oid) return Response.json({ success: false, error: '缺少 oid' }, { headers: corsHeaders });

            // 从 KV 中查出当前订单对应的 手机号 和 卖家链接
            const dataStr = await env.ORDER_KV.get(oid);
            if (!dataStr) {
                return Response.json({ success: false, error: '订单不存在或已过期' }, { headers: corsHeaders });
            }

            const { phone, link } = JSON.parse(dataStr);

            try {
                // 【核心逻辑】：由 Cloudflare 后端代为请求卖家的 http:// 链接，完美避开浏览器的跨域和 HTTPS 拦截
                const r = await fetch(link);
                const sellerRes = await r.json(); 
                
                // 返回给前端
                return Response.json({ success: true, phone, sellerRes }, { headers: corsHeaders });
            } catch (err) {
                // 如果卖家接口没通
                return Response.json({ success: false, phone, error: '代理请求卖家接口失败' }, { headers: corsHeaders });
            }
        }

        return Response.json({ success: false, error: '未知 action' }, { headers: corsHeaders });

    } catch (error) {
        return Response.json({ success: false, error: error.message }, { headers: corsHeaders });
    }
}
