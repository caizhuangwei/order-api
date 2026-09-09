// functions/index.js
// 这个文件会处理所有路径：/ , /admin, /view

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // ---------- 从环境变量读取管理员密码 ----------
    const ADMIN_PASSWORD = env.ADMIN_PASSWORD || 'your_secure_password_here';

    // ---------- KV 操作辅助 ----------
    async function getContent() {
        return (await env.REALNAME_STORE.get('content', 'text')) || '';
    }

    async function saveContent(text) {
        await env.REALNAME_STORE.put('content', text);
    }

    // ---------- 买家展示页 ----------
    function renderView(content) {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>实名信息</title>
    <style>
        body { font-family: -apple-system, sans-serif; background: #F2F2F7; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
        .card { background: white; border-radius: 14px; padding: 28px 24px; max-width: 400px; width: 100%; box-shadow: 0 2px 16px rgba(0,0,0,0.04); }
        .title { font-size: 22px; font-weight: 700; margin-bottom: 16px; text-align: center; }
        .content { font-size: 15px; line-height: 1.7; color: #1C1C1E; white-space: pre-wrap; word-break: break-word; }
    </style>
</head>
<body>
    <div class="card">
        <div class="title">📋 实名信息</div>
        <div class="content">${content.replace(/\n/g, '<br>')}</div>
    </div>
</body>
</html>`;
    }

    // ---------- 管理页 ----------
    function renderAdmin(currentContent, errorMsg) {
        const safeContent = currentContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理实名信息</title>
    <style>
        body { font-family: -apple-system, sans-serif; background: #F2F2F7; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
        .card { background: white; border-radius: 14px; padding: 28px 24px; max-width: 400px; width: 100%; box-shadow: 0 2px 16px rgba(0,0,0,0.04); }
        .title { font-size: 20px; font-weight: 700; margin-bottom: 16px; text-align: center; }
        label { display: block; margin: 12px 0 4px; font-weight: 500; }
        input, textarea { width: 100%; padding: 8px; border: 1px solid #E5E5EA; border-radius: 8px; font-family: inherit; font-size: 14px; box-sizing: border-box; }
        textarea { min-height: 150px; resize: vertical; }
        button { margin-top: 16px; width: 100%; padding: 12px; background: #007AFF; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; }
        button:hover { background: #0066D9; }
        .error { color: #FF3B30; margin-top: 8px; font-size: 14px; }
        .preview-link { margin-top: 16px; text-align: center; font-size: 14px; }
        .preview-link a { color: #007AFF; text-decoration: none; }
        .preview-link a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="card">
        <div class="title">✏️ 编辑实名信息</div>
        ${errorMsg ? `<div class="error">${errorMsg}</div>` : ''}
        <form method="POST" action="/admin">
            <label>管理员密码</label>
            <input type="password" name="password" required class="password-field" placeholder="输入密码">
            <label>实名内容（支持换行，直接编辑即可）</label>
            <textarea name="content" rows="6" placeholder="输入要展示的文字...">${safeContent}</textarea>
            <button type="submit">保存更新</button>
        </form>
        <div class="preview-link">
            <a href="/view" target="_blank">📱 预览买家展示页</a>
        </div>
    </div>
</body>
</html>`;
    }

    // ---------- 路由 ----------
    if (path === '/' || path === '/view') {
        const content = await getContent();
        return new Response(renderView(content || '暂无实名信息，请联系管理员。'), {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }

    if (path === '/admin') {
        if (request.method === 'GET') {
            const current = await getContent();
            return new Response(renderAdmin(current, ''), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }

        if (request.method === 'POST') {
            const formData = await request.formData();
            const password = formData.get('password');
            const content = formData.get('content');

            if (password !== ADMIN_PASSWORD) {
                const current = await getContent();
                return new Response(renderAdmin(current, '❌ 密码错误，请重试'), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
            }

            await saveContent(content || '');
            return new Response(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="refresh" content="2;url=/admin">
</head>
<body style="font-family:sans-serif; text-align:center; padding:50px;">
    <h2 style="color:#34C759;">✅ 保存成功！</h2>
    <p>内容已更新，2秒后返回管理页面。</p>
    <p><a href="/view" target="_blank">点击查看买家展示页</a></p>
</body>
</html>`, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
    }

    // 未匹配到路由
    return new Response('Not Found', { status: 404 });
}
