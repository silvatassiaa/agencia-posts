// POST /api/generate-post
// Receives: { queueId }
// Returns:  { success: true, postId }
// Generates copy + art for a queued post item

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { queueId } = req.body;
  if (!queueId) return res.status(400).json({ error: 'queueId is required' });

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
  const colors = client.brand_colors || { primary: '#6366f1', secondary: '#111827', text: '#ffffff' };

  try {
    // ── STEP 1: Generate copy with Claude ──────────────────────────────
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

${idea.format === 'carousel' ? `Para CARROSSEL, crie textos para 6-8 slides:
- Slide 1: Cover com gancho poderoso (max 10 palavras)
- Slides 2-N: Conteúdo principal (max 30 palavras por slide)
- Último slide: CTA` : ''}

Responda SOMENTE com JSON válido:
{
  "caption": "Legenda completa do post (200-400 caracteres, quebras de linha com \\n)",
  "slide_texts": ["Texto slide 1", "Texto slide 2", "..."],
  "cta": "Call-to-action direto (ex: Qual é o seu favorito? Comenta abaixo!)",
  "hashtags": ["hashtag1", "hashtag2"],
  "talking_points": ["Ponto chave 1", "Ponto chave 2", "Ponto chave 3"]
}

- caption: use o tom ${(b.tone || ['autêntico']).join(', ')}
- slide_texts: ${idea.format === 'carousel' ? '6-8 textos curtos e impactantes' : '3-5 pontos principais'}
- hashtags: 15-20 hashtags relevantes (sem o # no JSON, só a palavra)
- talking_points: 3-5 pontos-chave do post`;

    const copyMsg = await anthropic.messages.create({
      model:      'claude-opus-4-6',
      max_tokens: 2000,
      messages:   [{ role: 'user', content: copyPrompt }],
    });

    const copyRaw  = copyMsg.content[0].text.trim();
    const copyJson = JSON.parse(copyRaw.startsWith('{') ? copyRaw : copyRaw.match(/\{[\s\S]*\}/)?.[0]);

    // ── STEP 2: Generate HTML slides ──────────────────────────────────
    const slides = generateSlideHTML(idea, copyJson, client, colors);

    // ── STEP 3: Render slides with Puppeteer ──────────────────────────
    const artUrls = [];
    let browser;

    try {
      browser = await puppeteer.launch({
        args:            chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath:  await chromium.executablePath(),
        headless:        chromium.headless,
      });

      const page = await browser.newPage();
      await page.setViewportSize({ width: 1080, height: 1440 });

      for (let i = 0; i < slides.length; i++) {
        await page.setContent(slides[i], { waitUntil: 'networkidle0' });
        const screenshot = await page.screenshot({ type: 'png', fullPage: false });

        // Upload to Supabase Storage
        const fileName = `${queueId}/slide-${String(i+1).padStart(2,'0')}.png`;
        await supabase.storage
          .from('post-arts')
          .upload(fileName, screenshot, { contentType: 'image/png', upsert: true });

        const { data: { publicUrl } } = supabase.storage
          .from('post-arts')
          .getPublicUrl(fileName);

        artUrls.push(publicUrl);
      }
    } finally {
      if (browser) await browser.close();
    }

    // ── STEP 4: Save results ───────────────────────────────────────────
    await supabase.from('post_queue').update({
      status:       'done',
      copy:         copyJson,
      art_urls:     artUrls,
      completed_at: new Date().toISOString(),
    }).eq('id', queueId);

    return res.status(200).json({ success: true, artUrls, copy: copyJson });
  } catch (err) {
    console.error('generate-post error:', err);
    await supabase.from('post_queue').update({ status: 'failed' }).eq('id', queueId);
    return res.status(500).json({ error: err.message || 'Erro ao gerar post' });
  }
}

// ── HTML slide generator ─────────────────────────────────────────────────────

function generateSlideHTML(idea, copy, client, colors) {
  const primary    = colors.primary   || '#6366f1';
  const secondary  = colors.secondary || '#111827';
  const textColor  = colors.text      || '#ffffff';
  const brandName  = client.business_name;
  const handle     = client.instagram_handle ? '@' + client.instagram_handle : '@' + brandName.toLowerCase().replace(/\s+/g,'');

  const isLight    = isLightColor(secondary);
  const textDark   = isLight ? '#1a1a1a' : textColor;
  const mutedDark  = isLight ? '#666666' : 'rgba(255,255,255,0.6)';
  const bg         = secondary;
  const bgAlt      = isLight ? '#f8f8f8' : '#0a0a14';

  const fonts = `<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&display=swap" rel="stylesheet">`;

  const baseStyle = `
    * { margin:0; padding:0; box-sizing:border-box; }
    body { width:1080px; height:1440px; overflow:hidden; font-family:'Poppins','Segoe UI',sans-serif; }
    .header { display:flex; align-items:center; justify-content:space-between; padding:36px 52px 0; }
    .handle { font-size:26px; font-weight:700; color:${textDark}; }
    .handle span { color:${primary}; }
    .badge-num { font-size:20px; font-weight:800; color:${primary}; background:rgba(99,102,241,0.12); border:2px solid ${primary}; padding:5px 18px; border-radius:28px; }
    .footer { display:flex; align-items:center; justify-content:space-between; padding:20px 52px 32px; }
    .dots { display:flex; gap:8px; }
    .dot { width:8px; height:8px; border-radius:50%; background:rgba(255,255,255,0.2); }
    .dot.active { background:${primary}; width:22px; border-radius:4px; }
    .islight .dot { background:rgba(0,0,0,0.15); }
    .islight .dot.active { background:${primary}; }
    .pg { font-size:20px; font-weight:600; color:${mutedDark}; }
  `;

  const slideTexts = copy.slide_texts || [];
  const totalSlides = slideTexts.length > 1 ? slideTexts.length + 2 : 4; // cover + content + cta

  const slides = [];

  // Slide 1 — Cover
  slides.push(`<!DOCTYPE html><html><head><meta charset="UTF-8">${fonts}<style>
    ${baseStyle}
    body { background: ${bg}; display:flex; flex-direction:column; }
    .main { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px 52px; text-align:center; }
    .tag { background:${primary}; color:white; font-size:20px; font-weight:700; padding:8px 24px; border-radius:36px; letter-spacing:1px; text-transform:uppercase; margin-bottom:40px; }
    .title { font-size:${idea.title.length > 40 ? '58px' : '68px'}; font-weight:900; color:${textDark}; line-height:1.1; margin-bottom:32px; }
    .title em { color:${primary}; font-style:normal; }
    .hook { font-size:30px; font-weight:500; color:${mutedDark}; max-width:800px; line-height:1.5; }
    .divider { width:72px; height:6px; background:${primary}; border-radius:3px; margin:32px auto; }
    .swipe { position:absolute; bottom:80px; right:52px; font-size:22px; font-weight:600; color:${mutedDark}; }
  </style></head><body class="${isLight ? 'islight' : ''}">
    <div class="header">
      <div class="handle"><span>@</span>${handle.replace('@','')}</div>
    </div>
    <div class="main">
      <div class="tag">${idea.theme || '📱 Post'}</div>
      <div class="title">${formatTitle(idea.title, primary)}</div>
      <div class="divider"></div>
      <div class="hook">${idea.hook}</div>
    </div>
    <div class="footer">
      <div class="dots">${Array.from({length:Math.min(totalSlides,8)},(_,i)=>`<div class="dot${i===0?' active':''}"></div>`).join('')}</div>
      <div class="pg">1 / ${totalSlides}</div>
    </div>
    <div class="swipe">deslize →</div>
  </body></html>`);

  // Content slides
  slideTexts.forEach((text, idx) => {
    const isEven    = idx % 2 === 0;
    const slideBg   = isEven ? bgAlt : bg;
    const slideText = isEven && isLight ? '#1a1a1a' : textDark;
    const slideMuted= isEven && isLight ? '#666' : mutedDark;
    const slideNum  = idx + 2;

    slides.push(`<!DOCTYPE html><html><head><meta charset="UTF-8">${fonts}<style>
      ${baseStyle}
      body { background:${slideBg}; display:flex; flex-direction:column; }
      .main { flex:1; display:flex; flex-direction:column; justify-content:center; padding:52px; }
      .slide-num { font-size:20px; font-weight:800; color:${primary}; text-transform:uppercase; letter-spacing:2px; margin-bottom:20px; }
      .text { font-size:52px; font-weight:800; color:${slideText}; line-height:1.2; margin-bottom:32px; }
      .text em { color:${primary}; font-style:normal; }
      .divider { width:72px; height:6px; background:${primary}; border-radius:3px; margin-bottom:32px; }
      .caption { font-size:28px; font-weight:500; color:${slideMuted}; line-height:1.6; max-width:900px; }
    </style></head><body class="${(isEven && isLight) ? 'islight' : ''}">
      <div class="header">
        <div class="handle"><span>@</span>${handle.replace('@','')}</div>
        <div class="badge-num">${String(idx+1).padStart(2,'0')} / ${String(slideTexts.length).padStart(2,'0')}</div>
      </div>
      <div class="main">
        <div class="text">${text}</div>
        <div class="divider"></div>
      </div>
      <div class="footer">
        <div class="dots">${Array.from({length:Math.min(totalSlides,8)},(_,i)=>`<div class="dot${i===slideNum-1?' active':''}"></div>`).join('')}</div>
        <div class="pg">${slideNum} / ${totalSlides}</div>
      </div>
    </body></html>`);
  });

  // CTA slide
  const ctaSlide = totalSlides;
  slides.push(`<!DOCTYPE html><html><head><meta charset="UTF-8">${fonts}<style>
    ${baseStyle}
    body { background:${bg}; display:flex; flex-direction:column; }
    .top-bar { width:100%; height:10px; background:${primary}; }
    .main { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:52px; text-align:center; }
    .question { font-size:56px; font-weight:900; color:${textDark}; line-height:1.2; margin-bottom:32px; }
    .question em { color:${primary}; font-style:normal; }
    .cta-box { background:${primary}; border-radius:20px; padding:28px 44px; margin-top:32px; }
    .cta-text { font-size:28px; font-weight:700; color:white; }
    .brand { font-size:24px; font-weight:600; color:${mutedDark}; margin-top:20px; }
    .bottom-bar { width:100%; height:10px; background:${primary}; }
  </style></head><body class="${isLight ? 'islight' : ''}">
    <div class="top-bar"></div>
    <div class="header">
      <div class="handle"><span>@</span>${handle.replace('@','')}</div>
    </div>
    <div class="main">
      <div class="question">${formatTitle(copy.cta || 'O que você achou?', primary)}</div>
      <div class="cta-box">
        <div class="cta-text">👇 Comenta aí embaixo</div>
      </div>
      <div class="brand">${brandName}</div>
    </div>
    <div class="footer">
      <div class="dots">${Array.from({length:Math.min(totalSlides,8)},(_,i)=>`<div class="dot${i===ctaSlide-1?' active':''}"></div>`).join('')}</div>
      <div class="pg">${ctaSlide} / ${totalSlides}</div>
    </div>
    <div class="bottom-bar"></div>
  </body></html>`);

  return slides;
}

function formatTitle(text, accent) {
  // Bold last word or keyword
  return text.replace(/\*([^*]+)\*/g, `<em>$1</em>`);
}

function isLightColor(hex) {
  const c = hex.replace('#','');
  const r = parseInt(c.substr(0,2),16);
  const g = parseInt(c.substr(2,2),16);
  const b = parseInt(c.substr(4,2),16);
  return (0.299*r + 0.587*g + 0.114*b) > 128;
}
