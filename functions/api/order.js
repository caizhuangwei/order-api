const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// 启用跨域中间件与 JSON 解析
app.use(cors());
app.use(express.json());

// 第三方接码平台基础地址
const UPSTREAM_HOST = 'http://api.tyasdbsd.cyou:6722';

/**
 * 辅助函数：针对该平台带有两个问号的特殊 URL 格式进行请求
 * 格式例如: /nats?apilogin?us=xxx&pw=yyy
 */
async function callUpstream(action, params) {
  const queryString = new URLSearchParams(params).toString();
  const targetUrl = `${UPSTREAM_HOST}/nats?${action}?${queryString}`;
  
  const response = await axios.get(targetUrl, {
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  });
  return response.data;
}

// ----------------------------------------------------
// 接口 1: 登录获取 Token (/api/login)
// ----------------------------------------------------
app.post('/api/login', async (req, res) => {
  try {
    const { us, pw } = req.body;
    if (!us || !pw) {
      return res.status(400).json({ stat: false, message: '账号或密码不能为空' });
    }

    const data = await callUpstream('apilogin', { us, pw });
    return res.json(data);
  } catch (err) {
    console.error('[Login Error]:', err.message);
    return res.status(500).json({ stat: false, message: '请求上游接口失败', error: err.message });
  }
});

// ----------------------------------------------------
// 接口 2: 获取手机号 (/api/get-phone)
// 注意：上游限制调用频率需大于 2 秒一次
// ----------------------------------------------------
app.get('/api/get-phone', async (req, res) => {
  try {
    const { token, id, haomaku, phone } = req.query;

    if (!token || !id || !haomaku) {
      return res.status(400).json({ 
        stat: false, 
        message: '参数缺失: token, id, haomaku 均为必填参数' 
      });
    }

    const params = { token, haomaku, id };
    if (phone) {
      params.phone = phone; // 支持指定号码
    }

    const data = await callUpstream('apinumber', params);
    return res.json(data);
  } catch (err) {
    console.error('[Get Phone Error]:', err.message);
    return res.status(500).json({ stat: false, message: '获取号码失败', error: err.message });
  }
});

// ----------------------------------------------------
// 接口 3: 轮询短信验证码 (/api/get-sms)
// ----------------------------------------------------
app.get('/api/get-sms', async (req, res) => {
  try {
    const { token, id, phone } = req.query;

    if (!token || !id || !phone) {
      return res.status(400).json({ 
        stat: false, 
        message: '参数缺失: token, id, phone 为必填参数' 
      });
    }

    const data = await callUpstream('apirequirement', { token, id, phone });

    // 可选：在此处给前端做一层提取纯数字验证码的处理
    if (data.code === 200 && data.data) {
      const matched = data.data.match(/\b\d{4,6}\b/);
      data.extracted_code = matched ? matched[0] : null;
    }

    return res.json(data);
  } catch (err) {
    console.error('[Get SMS Error]:', err.message);
    return res.status(500).json({ stat: false, message: '拉取短信失败', error: err.message });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`接码后端服务已启动: http://localhost:${PORT}`);
});
