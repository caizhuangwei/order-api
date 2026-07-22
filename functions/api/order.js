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
  async function addLog(phone, oid, action) {
    const logs = await getLogs();
    logs.push({ phone, oid, action, time: new Date().toISOString() });
    await saveLogs(logs);
  }

  // ========== 豪猪 token 管理 ==========
  let tokenData = await kv.get('__token_data__', { type: 'json' });
  let tokenStr = tokenData ? tokenData.token : null;
  let tokenExpiry = tokenData ? tokenData.expire : 0;

  if (!tokenStr || Date.now() >= tokenExpiry - 300000) {
    const loginResp = await fetch(`https://${HAOZHU.server}/sms/?api=login&user=${HAOZHU.user}&pass=${HAOZHU.pass}`);
    const loginData = await loginResp.json();
    if (loginData.code === 0 || loginData.code === '0') {
      tokenStr = loginData.token || loginData.Token || loginData.access_token;
      tokenExpiry = Date.now() + 3500000;
      await kv.put('__token_data__', JSON.stringify({ token: tokenStr, expire: tokenExpiry }));
    } else {
      return jsonResponse({ error: '登录失败: ' + (loginData.msg || '') }, 500);
    }
  }

  try {
    switch (action) {
      // ========== 号码池管理 (不变) ==========
      case 'poolList': { const pool = await getPool(); return jsonResponse({ pool }); }
      case 'addPhone': {
        const phone = url.searchParams.get('phone');
        if (!phone) return jsonResponse({ error: '缺少 phone 参数' }, 400);
        let pool = await getPool();
        if (pool.some(p => p.phone === phone)) return jsonResponse({ error: '该号码已在池中' }, 400);
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
              order.status = 'released'; order.phone = null; order.expire = null;
              await kv.put(p.oid, JSON.stringify(order));
            }
            p.status = 'available'; p.oid = null; p.expire = null;
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
            order.status = 'released'; order.phone = null; order.expire = null;
            await kv.put(entry.oid, JSON.stringify(order));
          }
        }
        entry.status = 'available'; entry.oid = null; entry.expire = null;
        await savePool(pool);
        return jsonResponse({ success: true });
      }

      // ========== 日志列表 ==========
      case 'logList': {
        const logs = await getLogs();
        return jsonResponse({ logs: logs.reverse() });
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
              entry.status = 'available'; entry.oid = null; entry.expire = null;
              await savePool(pool);
            }
          }
          order.status = 'expired';
          await kv.put(oid, JSON.stringify(order));
        }
        return jsonResponse(order);
      }

      // ========== 获取手机号（池优先，池空走豪猪，池号码自动激活） ==========
      case 'getPhone': {
        let order = await kv.get(oid, { type: 'json' });

        if (order && order.status === 'done') return jsonResponse({ error: '订单已完成' }, 403);
        if (order && order.status === 'released') return jsonResponse({ error: '订单已被管理员释放' }, 403);

        if (order && order.status === 'active' && order.expire && Date.now() < order.expire) {
          return jsonResponse({ phone: order.phone, expire: order.expire });
        }

        // 释放旧池号码
        if (order && order.phone && order.fromPool) {
          let pool = await getPool();
          const entry = pool.find(p => p.phone === order.phone);
          if (entry && entry.status === 'in_use') {
            entry.status = 'available'; entry.oid = null; entry.expire = null;
            await savePool(pool);
          }
        }

        // 1. 从号码池中取号
        let pool = await getPool();
        const available = pool.filter(p => p.status === 'available');
        if (available.length > 0) {
          const chosen = available[Math.floor(Math.random() * available.length)];
          const phone = chosen.phone;
          const expire = Date.now() + 60 * 1000;

          // ✅ 激活豪猪平台上的指定号码（尝试两个可能的接口）
          let activated = false;
          // 方法1：调用 getPhone 并传 phone 参数
          try {
            const url1 = `https://${HAOZHU.server}/sms/?api=getPhone&token=${tokenStr}&sid=${HAOZHU.sid}&phone=${phone}`;
            console.log('[指定号码] 尝试接口1:', url1);
            const r1 = await fetch(url1);
            const d1 = await r1.json();
            console.log('[指定号码] 接口1返回:', JSON.stringify(d1));
            if (d1.code == 0) activated = true;
          } catch (e) {
            console.log('[指定号码] 接口1异常:', e.message);
          }
          // 如果方法1失败，尝试方法2：getAgainNmuber
          if (!activated) {
            try {
              const url2 = `https://${HAOZHU.server}/sms/?api=getAgainNmuber&token=${tokenStr}&sid=${HAOZHU.sid}&phone=${phone}`;
              console.log('[指定号码] 尝试接口2:', url2);
              const r2 = await fetch(url2);
              const d2 = await r2.json();
              console.log('[指定号码] 接口2返回:', JSON.stringify(d2));
              if (d2.code == 0) activated = true;
            } catch (e) {
              console.log('[指定号码] 接口2异常:', e.message);
            }
          }
          // 如果都失败，记录日志但不中断流程（允许后续轮询 getSMS 继续工作）
          if (!activated) {
            console.log('[指定号码] 所有激活尝试失败，但仍继续分配号码');
          }

          // 更新池状态
          chosen.status = 'in_use';
          chosen.oid = oid;
          chosen.expire = expire;
          await savePool(pool);

          const newOrder = {
            phone,
            expire,
            status: 'active',
            code: null,
            fromPool: true
          };
          await kv.put(oid, JSON.stringify(newOrder));
          await addLog(phone, oid, 'assigned');
          return jsonResponse({ phone, expire });
        }

        // 2. 池空则调用豪猪获取新号
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
          await addLog(phone, oid, 'assigned');
          return jsonResponse({ phone, expire: newOrder.expire });
        }
        return jsonResponse({ error: phoneData.msg || '取号失败' }, 500);
      }

      // ========== 释放（保持不变） ==========
      case 'release': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) return jsonResponse({ error: '订单不存在' }, 404);
        if (order.status === 'done') return jsonResponse({ error: '订单已完成' }, 403);

        if (order.phone && order.fromPool) {
          let pool = await getPool();
          const entry = pool.find(p => p.phone === order.phone);
          if (entry) { entry.status = 'available'; entry.oid = null; entry.expire = null; await savePool(pool); }
          await addLog(order.phone, oid, 'released');
        } else if (order.phone) {
          try { await fetch(`https://${HAOZHU.server}/sms/?api=releasePhone&token=${tokenStr}&sid=${HAOZHU.sid}&phone=${order.phone}`); } catch(e) {}
          await addLog(order.phone, oid, 'released');
        }

        order.status = 'new'; order.phone = null; order.expire = null; order.code = null;
        await kv.put(oid, JSON.stringify(order));
        return jsonResponse({ success: true });
      }

      // ========== 获取验证码（不变） ==========
      case 'getSMS': {
        const order = await kv.get(oid, { type: 'json' });
        if (!order || !order.phone) return jsonResponse({ error: '订单不存在或无手机号' }, 404);

        const smsUrl = `https://${HAOZHU.server}/sms/?api=getMessage&token=${tokenStr}&sid=${HAOZHU.sid}&phone=${order.phone}`;
        const smsResp = await fetch(smsUrl);
        const smsData = await smsResp.json();

        if (smsData.code == 0) {
          const raw = smsData.sms || smsData.Sms || smsData.message || smsData.code_text || '';
          if (raw) {
            const digits = raw.replace(/\D/g, '');
            if (digits.length >= 4) {
              order.code = raw;
              order.status = 'done';
              await kv.put(oid, JSON.stringify(order));
              await addLog(order.phone, oid, 'sms_received');
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
    console.error('Error:', e.message);
    return jsonResponse({ error: e.message }, 500);
  }
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
