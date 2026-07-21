export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const oid = url.searchParams.get('oid');
  const sid = url.searchParams.get('sid') || '24085';

  // 除了 pool 相关操作外，其余操作都需要 oid
  if (!oid && action !== 'addPhone' && action !== 'removePhone' && action !== 'poolList') {
    return jsonResponse({ error: '缺少订单ID' }, 400);
  }

  const HAOZHU = {
    server: 'api.haozhuma.com',
    user: '0d1f0214da0eecc58ba00012056abf8cffbd15763117141296ddc0b5ca9adc7c',
    pass: '4e32e4470173719e9935172c58c31548284d9b1341fe201f5921060810d0571c',
    sid: sid
  };

  const kv = env.ORDERS;
  const POOL_KEY = 'phone_pool';   // 号码池存储键

  // 获取豪猪 token（缓存 1 小时）
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

  // ================== 工具函数：号码池读写 ==================
  async function getPool() {
    let pool = await kv.get(POOL_KEY, { type: 'json' });
    return pool || [];   // 数组，元素 { phone, status, oid, expire }
  }

  async function savePool(pool) {
    await kv.put(POOL_KEY, JSON.stringify(pool));
  }

  try {
    switch (action) {

      // ========== 号码池管理（管理员用） ==========
      case 'poolList': {
        const pool = await getPool();
        return jsonResponse({ pool });
      }

      case 'addPhone': {
        const phone = url.searchParams.get('phone');
        if (!phone) return jsonResponse({ error: '缺少 phone 参数' }, 400);
        let pool = await getPool();
        // 检查是否已存在
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

      // ========== 订单状态查询 ==========
      case 'status': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) return jsonResponse({ status: 'new', phone: null, expire: null, code: null });
        if (order.expire && order.status === 'active' && Date.now() >= order.expire) {
          // 超时自动释放（仅限池中的号码）
          if (order.fromPool && order.phone) {
            let pool = await getPool();
            const entry = pool.find(p => p.phone === order.phone);
            if (entry) {
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

      // ========== 获取手机号（从池中随机取） ==========
      case 'getPhone': {
        let order = await kv.get(oid, { type: 'json' });
        if (order && order.status === 'done') return jsonResponse({ error: '订单已完成' }, 403);

        // 已有激活订单，直接返回
        if (order && order.status === 'active' && order.expire && Date.now() < order.expire) {
          return jsonResponse({ phone: order.phone, expire: order.expire });
        }

        // 如果旧订单过期或有待释放号码，先释放
        if (order && order.phone && order.fromPool) {
          let pool = await getPool();
          const entry = pool.find(p => p.phone === order.phone);
          if (entry) {
            entry.status = 'available';
            entry.oid = null;
            entry.expire = null;
            await savePool(pool);
          }
        }

        // 从池中取一个可用号码
        let pool = await getPool();
        const available = pool.filter(p => p.status === 'available');
        if (available.length === 0) return jsonResponse({ error: '当前无可用手机号，请联系管理员' }, 503);

        // 随机选一个
        const chosen = available[Math.floor(Math.random() * available.length)];
        const phone = chosen.phone;
        const expire = Date.now() + 60 * 1000;

        // 更新池状态
        chosen.status = 'in_use';
        chosen.oid = oid;
        chosen.expire = expire;
        await savePool(pool);

        // 更新订单
        const newOrder = {
          phone,
          expire,
          status: 'active',
          code: null,
          fromPool: true        // 标记为池中号码
        };
        await kv.put(oid, JSON.stringify(newOrder));

        return jsonResponse({ phone, expire });
      }

      // ========== 释放手机号（放回池中） ==========
      case 'release': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) return jsonResponse({ error: '订单不存在' }, 404);
        if (order.status === 'done') return jsonResponse({ error: '订单已完成' }, 403);

        if (order.phone && order.fromPool) {
          // 放回池中
          let pool = await getPool();
          const entry = pool.find(p => p.phone === order.phone);
          if (entry) {
            entry.status = 'available';
            entry.oid = null;
            entry.expire = null;
            await savePool(pool);
          }
        } else if (order.phone) {
          // 非池中号码（旧版或手动指定），调用豪猪释放
          try { await fetch(`https://${HAOZHU.server}/sms/?api=releasePhone&token=${tokenStr}&sid=${HAOZHU.sid}&phone=${order.phone}`); } catch(e) {}
        }

        order.phone = null;
        order.expire = null;
        order.code = null;
        order.status = 'new';
        await kv.put(oid, JSON.stringify(order));
        return jsonResponse({ success: true });
      }

      // ========== 获取验证码 ==========
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

      // ========== 管理员手动指定手机号（不走池） ==========
      case 'setPhone': {
        const phone = url.searchParams.get('phone');
        if (!phone) return jsonResponse({ error: '缺少 phone 参数' }, 400);
        const order = {
          phone,
          expire: 0,
          status: 'pending',
          code: null,
          fromPool: false
        };
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
