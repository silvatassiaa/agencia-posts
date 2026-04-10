// POST /api/generate-post
// Receives: { queueId }
// Returns:  { success: true }
// Generates copy + slide texts (art rendering is done client-side)

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return res.status(500).json({ error: 'Variáveis Supabase não configuradas' });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { queueId } = req.body;
    if (!queueId) return res.status(400).json({ error: 'queueId é obrigatório' });

    // Load queue item + idea + client
    const { data: qItem, error } = await supabase
      .from('post_queue')
      .select('*, post_ideas(*), clients(*)')
      .eq('id', queueId)
      .single();

    if (error || !qItem) return res.status(404).json({ error: 'Item não encontrado na fila' });

    const client = qItem.clients;
    const idea   = qItem.post_ideas;
    const b      = client.briefing || {};

    // Generate copy with Claude
    const copyPrompt = `Você é um copywriter especialista em conteúdo para Instagram.

## CLIENTE
**Negócio:** ${client.business_name}
**Segmento:** ${b.segment || ''}
**Público:** ${b.audience || ''}
**Tom de voz:** ${(b.tone || []).join(', ')}
**Palavras da marca:** ${b.keywords || ''}
**Evitar:** ${b.avoid || ''}

## POST A CRIAR
**Título/Tema:** ${idea.title}
**Formato:** ${idea.format}
**Hook (gancho):** ${idea.hook}
**Tema:** ${idea.theme}
**Racional:** ${idea.rationale}

## TAREFA
Crie o conteúdo completo para esse post do Instagram.

${idea.format === 'carousel' ? `Para CARROSSEL, crie textos para 6 slides:
- Slide 1: Cover com gancho poderoso (max 8 palavras)
- Slides 2-5: Conteúdo principal (max 25 palavras por slide)
- Slide 6: CTA` : `Crie 4 pontos principais para o post.`}

Responda SOMENTE com JSON válido, sem markdown:
{"caption":"legenda completa (200-400 caracteres)","slide_texts":["texto 1","texto 2","texto 3","texto 4","texto 5","texto 6"],"cta":"call-to-action direto","hashtags":["hashtag1","hashtag2"],"talking_points":["ponto 1","ponto 2","ponto 3"]}

Regras:
- caption: tom ${(b.tone || ['autêntico']).join(', ')}, em português
- hashtags: 15 hashtags relevantes, sem o # (só a palavra)
- talking_points: 3-5 pontos-chave`;

    const copyMsg = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages:   [{ role: 'user', content: copyPrompt }],
    });

    const raw = copyMsg.content[0].text.trim();
    let copyJson;
    try {
      copyJson = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Claude não retornou JSON válido');
      copyJson = JSON.parse(match[0]);
    }

    // Save copy to queue (no art rendering — done in browser)
    const { error: updateErr } = await supabase
      .from('post_queue')
      .update({
        status:       'done',
        copy:         copyJson,
        art_urls:     [],
        completed_at: new Date().toISOString(),
      })
      .eq('id', queueId);

    if (updateErr) throw new Error('Erro ao salvar: ' + updateErr.message);

    return res.status(200).json({ success: true, copy: copyJson });

  } catch (err) {
    console.error('generate-post error:', err);
    await createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
      .from('post_queue').update({ status: 'failed' }).eq('id', req.body?.queueId);
    return res.status(500).json({ error: err.message || 'Erro ao gerar post' });
  }
}
