export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const oid = url.searchParams.get('oid');
  const sid = url.searchParams.get('sid') || '24085';

  if (!oid) {
    return jsonResponse({ error: '缺少订单ID' }, 400);
  }

  const HAOZHU = {
    server: 'api.haozhuma.com',
    user: '0d1f0214da0eecc58ba00012056abf8cffbd15763117141296ddc0b5ca9adc7c',
    pass: '4e32e4470173719e9935172c58c31548284d9b1341fe201f5921060810d0571c',
    sid: sid
  };

  const kv = env.ORDERS;

  let tokenStr = await kv.get('__token__');
  if (!tokenStr) {
    const loginResp = await fetch(`https://${HAOZHU.server}/sms/?api=login&user=${HAOZHU.user}&pass=${HAOZHU.pass}`);
    const loginData = await loginResp.json();
    if (loginData.code === 0 || loginData.code === '0') {
      tokenStr = loginData.token || loginData.Token || loginData.access_token;
      await kv.put('__token__', tokenStr, { expirationTtl: 3500 });
    } else {
      return jsonResponse({ error: '登录失败' }, 500);
    }
  }

  try {
    switch (action) {
      case 'status': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) return jsonResponse({ status: 'new', phone: null, expire: null, code: null });
        if (order.expire && order.status === 'active' && Date.now() >= order.expire) {
          order.status = 'expired';
          await kv.put(oid, JSON.stringify(order));
        }
        return jsonResponse(order);
      }

      case 'getPhone': {
        let order = await kv.get(oid, { type: 'json' });
        if (order && order.status === 'done') return jsonResponse({ error: '订单已完成' }, 403);

        // 如果已有手机号（无论是否激活），更新过期时间并激活
        if (order && order.phone) {
          const newExpire = Date.now() + 60 * 1000;
          order.expire = newExpire;
          order.status = 'active';
          await kv.put(oid, JSON.stringify(order));
          return jsonResponse({ phone: order.phone, expire: newExpire });
        }

        // 否则从豪猪获取新号
        const phoneResp = await fetch(`https://${HAOZHU.server}/sms/?api=getPhone&token=${tokenStr}&sid=${HAOZHU.sid}`);
        const phoneData = await phoneResp.json();
        if (phoneData.code === 0 || phoneData.code === '0') {
          const phone = phoneData.phone || phoneData.Phone || phoneData.mobile;
          const newOrder = {
            phone,
            expire: Date.now() + 60 * 1000,
            status: 'active',
            code: null
          };
          await kv.put(oid, JSON.stringify(newOrder));
          return jsonResponse({ phone, expire: newOrder.expire });
        }
        return jsonResponse({ error: phoneData.msg || '取号失败' }, 500);
      }

      case 'setPhone': {
        const phone = url.searchParams.get('phone');
        if (!phone) return jsonResponse({ error: '缺少 phone 参数' }, 400);
        // 只存储手机号，不设置过期时间（expire=0），等待买家点击激活
        const order = {
          phone,
          expire: 0,           // 未激活
          status: 'pending',   // 等待买家点击
          code: null
        };
        await kv.put(oid, JSON.stringify(order));
        return jsonResponse({ success: true, phone });
      }

      case 'release': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) return jsonResponse({ error: '订单不存在' }, 404);
        if (order.status === 'done') return jsonResponse({ error: '订单已完成' }, 403);
        if (order.phone) {
          try { await fetch(`https://${HAOZHU.server}/sms/?api=releasePhone&token=${tokenStr}&sid=${HAOZHU.sid}&phone=${order.phone}`); } catch(e) {}
        }
        order.phone = null;
        order.expire = null;
        order.code = null;
        order.status = 'new';
        await kv.put(oid, JSON.stringify(order));
        return jsonResponse({ success: true });
      }

      case 'getSMS': {
        const order = await kv.get(oid, { type: 'json' });
        if (!order || !order.phone) return jsonResponse({ error: '订单不存在' }, 404);
        const smsResp = await fetch(`https://${HAOZHU.server}/sms/?api=getMessage&token=${tokenStr}&sid=${HAOZHU.sid}&phone=${order.phone}`);
        const smsData = await smsResp.json();
        if (smsData.code === 0 || smsData.code === '0') {
          const raw = smsData.sms || smsData.Sms || smsData.message || smsData.code_text || '';
          // 提取纯数字，且长度至少 4 位
          const digits = raw.replace(/\D/g, '');
          if (digits.length >= 4) {
            order.code = raw; // 可以保留原始内容，但复制时只取数字
            order.status = 'done';
            await kv.put(oid, JSON.stringify(order));
            return jsonResponse({ code: raw, status: 'done' });
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
