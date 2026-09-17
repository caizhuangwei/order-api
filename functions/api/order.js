export default {
  async fetch(request, env, ctx) {
    // 1. 设置跨域头，允许你的前端网页调用这个接口
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*", // 如果想更安全，可以把 * 换成你前端的域名
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // 2. 响应浏览器的预检请求 (OPTIONS)
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 3. 处理前端发来的实际请求 (POST)
    if (request.method === "POST") {
      try {
        // 获取前端传过来的 JSON 数据，里面包含了接码平台的链接
        const body = await request.json();
        const targetUrl = body.targetUrl;

        if (!targetUrl) {
          return new Response("缺少目标链接 targetUrl", { 
            status: 400, 
            headers: corsHeaders 
          });
        }

        // 4. Cloudflare Worker 代为请求接码平台 API
        const apiResponse = await fetch(targetUrl);
        const data = await apiResponse.text(); // 获取返回的纯文本或JSON内容

        // 5. 将接码平台的数据返回给前端
        return new Response(data, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/plain;charset=UTF-8"
          }
        });

      } catch (error) {
        return new Response("后端请求出错: " + error.message, { 
          status: 500, 
          headers: corsHeaders 
        });
      }
    }

    // 其他请求统一返回 404
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};
