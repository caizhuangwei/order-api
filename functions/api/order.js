const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// 配置 CORS，精确允许你的 Cloudflare Pages 域名（以及本地测试环境）
const allowedOrigins = [
  'https://order-api.pages.dev',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];

app.use(cors({
  origin: function (origin, callback) {
    // 允许无 origin 的请求（如移动端应用或 curl），或在白名单内的域名
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('CORS 策略已拦截该来源的请求'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// 第三方接码平台地址
const UPSTREAM_HOST = 'http://api.tyasdbsd.cyou:6722';

/**
 * 辅助函数：处理特殊 URL 结构 (/nats?action?query)
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

// 接口 1: 登录获取 Token
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

// 接口 2: 获取手机号
app.get('/api/get-phone', async (req, res) => {
  try {
    const { token, id, haomaku, phone } = req.query;
    if (!token || !id || !haomaku) {
      return res.status(400).json({ stat: false, message: '参数缺失: token, id, haomaku 为必填项' });
    }

    const params = { token, haomaku, id };
    if (phone) params.phone = phone;

    const data = await callUpstream('apinumber', params);
    return res.json(data);
  } catch (err) {
    console.error('[Get Phone Error]:', err.message);
    return res.status(500).json({ stat: false, message: '获取号码失败', error: err.message });
  }
});

// 接口 3: 轮询短信
app.get('/api/get-sms', async (req, res) => {
  try {
    const { token, id, phone } = req.query;
    if (!token || !id || !phone) {
      return res.status(400).json({ stat: false, message: '参数缺失: token, id, phone 为必填项' });
    }

    const data = await callUpstream('apirequirement', { token, id, phone });

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

// 健康检测探针（方便直接在浏览器验证后端是否通畅）
app.get('/health', (req, res) => {
  res.send('Server is running normally');
});

app.listen(PORT, () => {
  console.log(`接码后端服务已就绪，端口: ${PORT}`);
});
