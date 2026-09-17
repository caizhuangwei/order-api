export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // 必须处理 OPTIONS 预检请求，否则浏览器会拦截
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
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

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const apiResponse = await fetch(targetUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0' }
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
        const errorMsg = error.name === 'AbortError' ? '请求接码平台超时' : error.message;
        return new Response(JSON.stringify({ error: errorMsg }), { 
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }
    }
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};
