export default {
  async fetch(request, env, ctx) {
    // 统一的跨域头部，允许所有域名请求
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // 1. 处理浏览器的预检请求（OPTIONS）
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. 只接受 POST 请求
    if (request.method === "POST") {
      try {
        const body = await request.json();
        const targetUrl = body.targetUrl;

        // 参数校验
        if (!targetUrl) {
          return new Response(JSON.stringify({ error: "Missing targetUrl" }), { 
            status: 400, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        // 3. 设置 10 秒超时，防止目标服务器不响应导致 Cloudflare 卡死
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        // 4. 代为请求接码平台（附带一个伪装 UA，防止被某些服务器直接拦截）
        const apiResponse = await fetch(targetUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        
        clearTimeout(timeoutId);

        // 5. 先以纯文本获取响应，防止非 JSON 格式导致 JSON.parse 崩溃
        const responseText = await apiResponse.text();
        
        let responseData;
        try {
          responseData = JSON.parse(responseText);
        } catch (e) {
          // 如果目标服务器返回的不是 JSON（比如 NGINX 502 报错页），包装成统一格式返回
          responseData = { 
            error: "接码平台返回了非 JSON 数据",
            originalText: responseText.substring(0, 100) // 截取前100字方便排查
          };
        }

        // 6. 将接码平台的状态码和内容原样透传给前端
        return new Response(JSON.stringify(responseData), {
          status: 200, // 这里强制返回 200，让前端根据 JSON 里的 error 字段自行判断
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json;charset=UTF-8"
          }
        });

      } catch (error) {
        // 7. 捕获超时或网络错误
        const errorMsg = error.name === 'AbortError' ? '请求接码平台超时（网络不通）' : error.message;
        return new Response(JSON.stringify({ error: errorMsg }), { 
          status: 500, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }
    }

    // 3. 其他请求返回 404
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};
