export async function onRequest(context) {
  const { params } = context; // 获取路径参数
  const oid = params.oid; // 订单ID

  // 这里可以根据 oid 查询数据库或硬编码映射，获取完整的 sid 和 ts
  // 示例：假设 sid 和 ts 是固定的，或者你可以从环境变量获取
  const sid = "24085"; // 你的店铺ID
  const ts = Date.now(); // 或者用固定值，但最好用当前时间戳防止缓存

  // 拼接完整链接
  const targetUrl = `https://oo55426.pages.dev/adminindex.html?oid=${oid}&sid=${sid}&ts=${ts}`;

  // 返回 302 重定向
  return Response.redirect(targetUrl, 302);
}
