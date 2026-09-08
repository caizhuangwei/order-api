export async function onRequest(context) {
  const { params } = context;
  const oid = params.oid;

  if (!oid) {
    return new Response('缺少订单号', { status: 400 });
  }

  // 注意：目标必须是用户端页面 index.html，而不是 adminindex.html
  const sid = "24085";        // 你的店铺ID
  const ts = Date.now();      // 动态时间戳，用户端不会严格校验

  const targetUrl = `https://oo55426.pages.dev/index.html?oid=${oid}&sid=${sid}&ts=${ts}`;

  return Response.redirect(targetUrl, 302);
}
