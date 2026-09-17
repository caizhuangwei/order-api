export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // 预检请求处理
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method === "POST") {
      try {
        const body = await request.json();
        const targetUrl = body.targetUrl;

        if (!targetUrl) {
          return new Response(JSON.stringify({ error: "Missing targetUrl" }), { 
            status: 400, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        // 设置 10 秒超时，防止目标服务器无响应导致 Worker 挂起
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        // 代为请求接码平台（强制使用 GET）
        const apiResponse = await fetch(targetUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        clearTimeout(timeoutId);

        // 先以文本形式获取，防止因为非 JSON 格式导致解析崩溃
        const responseText = await apiResponse.text();
        
        let responseData;
        try {
          // 尝试解析 JSON
          responseData = JSON.parse(responseText);
        } catch (e) {
          // 如果目标服务器返回的不是 JSON（比如 HTML 报错页），则包装成错误 JSON 返回
          responseData = { 
            error: "目标接口返回了非 JSON 格式数据", 
            originalText: responseText.substring(0, 200) // 截取前200字符用于排查
          };
        }

        // 透传目标服务器的 HTTP 状态码
        return new Response(JSON.stringify(responseData), {
          status: apiResponse.status, 
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json;charset=UTF-8"
          }
        });

      } catch (error) {
        // 处理超时或网络错误
        const errorMsg = error.name === 'AbortError' ? '请求目标接口超时' : error.message;
        return new Response(JSON.stringify({ error: errorMsg }), { 
          status: 500, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};
