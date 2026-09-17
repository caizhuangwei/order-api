export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // 🔴 关键：必须处理 OPTIONS 预检请求，否则浏览器会直接报 CORS 错误
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method === "POST") {
      try {
        const body = await request.json();
        const targetUrl = body.targetUrl;

        if (!targetUrl) {
          return new Response(JSON.stringify({ error: "Missing targetUrl" }), { 
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        // 设置 10 秒超时，防止卡死
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        // 代请求接码平台
        const apiResponse = await fetch(targetUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        
        clearTimeout(timeoutId);
        const responseText = await apiResponse.text();
        
        let responseData;
        try {
          responseData = JSON.parse(responseText);
        } catch (e) {
          responseData = { error: "接码平台返回了非 JSON 数据", originalText: responseText.substring(0, 100) };
        }

        return new Response(JSON.stringify(responseData), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json;charset=UTF-8" }
        });

      } catch (error) {
        const errorMsg = error.name === 'AbortError' ? '请求接码平台超时（可能是国内IP拦截了海外节点）' : error.message;
        return new Response(JSON.stringify({ error: errorMsg }), { 
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }
    }
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};
