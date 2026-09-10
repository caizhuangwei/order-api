export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const oid = url.searchParams.get('oid');

  // ========== 疾驰短信配置（写死在后端） ==========
  const JICHI = {
    domain: 'https://www.jichisms.com',
    fcToken: 'cf8c4f42d69b43a125210f27343ad81f'
  };

  const PHONE_TTL_MS = 180 * 1000;   // ✅ 手机号有效期 180 秒

  const poolActions = [
    'addPhone', 'removePhone', 'poolList', 'resetPool', 'releasePoolPhone', 'logList',
    'getBalance', 'lockOrder', 'blockPhone',
    'generateCard', 'activateCard', 'verifyCard', 'cardList', 'deleteCard',
    'createOrder',
    'listActiveOrders',
    'releaseAllOrders',
    'projects',
    'carrierCodes',
    'listOrders'
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

  // ========== 疾驰通用请求封装（自动重定向 + 保留请求体） ==========
  async function jichiRequest(endpoint, method = 'GET', body = null) {
    const headers = { 'fcToken': JICHI.fcToken };
    const options = { method, headers, redirect: 'follow' };
    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.body = new URLSearchParams(body).toString();
    }
    const resp = await fetch(JICHI.domain + endpoint, options);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  }

  async function releaseOrderByOid(oid) {
    let order = await kv.get(oid, { type: 'json' });
    if (!order) return { success: false, error: '订单不存在' };
    if (order.status === 'done') return { success: false, error: '订单已完成，无法释放' };
    if (order.status === 'released') return { success: false, error: '订单已被释放过' };

    if (order.phone && order.fromPool) {
      let pool = await getPool();
      const entry = pool.find(p => p.phone === order.phone);
      if (entry && entry.status === 'in_use') {
        entry.status = 'available'; entry.oid = null; entry.expire = null;
        await savePool(pool);
      }
    } else if (order.phone) {
      try {
        await jichiRequest('/api/user/releasePhone', 'POST', {
          project_id: order.projectId || '', phone: order.phone
        });
      } catch(e) {}
    }

    order.status = 'released'; order.phone = null; order.expire = null; order.code = null;
    await kv.put(oid, JSON.stringify(order));
    return { success: true };
  }

  try {
    switch (action) {

      case 'projects': {
        const page = url.searchParams.get('page') || '1';
        const pagesize = url.searchParams.get('pagesize') || '100';
        const projectName = url.searchParams.get('project_name') || '';
        let endpoint = `/api/user/projects?page=${page}&pagesize=${pagesize}`;
        if (projectName) endpoint += `&project_name=${encodeURIComponent(projectName)}`;
        try {
          const data = await jichiRequest(endpoint, 'GET');
          return jsonResponse(data);
        } catch (e) {
          return jsonResponse({ error: e.message }, 500);
        }
      }

      case 'carrierCodes': {
        const projectId = url.searchParams.get('project_id');
        if (!projectId) return jsonResponse({ error: '缺少项目ID' }, 400);
        try {
          const data = await jichiRequest(
            `/api/index/getCodeStoreByProjectId?project_id=${projectId}&page=1&limit=50`,
            'GET'
          );
          return jsonResponse(data);
        } catch (e) {
          return jsonResponse({ error: e.message }, 500);
        }
      }

      case 'listOrders': {
        const keys = await kv.list();
        const orders = [];
        for (const key of keys.keys) {
          if (key.name.startsWith('__') || key.name === POOL_KEY || key.name === LOG_KEY || key.name === CARD_KEY) continue;
          const order = await kv.get(key.name, { type: 'json' });
          if (order) {
            orders.push({
              oid: key.name, status: order.status,
              phone: order.phone || null,
              projectId: order.projectId || null,
              codeId: order.codeId || null
            });
          }
        }
        orders.sort((a, b) => b.oid.localeCompare(a.oid));
        return jsonResponse({ orders });
      }

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

        const projectId = url.searchParams.get('project_id') || '';
        const codeId = url.searchParams.get('code_id') || '';

        const newOrder = {
          status: 'new', phone: null, expire: null, code: null,
          fromPool: false, projectId, codeId
        };
        await kv.put(oid, JSON.stringify(newOrder));
        return jsonResponse({ success: true });
      }

      case 'generateCard': {
        const type = url.searchParams.get('type') || 'trial';
        const count = parseInt(url.searchParams.get('count')) || 1;
        if (count < 1 || count > 100) return jsonResponse({ error: '数量需在1-100之间' }, 400);
        const duration = type === 'month' ? 30 : 1;
        const cards = await getCards();
        const generated = [];
        for (let i = 0; i < count; i++) {
          const key = generateCardKey();
          cards.push({ key, type, duration, activated: false, activated_at: null, expire_at: null, created_at: Date.now() });
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
        card.activated = true; card.activated_at = now;
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

      case 'getBalance': {
        try {
          const data = await jichiRequest('/api/user/getMoney', 'GET');
          if (data.code === 1) {
            return jsonResponse({ balance: data.data?.money || data.data?.balance || data.data || '0' });
          }
          return jsonResponse({ error: data.msg || '查询失败' });
        } catch (e) {
          return jsonResponse({ error: e.message });
        }
      }

      case 'blockPhone': {
        const phone = url.searchParams.get('phone');
        if (!phone) return jsonResponse({ error: '缺少 phone 参数' }, 400);
        let pool = await getPool();
        pool = pool.filter(p => p.phone !== phone);
        await savePool(pool);
        return jsonResponse({ success: true });
      }

      case 'lockOrder': {
        if (!oid) return jsonResponse({ error: '缺少订单ID' }, 400);
        const result = await releaseOrderByOid(oid);
        if (result.success) return jsonResponse({ success: true });
        return jsonResponse({ error: result.error }, 400);
      }

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

      case 'logList': {
        const logs = await getLogs();
        return jsonResponse({ logs: logs.reverse() });
      }

      case 'status': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) return jsonResponse({ status: 'invalid', phone: null, expire: null, code: null });
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

      case 'getPhone': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) return jsonResponse({ error: '订单不存在或已失效' }, 404);
        if (order.status === 'done') return jsonResponse({ error: '订单已完成' }, 403);
        if (order.status === 'released') return jsonResponse({ error: '订单已被管理员释放' }, 403);
        if (order.status === 'active' && order.expire && Date.now() < order.expire) {
          return jsonResponse({ phone: order.phone, expire: order.expire });
        }

        if (order.phone && order.fromPool) {
          let pool = await getPool();
          const entry = pool.find(p => p.phone === order.phone);
          if (entry && entry.status === 'in_use') {
            entry.status = 'available'; entry.oid = null; entry.expire = null;
            await savePool(pool);
          }
        }

        let pool = await getPool();
        const available = pool.filter(p => p.status === 'available');
        if (available.length > 0) {
          const chosen = available[Math.floor(Math.random() * available.length)];
          const phone = chosen.phone;
          // ✅ 改成 180 秒
          const expire = Date.now() + PHONE_TTL_MS;
          chosen.status = 'in_use'; chosen.oid = oid; chosen.expire = expire;
          await savePool(pool);
          const newOrder = { ...order, phone, expire, status: 'active', code: null, fromPool: true };
          await kv.put(oid, JSON.stringify(newOrder));
          return jsonResponse({ phone, expire });
        }

        if (!order.projectId) {
          return jsonResponse({ error: '订单未配置项目ID' }, 400);
        }

        let phoneData;
        if (order.codeId) {
          phoneData = await jichiRequest('/api/user/getCardEnginePhone', 'POST', {
            project_id: order.projectId, code_id: order.codeId
          });
        } else {
          phoneData = await jichiRequest('/api/user/getPhone', 'POST', {
            project_id: order.projectId
          });
        }

        if (phoneData.code === 1) {
          const phone = phoneData.data?.phone || phoneData.data?.mobile;
          // ✅ 改成 180 秒
          const expire = Date.now() + PHONE_TTL_MS;
          const newOrder = { ...order, phone, expire, status: 'active', code: null, fromPool: false };
          await kv.put(oid, JSON.stringify(newOrder));
          return jsonResponse({ phone, expire });
        }
        return jsonResponse({ error: phoneData.msg || '取号失败' }, 500);
      }

      case 'release': {
        let order = await kv.get(oid, { type: 'json' });
        if (!order) return jsonResponse({ error: '订单不存在' }, 404);
        if (order.status === 'done') return jsonResponse({ error: '订单已完成' }, 403);

        if (order.phone && order.fromPool) {
          let pool = await getPool();
          const entry = pool.find(p => p.phone === order.phone);
          if (entry) {
            entry.status = 'available'; entry.oid = null; entry.expire = null;
            await savePool(pool);
          }
        } else if (order.phone && order.projectId) {
          try {
            await jichiRequest('/api/user/releasePhone', 'POST', {
              project_id: order.projectId, phone: order.phone
            });
          } catch(e) {}
        }

        order.status = 'new'; order.phone = null; order.expire = null; order.code = null;
        await kv.put(oid, JSON.stringify(order));
        return jsonResponse({ success: true });
      }

      case 'getSMS': {
        const order = await kv.get(oid, { type: 'json' });
        if (!order || !order.phone) return jsonResponse({ error: '订单不存在' }, 404);
        if (!order.projectId) return jsonResponse({ error: '订单未配置项目ID' }, 400);

        try {
          const smsData = await jichiRequest('/api/user/getVerifyCode', 'POST', {
            project_id: order.projectId, phone: order.phone
          });

          if (smsData.code === 1) {
            const raw = smsData.msg || smsData.data?.code || smsData.data?.sms || '';
            const digits = String(raw).replace(/\D/g, '');
            if (digits.length >= 4) {
              order.code = digits;
              order.status = 'done';
              await kv.put(oid, JSON.stringify(order));
              await addLog(order.phone, oid, 'sms_received');
              return jsonResponse({ code: digits, status: 'done' });
            }
          }
        } catch(e) {}

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
