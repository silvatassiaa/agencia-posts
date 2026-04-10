// POST /api/generate-ideas
// Receives: { clientId }
// Returns:  { ideas: [...], sessionId }

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Check env vars
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada no Vercel. Vá em Settings → Environment Variables.' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Variáveis SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas no Vercel.' });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { clientId } = req.body;
    if (!clientId) return res.status(400).json({ error: 'clientId é obrigatório' });

    // Load client data
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Cliente não encontrado: ' + (clientErr?.message || '') });
    }

    const b = client.briefing || {};

    // Fetch website content (best effort)
    let websiteContent = '';
    if (client.website) {
      try {
        const r = await fetch(client.website, {
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const html = await r.text();
        websiteContent = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 3000);
      } catch {
        websiteContent = '(site não acessível no momento)';
      }
    }

    const prompt = `Você é um estrategista de conteúdo especialista em redes sociais, especialmente Instagram.

## BRIEFING DO CLIENTE

**Negócio:** ${client.business_name}
**Segmento:** ${b.segment || 'não informado'}
**Descrição:** ${b.description || 'não informado'}
**Instagram:** ${client.instagram_handle ? '@' + client.instagram_handle : 'não informado'}
**Site:** ${client.website || 'não informado'}
**Público-alvo:** ${b.audience || 'não informado'}
**Faixa etária:** ${b.age || 'não informado'}
**Dores e desejos:** ${b.painpoints || 'não informado'}
**Tom de voz:** ${(b.tone || []).join(', ') || 'não definido'}
**Palavras-chave da marca:** ${b.keywords || 'não informado'}
**Evitar:** ${b.avoid || 'nada especificado'}
**Produtos em destaque:** ${b.products || 'não especificado'}
**Objetivos:** ${(b.goals || []).join(', ') || 'não definido'}
**Observações extras:** ${b.notes || 'nenhuma'}

## CONTEÚDO DO SITE
${websiteContent || '(não disponível)'}

---

## TAREFA

Crie uma lista de **30 ideias únicas e estratégicas de posts para o Instagram** desse negócio.

As ideias devem:
- Ser altamente específicas para o nicho e público desse negócio
- Cobrir diferentes formatos: carousel (40%), reels (30%), feed (20%), stories (10%)
- Incluir ideias de engajamento, educação, entretenimento, e vendas
- Usar o tom de voz definido no briefing
- Ser práticas e executáveis

## FORMATO DE RESPOSTA

Responda SOMENTE com um JSON válido, sem markdown, sem explicações extras. Exatamente assim:

{"ideas":[{"position":1,"title":"Título criativo","format":"carousel","hook":"Gancho do post","theme":"Educação","rationale":"Por que funciona"}]}

Gere exatamente 30 ideias. Os campos obrigatórios são: position, title, format, hook, theme, rationale.`;

    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages:   [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim();

    // Parse JSON — extrair mesmo que tenha texto extra
    let json;
    try {
      // Tenta direto
      json = JSON.parse(raw);
    } catch {
      // Tenta extrair o JSON do meio do texto
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Claude não retornou JSON válido. Resposta: ' + raw.substring(0, 200));
      json = JSON.parse(match[0]);
    }

    const ideas = json.ideas || [];
    if (ideas.length === 0) throw new Error('Nenhuma ideia foi gerada');

    // Create session
    const { data: session, error: sessErr } = await supabase
      .from('post_sessions')
      .insert({ client_id: clientId })
      .select()
      .single();

    if (sessErr) throw new Error('Erro ao criar sessão: ' + sessErr.message);

    // Save ideas
    const { data: savedIdeas, error: ideasErr } = await supabase
      .from('post_ideas')
      .insert(ideas.map(idea => ({
        session_id: session.id,
        client_id:  clientId,
        title:      idea.title,
        format:     idea.format,
        hook:       idea.hook,
        theme:      idea.theme,
        rationale:  idea.rationale,
        position:   idea.position,
        selected:   false,
      })))
      .select();

    if (ideasErr) throw new Error('Erro ao salvar ideias: ' + ideasErr.message);

    return res.status(200).json({ ideas: savedIdeas, sessionId: session.id });

  } catch (err) {
    console.error('generate-ideas error:', err);
    return res.status(500).json({ error: err.message || 'Erro interno ao gerar ideias' });
  }
}
