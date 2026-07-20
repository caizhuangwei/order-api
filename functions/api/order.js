// 全局内存存储（Pages 实例内共享）
const orders = new Map();
let tokenCache = null;

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

  const MAX_RELEASES = 5; // 最大释放次数

  // 获取 token（缓存 1 小时）
  if (!tokenCache || Date.now() > tokenCache.expire) {
    const loginResp = await fetch(`https://${HAOZHU.server}/sms/?api=login&user=${HAOZHU.user}&pass=${HAOZHU.pass}`);
    const loginData = await loginResp.json();
    if (loginData.code === 0 || loginData.code === '0') {
      tokenCache = {
        value: loginData.token || loginData.Token || loginData.access_token,
        expire: Date.now() + 3500000
      };
    } else {
      return jsonResponse({ error: '登录失败' }, 500);
    }
  }

  try {
    switch (action) {
      case 'status': {
        const order = orders.get(oid);
        if (!order) return jsonResponse({ status: 'new', phone: null, expire: null, code: null, releaseCount: 0 });
        if (order.status === 'active' && Date.now() >= order.expire) {
          order.status = 'expired';
        }
        return jsonResponse(order);
      }

      case 'getPhone': {
        let order = orders.get(oid);

        // 订单已完成，不允许获取
        if (order && order.status === 'done') {
          return jsonResponse({ error: '订单已完成，无法获取手机号' }, 403);
        }

        // 订单已作废（超过释放次数），不允许获取
        if (order && order.status === 'invalid') {
          return jsonResponse({ error: '订单已作废（超过释放次数限制），请联系卖家重新下单' }, 403);
        }

        // 已有活跃订单且未过期，直接返回已有手机号
        if (order && order.status === 'active' && Date.now() < order.expire) {
          return jsonResponse({ phone: order.phone, expire: order.expire, releaseCount: order.releaseCount || 0 });
        }

        // 如果订单已过期，自动释放旧号
        if (order && order.status === 'expired' && order.phone) {
          await fetch(`https://${HAOZHU.server}/sms/?api=releasePhone&token=${tokenCache.value}&sid=${HAOZHU.sid}&phone=${order.phone}`);
        }

        // 获取新手机号
        const phoneResp = await fetch(`https://${HAOZHU.server}/sms/?api=getPhone&token=${tokenCache.value}&sid=${HAOZHU.sid}`);
        const phoneData = await phoneResp.json();
        if (phoneData.code === 0 || phoneData.code === '0') {
          const phone = phoneData.phone || phoneData.Phone || phoneData.mobile;
          order = {
            phone,
            expire: Date.now() + 300 * 1000,
            status: 'active',
            code: null,
            releaseCount: order ? (order.releaseCount || 0) : 0 // 保留之前的释放次数
          };
          orders.set(oid, order);
          return jsonResponse({ phone, expire: order.expire, releaseCount: order.releaseCount });
        }
        return jsonResponse({ error: phoneData.msg || '取号失败' }, 500);
      }

      case 'release': {
        let order = orders.get(oid);
        
        if (!order) {
          return jsonResponse({ error: '订单不存在' }, 404);
        }

        // 订单已完成，不允许释放
        if (order.status === 'done') {
          return jsonResponse({ error: '订单已完成，无法释放' }, 403);
        }

        // 订单已作废，不允许释放
        if (order.status === 'invalid') {
          return jsonResponse({ error: '订单已作废，无法释放' }, 403);
        }

        // 增加释放次数
        const currentCount = (order.releaseCount || 0) + 1;
        
        // 释放旧手机号
        if (order.phone) {
          await fetch(`https://${HAOZHU.server}/sms/?api=releasePhone&token=${tokenCache.value}&sid=${HAOZHU.sid}&phone=${order.phone}`);
        }

        // 检查是否超过最大释放次数
        if (currentCount >= MAX_RELEASES) {
          order.status = 'invalid';
          order.phone = null;
          order.expire = null;
          order.code = null;
          order.releaseCount = currentCount;
          orders.set(oid, order);
          return jsonResponse({ 
            error: `已达到最大释放次数（${MAX_RELEASES}次），订单已作废`, 
            releaseCount: currentCount,
            status: 'invalid'
          }, 403);
        }

        // 更新订单（清空手机号，允许重新获取）
        order.phone = null;
        order.expire = null;
        order.code = null;
        order.releaseCount = currentCount;
        orders.set(oid, order);
        
        return jsonResponse({ 
          success: true, 
          releaseCount: currentCount,
          remaining: MAX_RELEASES - currentCount
        });
      }

      case 'getSMS': {
        const order = orders.get(oid);
        if (!order || !order.phone) return jsonResponse({ error: '订单不存在' }, 404);
        const smsResp = await fetch(`https://${HAOZHU.server}/sms/?api=getMessage&token=${tokenCache.value}&sid=${HAOZHU.sid}&phone=${order.phone}`);
        const smsData = await smsResp.json();
        if (smsData.code === 0 || smsData.code === '0') {
          const code = smsData.sms || smsData.Sms || smsData.message || smsData.code_text;
          if (code) {
            order.code = code;
            order.status = 'done';
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
