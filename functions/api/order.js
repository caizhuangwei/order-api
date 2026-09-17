const express = require('express');
const axios = require('axios');
const app = express();

app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('缺少 url');

  try {
    const response = await axios.get(targetUrl, { timeout: 8000 });
    res.json(response.data);
  } catch (err) {
    res.status(500).send('Fetch Error');
  }
});
