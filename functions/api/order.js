export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const oid = url.searchParams.get('oid');
  const sid = url.searchParams.get('sid') || '24085';

  // ============================================================
  // 疾驰短信配置（已写死 fcToken）
  // ============================================================
  const JICHI = {
    // ★★★ 这里替换为你实际的疾驰 API 域名 ★★★
    server: 'https://api.jichisms.com',  // 请替换为疾驰提供的实际域名
    fcToken: 'cf8c4f42d69b43a125210f27343ad81f',  // 已写死
    sid: sid
  };

  // 所有无需 oid 的接口
  const poolActions = [
    'addPhone', 'removePhone', 'poolList', 'resetPool', 'releasePoolPhone', 'logList',
    'getBalance', 'lockOrder', 'blockPhone',
    'generateCard', 'activateCard', 'verifyCard', 'cardList', 'deleteCard',
    'createOrder',
    'listActiveOrders',
    'releaseAllOrders'
  ];
  if (!oid && !poolActions.includes(action)) {
    return jsonResponse({ error: '缺少订单ID' }, 400);
  }

  const kv = env.ORDERS;
  const POOL_KEY = 'phone_pool';
  const LOG_KEY = 'phone_logs';
  const CARD_KEY = 'card_keys';

  async function getPool() { const p = await kv.get(POOL_KEY, { type: 'json' }); return p || []; }
  async function savePool(pool) { await kv.put(POOL_KEY, JSON.stringify(pool)); }

  async function getLogs() { const logs = await kv.get(LOG_KEY, { type: 'json' }); return logs || []; }
  async function saveLogs(logs) {
    if (logs.length > 100) logs = logs.slice(-100);
    await kv.put(LOG_KEY, JSON.stringify(logs));
  }
  async function addLog(phone, oid, action) {
    if (action !== 'sms_received') return;
    const logs = await getLogs();
    logs.push({ phone, oid, action, time: new Date().toISOString() });
    await saveLogs(logs);
  }

  async function getCards() { const c = await kv.get(CARD_KEY, { type: 'json' }); return c || []; }
  async function saveCards(cards) { await kv.put(CARD_KEY, JSON.stringify(cards)); }

  function generateCardKey() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const segment = () => {
      let s = '';
      for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
      return s;
    };
    return `JC-${segment()}-${segment()}`;
  }

  // ============================================================
  // 疾驰 API 通用请求封装（自动携带 fcToken）
  // ============================================================
  async function jichiRequest(endpoint, method = 'GET', body = null) {
    const url = `${JICHI.server}${endpoint}`;
    const headers = {
      'fcToken': JICHI.fcToken,
      'Content-Type': 'application/x-www-form-urlencoded'
    };
    const options = {
      method: method,
      headers: headers
    };
    if (body) {
      options.body = new URLSearchParams(body).toString();
    }
    const resp = await fetch(url, options);
    const data = await resp.json();
    // 疾驰返回格式：{ code: 1|0, msg: string, data?: any }
    if (data.code === 0) {
      throw new Error(data.msg || '疾驰API请求失败');
    }
    return data;
  }

  // ============================================================
  // 辅助函数：释放单个订单（适配疾驰）
  // ============================================================
  async function releaseOrderByOid(oid) {
    let order = await kv.get(oid, { type: 'json' });
    if (!order) return { success: false, error: '订单不存在' };
    if (order.status === 'done') return { success: false, error: '订单已完成，无法释放' };
    if (order.status === 'released') return { success: false, error: '订单已被释放过' };

    // 如果订单有手机号，调用疾驰释放接口
    if (order.phone) {
      try {
        // 疾驰释放接口：/api/user/releasePhone
        await jichiRequest('/api/user/releasePhone', 'POST', {
          project_id: JICHI.sid,
          phone: order.phone
        });
      } catch (e) {
        // 释放失败也继续，保证本地状态更新
        console.warn('释放号码失败:', e.message);
      }

      // 如果是池子里的号码，更新池状态
      if (order.fromPool) {
        let pool = await getPool();
        const entry = pool.find(p => p.phone === order.phone);
        if (entry && entry.status === 'in_use') {
          entry.status = 'available';
          entry.oid = null;
          entry.expire = null;
          await savePool(pool);
        }
      }
    }

    order.status = 'released';
    order.phone = null;
    order.expire = null;
    order.code = null;
    await kv.put(oid, JSON.stringify(order));
    return { success: true };
  }

  try {
    switch (action) {

      // ============================================================
      // 订单管理
      // ============================================================
      case 'listActiveOrders': {
        const keys = await kv.list();
        const orders = [];
        for (const key of keys.keys) {
          if (key.name.startsWith('__') || key.name === POOL_KEY || key.name === LOG_KEY || key.name === CARD_KEY) continue;
          const order = await kv.get(key.name, { type: 'json' });
          if (order && order.status === 'active' && order.phone) {
            orders.push({ oid: key.name, phone: order.phone });
          }
        }
        return jsonResponse({ orders });
      }

      case 'releaseAllOrders': {
        const keys = await kv.list();
        const results = [];
        for (const key of keys.keys) {
          if (key.name.startsWith('__') || key.name === POOL_KEY || key.name === LOG_KEY || key.name === CARD_KEY) continue;
          const order = await kv.get(key.name, { type: 'json' });
          if (order && order.status === 'active') {
            const result = await releaseOrderByOid(key.name);
            results.push({ oid: key.name, success: result.success, error: result.error });
          }
        }
        const successCount = results.filter(r => r.success).length;
        return jsonResponse({ success: true, released: successCount, total: results.length, details: results });
      }

      case 'createOrder': {
        if (!oid) return jsonResponse({ error: '缺少订单ID' }, 400);
        let existing = await kv.get(oid, { type: 'json' });
        if (existing) return jsonResponse({ error: '订单已存在' }, 400);
        const newOrder = { status: 'new', phone: null, expire: null, code: null, fromPool: false };
        await kv.put(oid, JSON.stringify(newOrder));
        return jsonResponse({ success: true });
      }

      case 'lockOrder': {
        if (!oid) return jsonResponse({ error: '缺少订单ID' }, 400);
        const result = await releaseOrderByOid(oid);
        if (result.success) {
          return jsonResponse({ success: true });
        } else {
          return jsonResponse({ error: result.error }, 400);
        }
      }

      // ============================================================
      // 获取手机号（官方引擎）
      // ============================================================
      case 'getPhone': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) {
          return jsonResponse({ error: '订单不存在或已失效' }, 404);
        }
        if (order.status === 'done') return jsonResponse({ error: '订单已完成' }, 403);
        if (order.status === 'released') return jsonResponse({ error: '订单已被管理员释放' }, 403);
        if (order.status === 'active' && order.expire && Date.now() < order.expire) {
          return jsonResponse({ phone: order.phone, expire: order.expire });
        }

        // 如果之前有手机号，先释放
        if (order.phone) {
          if (order.fromPool) {
            let pool = await getPool();
            const entry = pool.find(p => p.phone === order.phone);
            if (entry && entry.status === 'in_use') {
              entry.status = 'available';
              entry.oid = null;
              entry.expire = null;
              await savePool(pool);
            }
          } else {
            try {
              await jichiRequest('/api/user/releasePhone', 'POST', {
                project_id: JICHI.sid,
                phone: order.phone
              });
            } catch(e) {}
          }
        }

        // 1) 先从号码池获取
        let pool = await getPool();
        const available = pool.filter(p => p.status === 'available');
        if (available.length > 0) {
          const chosen = available[Math.floor(Math.random() * available.length)];
          const phone = chosen.phone;
          const expire = Date.now() + 60 * 1000;

          // 调用疾驰取号接口激活号码
          try {
            await jichiRequest('/api/user/getPhone', 'POST', {
              project_id: JICHI.sid,
              phone: phone
            });
          } catch (e) {
            // 如果激活失败，从池中移除该号码并重试取号
            pool = pool.filter(p => p.phone !== phone);
            await savePool(pool);
            // 递归重试
            const retryResp = await fetch(url, { method: request.method, headers: request.headers });
            return retryResp;
          }

          chosen.status = 'in_use';
          chosen.oid = oid;
          chosen.expire = expire;
          await savePool(pool);

          const newOrder = { phone, expire, status: 'active', code: null, fromPool: true };
          await kv.put(oid, JSON.stringify(newOrder));
          return jsonResponse({ phone, expire });
        }

        // 2) 池子没有，向疾驰取新号
        try {
          const data = await jichiRequest('/api/user/getPhone', 'POST', {
            project_id: JICHI.sid
          });
          const phone = data.data.phone;
          const expire = Date.now() + 60 * 1000;
          const newOrder = { phone, expire, status: 'active', code: null, fromPool: false };
          await kv.put(oid, JSON.stringify(newOrder));
          return jsonResponse({ phone, expire });
        } catch (e) {
          return jsonResponse({ error: e.message || '取号失败' }, 500);
        }
      }

      // ============================================================
      // 获取验证码
      // ============================================================
      case 'getSMS': {
        const order = await kv.get(oid, { type: 'json' });
        if (!order || !order.phone) return jsonResponse({ error: '订单不存在或无手机号' }, 404);

        try {
          // 疾驰获取验证码接口
          const data = await jichiRequest('/api/user/getVerifyCode', 'POST', {
            project_id: JICHI.sid,
            phone: order.phone
          });
          // 疾驰验证码在 msg 字段
          const code = data.msg;
          if (code && code.length >= 4) {
            order.code = code;
            order.status = 'done';
            await kv.put(oid, JSON.stringify(order));
            await addLog(order.phone, oid, 'sms_received');
            return jsonResponse({ code: code, status: 'done' });
          }
          return jsonResponse({ code: null, status: 'active' });
        } catch (e) {
          // 如果错误信息包含"频繁"，返回主动状态
          if (e.message.includes('频繁')) {
            return jsonResponse({ code: null, status: 'active', msg: '请求过于频繁，请稍后再试' });
          }
          return jsonResponse({ code: null, status: 'active' });
        }
      }

      // ============================================================
      // 释放（买家释放，状态变为 new）
      // ============================================================
      case 'release': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) return jsonResponse({ error: '订单不存在' }, 404);
        if (order.status === 'done') return jsonResponse({ error: '订单已完成' }, 403);

        if (order.phone) {
          try {
            await jichiRequest('/api/user/releasePhone', 'POST', {
              project_id: JICHI.sid,
              phone: order.phone
            });
          } catch(e) {}

          if (order.fromPool) {
            let pool = await getPool();
            const entry = pool.find(p => p.phone === order.phone);
            if (entry) {
              entry.status = 'available';
              entry.oid = null;
              entry.expire = null;
              await savePool(pool);
            }
          }
        }

        order.status = 'new';
        order.phone = null;
        order.expire = null;
        order.code = null;
        await kv.put(oid, JSON.stringify(order));
        return jsonResponse({ success: true });
      }

      // ============================================================
      // 订单状态查询
      // ============================================================
      case 'status': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) {
          return jsonResponse({ status: 'invalid', phone: null, expire: null, code: null });
        }
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

      // ============================================================
      // 号码池管理（不变）
      // ============================================================
      case 'poolList': { const pool = await getPool(); return jsonResponse({ pool }); }
      case 'addPhone': {
        const phone = url.searchParams.get('phone');
        if (!phone) return jsonResponse({ error: '缺少 phone 参数' }, 400);
        let pool = await getPool();
        if (pool.some(p => p.phone === phone)) return jsonResponse({ error: '号码已存在' }, 400);
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

      // ============================================================
      // 日志列表
      // ============================================================
      case 'logList': {
        const logs = await getLogs();
        return jsonResponse({ logs: logs.reverse() });
      }

      // ============================================================
      // 查询余额（通过疾驰项目列表接口模拟）
      // ============================================================
      case 'getBalance': {
        try {
          // 调用疾驰项目列表接口，从返回数据中获取余额信息
          const data = await jichiRequest('/api/user/projects?page=1&pagesize=1', 'GET');
          // 疾驰没有直接的余额接口，这里尝试从项目列表返回中提取
          let balance = '--';
          if (data.data && data.data.length > 0 && data.data[0].money !== undefined) {
            // 如果项目有价格字段，作为参考
            balance = `¥${data.data[0].money}`;
          }
          return jsonResponse({ balance: balance, msg: '余额需在疾驰后台查看' });
        } catch (e) {
          return jsonResponse({ balance: '--', error: e.message });
        }
      }

      // ============================================================
      // 拉黑手机号（疾驰没有直接拉黑接口，可调用释放并标记）
      // ============================================================
      case 'blockPhone': {
        const phone = url.searchParams.get('phone');
        if (!phone) return jsonResponse({ error: '缺少 phone 参数' }, 400);
        try {
          // 尝试释放该号码
          await jichiRequest('/api/user/releasePhone', 'POST', {
            project_id: JICHI.sid,
            phone: phone
          });
        } catch(e) {}
        // 从池中移除
        let pool = await getPool();
        pool = pool.filter(p => p.phone !== phone);
        await savePool(pool);
        return jsonResponse({ success: true, msg: '已拉黑并释放' });
      }

      // ============================================================
      // 卡密系统（不变）
      // ============================================================
      case 'generateCard': {
        const type = url.searchParams.get('type') || 'trial';
        const count = parseInt(url.searchParams.get('count')) || 1;
        if (count < 1 || count > 100) return jsonResponse({ error: '数量需在1-100之间' }, 400);
        const duration = type === 'month' ? 30 : 1;
        const cards = await getCards();
        const generated = [];
        for (let i = 0; i < count; i++) {
          const key = generateCardKey();
          cards.push({
            key,
            type,
            duration,
            activated: false,
            activated_at: null,
            expire_at: null,
            created_at: Date.now()
          });
          generated.push(key);
        }
        await saveCards(cards);
        return jsonResponse({ success: true, keys: generated });
      }

      case 'activateCard': {
        const key = url.searchParams.get('key');
        if (!key) return jsonResponse({ error: '缺少卡密' }, 400);
        const cards = await getCards();
        const card = cards.find(c => c.key === key);
        if (!card) return jsonResponse({ error: '卡密不存在' }, 404);
        if (card.activated) {
          if (Date.now() > card.expire_at) return jsonResponse({ error: '卡密已过期' }, 400);
          return jsonResponse({ success: true, expire_at: card.expire_at });
        }
        const now = Date.now();
        card.activated = true;
        card.activated_at = now;
        card.expire_at = now + card.duration * 86400 * 1000;
        await saveCards(cards);
        return jsonResponse({ success: true, expire_at: card.expire_at });
      }

      case 'verifyCard': {
        const key = url.searchParams.get('key');
        if (!key) return jsonResponse({ error: '缺少卡密' }, 400);
        const cards = await getCards();
        const card = cards.find(c => c.key === key);
        if (!card) return jsonResponse({ error: '卡密不存在' }, 404);
        if (!card.activated) return jsonResponse({ valid: false, msg: '未激活' });
        if (Date.now() > card.expire_at) return jsonResponse({ valid: false, msg: '已过期' });
        return jsonResponse({ valid: true, expire_at: card.expire_at });
      }

      case 'cardList': {
        const cards = await getCards();
        return jsonResponse({ cards });
      }

      case 'deleteCard': {
        const key = url.searchParams.get('key');
        if (!key) return jsonResponse({ error: '缺少卡密' }, 400);
        let cards = await getCards();
        cards = cards.filter(c => c.key !== key);
        await saveCards(cards);
        return jsonResponse({ success: true });
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
