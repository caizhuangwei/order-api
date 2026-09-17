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
          return new Response("Missing targetUrl", { status: 400, headers: corsHeaders });
        }

        // 代为请求接码平台
        const apiResponse = await fetch(targetUrl);
        const data = await apiResponse.text();

        return new Response(data, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json;charset=UTF-8"
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { 
          status: 500, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};
