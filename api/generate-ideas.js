// POST /api/generate-ideas
// Receives: { clientId }
// Returns:  { ideas: [...], sessionId }

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });

  // Load client data
  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();
  if (clientErr || !client) return res.status(404).json({ error: 'Cliente não encontrado' });

  const b = client.briefing || {};

  // Fetch website content (best effort)
  let websiteContent = '';
  if (client.website) {
    try {
      const r = await fetch(client.website, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await r.text();
      // Strip HTML tags, keep text
      websiteContent = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 3000);
    } catch { websiteContent = '(site não acessível)'; }
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

Responda SOMENTE com um JSON válido, sem markdown, sem explicações. Exatamente assim:

{
  "ideas": [
    {
      "position": 1,
      "title": "Título criativo e específico do post",
      "format": "carousel",
      "hook": "Primeira frase/gancho que aparece no post para prender a atenção",
      "theme": "Educação | Entretenimento | Engajamento | Venda | Comunidade",
      "rationale": "Por que esse post funciona para esse negócio (1 frase)"
    }
  ]
}

Gere exatamente 30 ideias. Seja específico e criativo — evite ideias genéricas.`;

  try {
    const message = await anthropic.messages.create({
      model:      'claude-opus-4-6',
      max_tokens: 4000,
      messages:   [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim();
    const json = JSON.parse(raw.startsWith('{') ? raw : raw.match(/\{[\s\S]*\}/)?.[0]);
    const ideas = json.ideas || [];

    if (ideas.length === 0) throw new Error('Nenhuma ideia gerada');

    // Create session
    const { data: session } = await supabase
      .from('post_sessions')
      .insert({ client_id: clientId })
      .select().single();

    // Save ideas
    const { data: savedIdeas } = await supabase
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

    return res.status(200).json({ ideas: savedIdeas, sessionId: session.id });
  } catch (err) {
    console.error('generate-ideas error:', err);
    return res.status(500).json({ error: err.message || 'Erro interno ao gerar ideias' });
  }
}
