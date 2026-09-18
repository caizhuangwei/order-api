export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const linkId = url.searchParams.get("id");
  if (!linkId) return new Response("缺少id参数", { status: 400 });

  const targetUrl = await env.LINK_KV.get(`link_${linkId}`);
  if (!targetUrl) return new Response("该ID不存在链接", { status: 404 });

  return new Response(JSON.stringify({ url: targetUrl }), {
    headers: { "Content-Type": "application/json" }
  });
}
