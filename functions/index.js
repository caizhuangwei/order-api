// server.js — 需要安装 node-fetch 或使用 Node 18+ 自带的 fetch
const express = require('express');
const app = express();
app.use(express.static('.')); // 托管你的 HTML 文件

app.get('/proxy', async (req, res) => {
  const target = 'https://api.sms8.net/api/record'
    + '?token=' + req.query.token
    + '&phone=' + req.query.phone;
  const r = await fetch(target);
  const text = await r.text();
  res.type('application/json').send(text);
});

app.listen(3000, () => console.log('http://localhost:3000'));
