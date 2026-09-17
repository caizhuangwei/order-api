app.get('/api/check-code', async (req, res) => {
  const targetUrl = req.query.url;
  try {
    const response = await fetch(targetUrl);
    const data = await response.text();
    res.send(data);
  } catch (err) {
    res.status(500).send("Fetch error");
  }
});
