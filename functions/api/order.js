export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const oid = url.searchParams.get('oid');

  if (!oid) {
    return new Response(JSON.stringify({ error: '缺少订单ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // 豪猪配置
  const HAOZHU = {
    server: 'api.haozhuma.com',
    user: '0d1f0214da0eecc58ba00012056abf8cffbd15763117141296ddc0b5ca9adc7c',
    pass: '4e32e4470173719e9935172c58c31548284d9b1341fe201f5921060810d0571c',
    sid: '24085'
  };

  const kv = env.ORDERS;

  // 获取 token（缓存 1 小时）
  let token = await env.TOKENS.get('token', { type: 'json' });
  if (!token || Date.now() > token.expire) {
    const loginResp = await fetch(`https://${HAOZHU.server}/sms/?api=login&user=${HAOZHU.user}&pass=${HAOZHU.pass}`);
    const loginData = await loginResp.json();
    if (loginData.code === 0 || loginData.code === '0') {
      token = {
        value: loginData.token || loginData.Token || loginData.access_token,
        expire: Date.now() + 3500000
      };
      await env.TOKENS.put('token', JSON.stringify(token));
    } else {
      return new Response(JSON.stringify({ error: '登录失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }

  try {
    switch (action) {
      case 'status': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) {
          return jsonResponse({ status: 'new', phone: null, expire: null, code: null });
        }
        if (order.status === 'active' && Date.now() >= order.expire) {
          order.status = 'expired';
          await kv.put(oid, JSON.stringify(order));
        }
        return jsonResponse(order);
      }

      case 'getPhone': {
        let order = await kv.get(oid, { type: 'json' });
        if (order && order.status === 'active' && Date.now() < order.expire) {
          return jsonResponse({ phone: order.phone, expire: order.expire });
        }
        const phoneResp = await fetch(`https://${HAOZHU.server}/sms/?api=getPhone&token=${token.value}&sid=${HAOZHU.sid}`);
        const phoneData = await phoneResp.json();
        if (phoneData.code === 0 || phoneData.code === '0') {
          const phone = phoneData.phone || phoneData.Phone || phoneData.mobile;
          order = {
            phone,
            expire: Date.now() + 300 * 1000,
            status: 'active',
            code: null
          };
          await kv.put(oid, JSON.stringify(order));
          return jsonResponse({ phone, expire: order.expire });
        }
        return jsonResponse({ error: phoneData.msg || '取号失败' }, 500);
      }

      case 'release': {
        const order = await kv.get(oid, { type: 'json' });
        if (order && order.phone) {
          await fetch(`https://${HAOZHU.server}/sms/?api=releasePhone&token=${token.value}&sid=${HAOZHU.sid}&phone=${order.phone}`);
          await kv.delete(oid);
        }
        return jsonResponse({ success: true });
      }

      case 'getSMS': {
        const order = await kv.get(oid, { type: 'json' });
        if (!order || !order.phone) {
          return jsonResponse({ error: '订单不存在' }, 404);
        }
        const smsResp = await fetch(`https://${HAOZHU.server}/sms/?api=getMessage&token=${token.value}&sid=${HAOZHU.sid}&phone=${order.phone}`);
        const smsData = await smsResp.json();
        if (smsData.code === 0 || smsData.code === '0') {
          const code = smsData.sms || smsData.Sms || smsData.message || smsData.code_text;
          if (code) {
            order.code = code;
            order.status = 'done';
            await kv.put(oid, JSON.stringify(order));
            return jsonResponse({ code, status: 'done' });
          }
        }
        return jsonResponse({ code: null, status: 'active' });
      }

      default:
        return jsonResponse({ error: '未知操作' }, 400);
    }
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
