// functions/proxy.js
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function onRequest(context) {
  const {request} = context;
  // 处理OPTIONS预检跨域
  if(request.method === "OPTIONS"){
    return new Response(null, { headers:corsHeaders });
  }

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");
  if(!targetUrl) return new Response("缺少url参数，示例：?url=https://baidu.com",{status:400});
  
  try{
    const resp = await fetch(targetUrl);
    const newResp = new Response(resp.body, resp);
    // 添加CORS头，允许前端调用
    Object.entries(corsHeaders).forEach(([k,v])=>{
      newResp.headers.set(k,v);
    })
    return newResp;
  }catch(e){
    return new Response("代理失败："+e.message,{status:500});
  }
}
