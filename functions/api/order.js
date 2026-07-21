export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const oid = url.searchParams.get('oid');
  const sid = url.searchParams.get('sid') || '24085';

  if (!oid && action !== 'addPhone' && action !== 'removePhone' && action !== 'poolList' && action !== 'resetPool' && action !== 'releasePoolPhone') {
    return jsonResponse({ error: '缺少订单ID' }, 400);
  }

  const HAOZHU = {
    server: 'api.haozhuma.com',
    user: '0d1f0214da0eecc58ba00012056abf8cffbd15763117141296ddc0b5ca9adc7c',
    pass: '4e32e4470173719e9935172c58c31548284d9b1341fe201f5921060810d0571c',
    sid: sid
  };

  const kv = env.ORDERS;
  const POOL_KEY = 'phone_pool';

  async function getPool() {
    const pool = await kv.get(POOL_KEY, { type: 'json' });
    return pool || [];
  }
  async function savePool(pool) {
    await kv.put(POOL_KEY, JSON.stringify(pool));
  }

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

      // ========== 号码池管理 ==========
      case 'poolList': {
        const pool = await getPool();
        return jsonResponse({ pool });
      }

      case 'addPhone': {
        const phone = url.searchParams.get('phone');
        if (!phone) return jsonResponse({ error: '缺少 phone 参数' }, 400);
        let pool = await getPool();
        if (pool.some(p => p.phone === phone)) {
          return jsonResponse({ error: '该号码已在池中' }, 400);
        }
        pool.push({ phone, status: 'available', oid: null, expire: null });
        await savePool(pool);
        return jsonResponse({ success: true });
      }

      case 'removePhone': {
        const phone = url.searchParams.get('phone');
        if (!phone) return jsonResponse({ error: '缺少 phone 参数' }, 400);
        let pool = await getPool();
        pool = pool.filter(p => p.phone !== phone);
        await savePool(pool);
        return jsonResponse({ success: true });
      }

      case 'resetPool': {
        let pool = await getPool();
        for (const p of pool) {
          if (p.status === 'in_use' && p.oid) {
            let order = await kv.get(p.oid, { type: 'json' });
            if (order && order.status === 'active') {
              order.status = 'released';
              order.phone = null;
              order.expire = null;
              await kv.put(p.oid, JSON.stringify(order));
            }
            p.status = 'available';
            p.oid = null;
            p.expire = null;
          }
        }
        await savePool(pool);
        return jsonResponse({ success: true });
      }

      case 'releasePoolPhone': {
        const phone = url.searchParams.get('phone');
        if (!phone) return jsonResponse({ error: '缺少 phone 参数' }, 400);
        let pool = await getPool();
        const entry = pool.find(p => p.phone === phone);
        if (!entry) return jsonResponse({ error: '号码不在池中' }, 404);
        if (entry.status !== 'in_use') return jsonResponse({ error: '该号码未被占用' }, 400);
        if (entry.oid) {
          let order = await kv.get(entry.oid, { type: 'json' });
          if (order && order.status === 'active') {
            order.status = 'released';
            order.phone = null;
            order.expire = null;
            await kv.put(entry.oid, JSON.stringify(order));
          }
        }
        entry.status = 'available';
        entry.oid = null;
        entry.expire = null;
        await savePool(pool);
        return jsonResponse({ success: true });
      }

      // ========== 订单状态 ==========
      case 'status': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) return jsonResponse({ status: 'new', phone: null, expire: null, code: null });
        if (order.expire && order.status === 'active' && Date.now() >= order.expire) {
          if (order.fromPool && order.phone) {
            let pool = await getPool();
            const entry = pool.find(p => p.phone === order.phone);
            if (entry && entry.status === 'in_use') {
              entry.status = 'available';
              entry.oid = null;
              entry.expire = null;
              await savePool(pool);
            }
          }
          order.status = 'expired';
          await kv.put(oid, JSON.stringify(order));
        }
        return jsonResponse(order);
      }

      // ========== 获取手机号（池优先） ==========
      case 'getPhone': {
        let order = await kv.get(oid, { type: 'json' });

        if (order && order.status === 'done')
          return jsonResponse({ error: '订单已完成' }, 403);
        if (order && order.status === 'released')
          return jsonResponse({ error: '订单已被管理员释放，请联系卖家' }, 403);

        // 已有有效活跃订单 → 直接返回
        if (order && order.status === 'active' && order.expire && Date.now() < order.expire) {
          return jsonResponse({ phone: order.phone, expire: order.expire });
        }

        // 如果之前有池号码，先回池（避免泄漏）
        if (order && order.phone && order.fromPool) {
          let pool = await getPool();
          const entry = pool.find(p => p.phone === order.phone);
          if (entry && entry.status === 'in_use') {
            entry.status = 'available';
            entry.oid = null;
            entry.expire = null;
            await savePool(pool);
          }
        }

        // 1. 尝试从号码池获取
        let pool = await getPool();
        const available = pool.filter(p => p.status === 'available');
        if (available.length > 0) {
          const chosen = available[Math.floor(Math.random() * available.length)];
          const phone = chosen.phone;
          const expire = Date.now() + 60 * 1000;

          chosen.status = 'in_use';
          chosen.oid = oid;
          chosen.expire = expire;
          await savePool(pool);          // ✅ 关键保存

          const newOrder = {
            phone,
            expire,
            status: 'active',
            code: null,
            fromPool: true
          };
          await kv.put(oid, JSON.stringify(newOrder));
          return jsonResponse({ phone, expire });
        }

        // 2. 池空 → 调用豪猪
        const phoneResp = await fetch(`https://${HAOZHU.server}/sms/?api=getPhone&token=${tokenStr}&sid=${HAOZHU.sid}`);
        const phoneData = await phoneResp.json();
        if (phoneData.code === 0 || phoneData.code === '0') {
          const phone = phoneData.phone || phoneData.Phone || phoneData.mobile;
          const newOrder = {
            phone,
            expire: Date.now() + 60 * 1000,
            status: 'active',
            code: null,
            fromPool: false
          };
          await kv.put(oid, JSON.stringify(newOrder));
          return jsonResponse({ phone, expire: newOrder.expire });
        }
        return jsonResponse({ error: phoneData.msg || '取号失败' }, 500);
      }

      // ========== 买家释放（状态 → new，可重新获取） ==========
      case 'release': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) return jsonResponse({ error: '订单不存在' }, 404);
        if (order.status === 'done') return jsonResponse({ error: '订单已完成' }, 403);

        if (order.phone && order.fromPool) {
          let pool = await getPool();
          const entry = pool.find(p => p.phone === order.phone);
          if (entry) {
            entry.status = 'available';
            entry.oid = null;
            entry.expire = null;
            await savePool(pool);
          }
        } else if (order.phone) {
          try { await fetch(`https://${HAOZHU.server}/sms/?api=releasePhone&token=${tokenStr}&sid=${HAOZHU.sid}&phone=${order.phone}`); } catch(e) {}
        }

        order.status = 'new';
        order.phone = null;
        order.expire = null;
        order.code = null;
        await kv.put(oid, JSON.stringify(order));
        return jsonResponse({ success: true });
      }

      // ========== 获取验证码（数字长度 ≥ 4） ==========
      case 'getSMS': {
        const order = await kv.get(oid, { type: 'json' });
        if (!order || !order.phone) return jsonResponse({ error: '订单不存在' }, 404);
        const smsResp = await fetch(`https://${HAOZHU.server}/sms/?api=getMessage&token=${tokenStr}&sid=${HAOZHU.sid}&phone=${order.phone}`);
        const smsData = await smsResp.json();
        if (smsData.code === 0 || smsData.code === '0') {
          const raw = smsData.sms || smsData.Sms || smsData.message || smsData.code_text || '';
          const digits = raw.replace(/\D/g, '');
          if (digits.length >= 4) {
            order.code = raw;
            order.status = 'done';
            await kv.put(oid, JSON.stringify(order));
            return jsonResponse({ code: raw, status: 'done' });
          }
        }
        return jsonResponse({ code: null, status: 'active' });
      }

      // ========== 管理员手动指定手机号 ==========
      case 'setPhone': {
        const phone = url.searchParams.get('phone');
        if (!phone) return jsonResponse({ error: '缺少 phone 参数' }, 400);
        const order = { phone, expire: 0, status: 'pending', code: null, fromPool: false };
        await kv.put(oid, JSON.stringify(order));
        return jsonResponse({ success: true });
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
