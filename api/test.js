// GET /api/test — diagnóstico da API Anthropic
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY não definida' });

  // Lista os modelos disponíveis na conta
  try {
    const r = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      }
    });
    const data = await r.json();
    return res.status(r.status).json({ status: r.status, models: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
