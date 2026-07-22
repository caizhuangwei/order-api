export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const oid = url.searchParams.get('oid');
  const sid = url.searchParams.get('sid') || '24085';

  const poolActions = ['addPhone', 'removePhone', 'poolList', 'resetPool', 'releasePoolPhone', 'logList'];
  if (!oid && !poolActions.includes(action)) {
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
  const LOG_KEY = 'phone_logs';

  async function getPool() { const p = await kv.get(POOL_KEY, { type: 'json' }); return p || []; }
  async function savePool(pool) { await kv.put(POOL_KEY, JSON.stringify(pool)); }

  async function getLogs() { const logs = await kv.get(LOG_KEY, { type: 'json' }); return logs || []; }
  async function saveLogs(logs) {
    if (logs.length > 100) logs = logs.slice(-100);
    await kv.put(LOG_KEY, JSON.stringify(logs));
  }
  async function addLog(phone, oid) {
    const logs = await getLogs();
    logs.push({ phone, oid, time: new Date().toISOString() });
    await saveLogs(logs);
  }

  let tokenData = await kv.get('__token_data__', { type: 'json' });
  let tokenStr = tokenData ? tokenData.token : null;
  let tokenExpiry = tokenData ? tokenData.expire : 0;

  if (!tokenStr || Date.now() >= tokenExpiry - 300000) {
    const loginResp = await fetch(`https://${HAOZHU.server}/sms/?api=login&user=${HAOZHU.user}&pass=${HAOZHU.pass}`);
    const loginData = await loginResp.json();
    if (loginData.code == 0) {
      tokenStr = loginData.token || loginData.Token || loginData.access_token;
      tokenExpiry = Date.now() + 3500000;
      await kv.put('__token_data__', JSON.stringify({ token: tokenStr, expire: tokenExpiry }));
    } else {
      return jsonResponse({ error: '登录失败' }, 500);
    }
  }

  try {
    switch (action) {

      // ========== 号码池管理（仅显示可用号码） ==========
      case 'poolList': {
        const pool = await getPool();
        // 只返回 available 的号码（可用号码）
        const available = pool.filter(p => p.status === 'available');
        return jsonResponse({ pool: available });
      }
      case 'addPhone': {
        const phone = url.searchParams.get('phone');
        if (!phone) return jsonResponse({ error: '缺少 phone 参数' }, 400);
        let pool = await getPool();
        if (pool.some(p => p.phone === phone)) return jsonResponse({ error: '号码已存在' }, 400);
        pool.push({ phone, status: 'available' });
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
        // 一键释放所有被占用的号码（但我们已经没有 in_use 状态了，此接口保留为空操作）
        return jsonResponse({ success: true });
      }
      case 'releasePoolPhone': {
        // 单独释放某个号码：直接从池中删除，然后调用 addPhone 重新添加（相当于回到可用）
        const phone = url.searchParams.get('phone');
        if (!phone) return jsonResponse({ error: '缺少 phone 参数' }, 400);
        let pool = await getPool();
        const exists = pool.some(p => p.phone === phone);
        if (exists) {
          // 如果还在池中（理论上应该已经删除了），先删除
          pool = pool.filter(p => p.phone !== phone);
          await savePool(pool);
        }
        // 重新添加为可用
        pool.push({ phone, status: 'available' });
        await savePool(pool);
        return jsonResponse({ success: true });
      }

      // ========== 日志列表（验证码接收记录） ==========
      case 'logList': {
        const logs = await getLogs();
        return jsonResponse({ logs: logs.reverse() });
      }

      // ========== 订单状态 ==========
      case 'status': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) return jsonResponse({ status: 'new', phone: null, expire: null, code: null });
        if (order.expire && order.status === 'active' && Date.now() >= order.expire) {
          order.status = 'expired';
          await kv.put(oid, JSON.stringify(order));
        }
        return jsonResponse(order);
      }

      // ========== 获取手机号（从池中直接删除） ==========
      case 'getPhone': {
        let order = await kv.get(oid, { type: 'json' });
        if (order && order.status === 'done') return jsonResponse({ error: '订单已完成' }, 403);
        if (order && order.status === 'active' && order.expire && Date.now() < order.expire) {
          return jsonResponse({ phone: order.phone, expire: order.expire });
        }

        // 先释放旧号码（如果来自池且未被释放）
        if (order && order.phone && order.fromPool) {
          // 将旧号码加回池中（因为之前删除了，现在重新添加）
          let pool = await getPool();
          pool.push({ phone: order.phone, status: 'available' });
          await savePool(pool);
        }

        // 1. 从池中取号（随机选一个可用号码，然后删除它）
        let pool = await getPool();
        const available = pool.filter(p => p.status === 'available');
        if (available.length > 0) {
          const chosen = available[Math.floor(Math.random() * available.length)];
          const phone = chosen.phone;

          // 从池中删除该号码
          pool = pool.filter(p => p.phone !== phone);
          await savePool(pool);

          // 激活豪猪指定号码
          try {
            const activateUrl = `https://${HAOZHU.server}/sms/?api=getPhone&token=${tokenStr}&sid=${HAOZHU.sid}&phone=${phone}`;
            await fetch(activateUrl);
          } catch (e) {}

          const newOrder = {
            phone,
            expire: Date.now() + 60 * 1000,
            status: 'active',
            code: null,
            fromPool: true
          };
          await kv.put(oid, JSON.stringify(newOrder));
          return jsonResponse({ phone, expire: newOrder.expire });
        }

        // 2. 池空则调用豪猪
        const phoneResp = await fetch(`https://${HAOZHU.server}/sms/?api=getPhone&token=${tokenStr}&sid=${HAOZHU.sid}`);
        const phoneData = await phoneResp.json();
        if (phoneData.code == 0) {
          const phone = phoneData.phone || phoneData.Phone || phoneData.mobile;
          const newOrder = { phone, expire: Date.now() + 60 * 1000, status: 'active', code: null, fromPool: false };
          await kv.put(oid, JSON.stringify(newOrder));
          return jsonResponse({ phone, expire: newOrder.expire });
        }
        return jsonResponse({ error: phoneData.msg || '取号失败' }, 500);
      }

      // ========== 释放手机号（加回池中） ==========
      case 'release': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) return jsonResponse({ error: '订单不存在' }, 404);
        if (order.status === 'done') return jsonResponse({ error: '订单已完成' }, 403);

        if (order.phone && order.fromPool) {
          // 将号码重新加入池中
          let pool = await getPool();
          pool.push({ phone: order.phone, status: 'available' });
          await savePool(pool);
        } else if (order.phone) {
          try {
            await fetch(`https://${HAOZHU.server}/sms/?api=cancelRecv&token=${tokenStr}&sid=${HAOZHU.sid}&phone=${order.phone}`);
          } catch(e) {}
        }

        order.status = 'new'; order.phone = null; order.expire = null; order.code = null;
        await kv.put(oid, JSON.stringify(order));
        return jsonResponse({ success: true });
      }

      // ========== 获取验证码 ==========
      case 'getSMS': {
        const order = await kv.get(oid, { type: 'json' });
        if (!order || !order.phone) return jsonResponse({ error: '订单不存在' }, 404);

        const smsResp = await fetch(`https://${HAOZHU.server}/sms/?api=getMessage&token=${tokenStr}&sid=${HAOZHU.sid}&phone=${order.phone}`);
        const smsData = await smsResp.json();

        if (smsData.code == 0) {
          const raw = smsData.sms || smsData.Sms || smsData.message || smsData.code_text || '';
          if (raw) {
            const digits = raw.replace(/\D/g, '');
            if (digits.length >= 4) {
              order.code = raw;
              order.status = 'done';
              await kv.put(oid, JSON.stringify(order));

              // 收到验证码，记录日志（号码已在获取时删除，无需再操作池）
              if (order.fromPool && order.phone) {
                await addLog(order.phone, oid);
              }

              return jsonResponse({ code: raw, status: 'done' });
            }
          }
        }
        return jsonResponse({ code: null, status: 'active' });
      }

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
