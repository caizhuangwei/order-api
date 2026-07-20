export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const oid = url.searchParams.get('oid');
  const sid = url.searchParams.get('sid') || '24085'; // 项目ID，可从请求传入

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

  // 获取 token（缓存 1 小时）
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

      // ========== 查询订单状态 ==========
      case 'status': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) return jsonResponse({ status: 'new', phone: null, expire: null, code: null });
        if (order.status === 'active' && Date.now() >= order.expire) {
          order.status = 'expired';
          await kv.put(oid, JSON.stringify(order));
        }
        return jsonResponse(order);
      }

      // ========== 获取手机号（自动从豪猪取号） ==========
      case 'getPhone': {
        let order = await kv.get(oid, { type: 'json' });

        // 订单已完成
        if (order && order.status === 'done') {
          return jsonResponse({ error: '订单已完成，无法获取手机号' }, 403);
        }

        // 已有活跃订单且未过期，直接返回已有手机号
        if (order && order.status === 'active' && Date.now() < order.expire) {
          return jsonResponse({ phone: order.phone, expire: order.expire });
        }

        // 如果旧订单已过期，释放旧号
        if (order && order.phone) {
          try {
            await fetch(`https://${HAOZHU.server}/sms/?api=releasePhone&token=${tokenStr}&sid=${HAOZHU.sid}&phone=${order.phone}`);
          } catch (e) {}
        }

        // 调用豪猪获取新手机号
        const phoneResp = await fetch(`https://${HAOZHU.server}/sms/?api=getPhone&token=${tokenStr}&sid=${HAOZHU.sid}`);
        const phoneData = await phoneResp.json();
        if (phoneData.code === 0 || phoneData.code === '0') {
          const phone = phoneData.phone || phoneData.Phone || phoneData.mobile;
          const newOrder = {
            phone,
            expire: Date.now() + 300 * 1000,
            status: 'active',
            code: null
          };
          await kv.put(oid, JSON.stringify(newOrder));
          return jsonResponse({ phone, expire: newOrder.expire });
        }
        return jsonResponse({ error: phoneData.msg || '取号失败' }, 500);
      }

      // ========== 手动设置手机号（管理面板指定号码） ==========
      case 'setPhone': {
        const phone = url.searchParams.get('phone');
        if (!phone) return jsonResponse({ error: '缺少 phone 参数' }, 400);

        // 如果已有活跃订单，可以覆盖（或返回错误，这里选择覆盖）
        const order = {
          phone,
          expire: Date.now() + 300 * 1000,
          status: 'active',
          code: null
        };
        await kv.put(oid, JSON.stringify(order));
        return jsonResponse({ success: true, phone, expire: order.expire });
      }

      // ========== 释放手机号 ==========
      case 'release': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) return jsonResponse({ error: '订单不存在' }, 404);
        if (order.status === 'done') return jsonResponse({ error: '订单已完成，无法释放' }, 403);

        if (order.phone) {
          try {
            await fetch(`https://${HAOZHU.server}/sms/?api=releasePhone&token=${tokenStr}&sid=${HAOZHU.sid}&phone=${order.phone}`);
          } catch (e) {}
        }

        order.phone = null;
        order.expire = null;
        order.code = null;
        // 释放后状态回到 new（可由前端重新获取）
        order.status = 'new';
        await kv.put(oid, JSON.stringify(order));
        return jsonResponse({ success: true });
      }

      // ========== 获取验证码 ==========
      case 'getSMS': {
        const order = await kv.get(oid, { type: 'json' });
        if (!order || !order.phone) return jsonResponse({ error: '订单不存在或无手机号' }, 404);
        const smsResp = await fetch(`https://${HAOZHU.server}/sms/?api=getMessage&token=${tokenStr}&sid=${HAOZHU.sid}&phone=${order.phone}`);
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
