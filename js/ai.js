// ============ AI — Multi-Provider + Dark Sem Filtro ============

async function callAI(prompt) {
  const provider = getAIProvider();
  const key = getAIKey();
  const prov = AI_PROVIDERS[provider];
  if (!prov) throw new Error('Provedor de IA "' + provider + '" nao encontrado.');

  // Providers that don't need a key
  if (prov.auth !== 'none' && !key) {
    throw new Error('Chave de IA nao configurada para ' + prov.name + '. Insira sua chave em "AI API Key" e clique "Salvar Chaves".\n\nDica: ' + prov.keyLabel);
  }

  const model = resolveProviderModel(provider, getSelectedModel());
  
  // Build URL — Gemini uses query auth (key in URL), others use standard endpoint
  let url;
  if (prov.auth === 'query') {
    url = prov.endpoint(model, key);
  } else {
    url = prov.endpoint();
  }

  // Build headers
  const headers = { 'Content-Type': 'application/json' };
  if (prov.auth === 'bearer') {
    headers['Authorization'] = 'Bearer ' + key;
  }
  if (prov.extraHeaders) Object.assign(headers, prov.extraHeaders);

  // Build body
  const body = prov.buildBody(prompt, model);

  // 180s timeout para evitar cortes em modelos lentos/maiores (aumentado para evitar o erro do llm7)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  console.log('[BSF-AI]', prov.name, model, url.split('?')[0]);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    quota.add('ai');

    if (!res.ok) {
      let rawBody = '';
      try { rawBody = await res.text(); } catch(x) {}
      let errDetail = '';
      try {
        const e = JSON.parse(rawBody);
        errDetail = e.error?.message || e.message || e.detail || e.msg || '';
        // Chinese error messages from Zhipu
        if (!errDetail && rawBody.length < 500) errDetail = rawBody;
      } catch(x) {
        if (rawBody.length < 500) errDetail = rawBody;
      }
      
      const code = res.status;
      const base = '[' + prov.name + '] Erro ' + code + ' | Modelo: ' + model;
      
      if (code === 401 || code === 403) {
        throw new Error(base + '\n\nChave invalida ou sem permissao. Verifique:\n• A chave esta correta?\n• O provedor exige cadastro especial?\n\n' + prov.keyLabel + (errDetail ? '\n\nDetalhe: ' + errDetail : ''));
      }
      if (code === 402) {
        throw new Error(base + '\n\nCreditos insuficientes. Troque para um modelo gratuito ou outro provedor.' + (errDetail ? '\n\nDetalhe: ' + errDetail : ''));
      }
      if (code === 404) {
        throw new Error(base + '\n\nModelo "' + model + '" nao encontrado neste provedor. Pode ter sido removido ou renomeado.\n\nTente outro modelo na lista ou troque de provedor.' + (errDetail ? '\n\nDetalhe: ' + errDetail : ''));
      }
      if (code === 400) {
        throw new Error(base + '\n\nRequisicao invalida para este provedor.\n\nVerifique se o modelo e compativel e se a chave tem acesso liberado.' + (errDetail ? '\n\nDetalhe: ' + errDetail : ''));
      }
      if (code === 429) {
        throw new Error(base + '\n\nLimite de requisicoes atingido. Aguarde alguns minutos ou troque de provedor.' + (errDetail ? '\n\nDetalhe: ' + errDetail : ''));
      }
      if (code >= 500) {
        if (errDetail && errDetail.includes('requires more system memory')) {
          throw new Error(base + '\n\nFalta de memoria RAM/VRAM! O modelo escolhido e muito pesado para o seu computador.\n\nDetalhe: ' + errDetail + '\n\nSolucao: Tente um modelo menor (ex: llama3.2:1b ou qwen2.5:3b).');
        }
        throw new Error(base + '\n\nServidor indisponivel. Tente novamente em alguns segundos.' + (errDetail ? '\n\nDetalhe: ' + errDetail : ''));
      }
      throw new Error(base + (errDetail ? '\n\n' + errDetail : '\n\nResposta desconhecida do servidor.'));
    }

    const d = await res.json();
    const text = prov.parseResp(d);
    if (!text) {
      console.warn('[BSF-AI] Resposta vazia:', JSON.stringify(d).substring(0,500));
      throw new Error(prov.name + ' retornou resposta vazia para modelo "' + model + '".\n\nIsso pode indicar que o modelo bloqueou o conteudo ou nao suporta prompts longos.\n\nTente outro modelo ou provedor.');
    }
    return text;

  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('[' + prov.name + '] Timeout: a IA demorou mais de 3 minutos para responder.\n\nModelo: ' + model + '\nIsso acontece muito com modelos gratuitos em horario de pico. Tente:\n• Um modelo menor/mais rapido\n• Outro provedor\n• Rodar a analise novamente');
    }
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.message.includes('net::ERR')) {
      const baseUrl = prov.auth === 'none' ? 'http://localhost:11434' : url.split('/v1')[0];
      const extra = prov.auth === 'none'
        ? '\n• Ollama nao esta em execucao (rode: ollama serve)\n• Modelo local nao instalado (rode: ollama pull llama3.3)'
        : '\n• Internet instavel\n• Provedor bloqueado no seu pais\n• CORS (se usando file://, rode: npx serve .)';
      throw new Error('[' + prov.name + '] Erro de conexao\n\nNao foi possivel conectar com ' + baseUrl + '\n\nPossiveis causas:' + extra);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// Helper to get the selected model from the UI
function getSelectedModel() {
  const sel = document.getElementById('aiModel');
  return sel ? sel.value : resolveProviderModel(getAIProvider(), getStoredAIModel(getAIProvider()));
}

// Base system prompt (adapted from Dark Sem Filtro consulting methodology)
const DSF_SYSTEM = `Voce e um Analista Senior de YouTube especializado em canais Dark e Faceless, da consultoria "Dark Sem Filtro".

REGRAS DE ANALISE:
- Seja denso, preciso e direto. Nao simplifique, nao economize profundidade.
- Use paragrafos completos para analises narrativas, nao listas fragmentadas.
- Sempre explique o PORQUE de cada recomendacao.
- Identifique o que esta nas ENTRELINHAS, nao apenas o obvio.
- Se o canal tiver poucos inscritos, use benchmarking ao inves de metricas internas.
- Foco em POSICIONAMENTO, FORMATO e PROCESSO.

FORMATO DE SAIDA:
- Use EXATAMENTE os cabecalhos solicitados no prompt em formato Markdown (## Nome do Cabecalho).
- Use **negrito** para termos-chave.
- Use paragrafos completos, nao balas soltas.
- Tabelas apenas para comparacoes com multiplas dimensoes.`;

// Interactive analysis functions
async function aiChannelAnalysis(ch, userContext = '') {
  const vpw = calcVidsPerWeek(ch.vids, ch.created);
  const vpv = ch.vids ? Math.round(ch.views/ch.vids) : 0;
  return callAI(`${DSF_SYSTEM}

Analise este canal YouTube de forma profunda, como preparacao para consultoria Dark Sem Filtro.

CANAL: ${ch.title}
Inscritos: ${fmtFull(ch.subs)} | Views totais: ${fmtFull(ch.views)} | Videos: ${ch.vids}
Videos por semana: ${vpw} | Views por video: ${fmtNum(vpv)}
Pais: ${ch.country} | Criado em: ${fmtDate(ch.created)}
Handle: ${ch.url || ch.id}
Descricao: ${ch.desc.substring(0,500)}
${userContext ? '\nCONTEXTO DO USUARIO: ' + userContext : ''}

Gere o relatorio completo em portugues com Markdown:

## Diagnostico Geral
Qual e o real estagio deste canal? Reinterprete com senso critico. Qual e o gargalo invisivel — o problema que o criador provavelmente nao esta enxergando?

## Posicionamento e Mercado
Subnicho, publico-alvo, dor/desejo principal, nivel de concorrencia BR. A proposta de valor e coerente?

## Potencial Faceless (nota 1-10 com justificativa)
Pode ser replicado sem aparecer? O formato e viavel? Qual o modelo de conteudo?

## Arquitetura de Conteudo
Formato ideal, duracao recomendada com justificativa, estilo visual, estrutura de roteiro sugerida.

## 5 Ideias de Video Concretas
Ideias especificas, com titulos prontos para publicar. Para cada uma: por que funciona e qual gancho usar.

## Estrategia 30 Dias
Pipeline pratico: o que publicar, com que frequencia, como medir resultados.

## Riscos e Compliance
Copyright, conteudo reutilizado, cifrão amarelo, monetizacao.`);
}

async function aiVideoAnalysis(v, userContext = '', transcript = '') {
  return callAI(`${DSF_SYSTEM}

Analise este video de forma tecnica e estrategica, focando no potencial faceless.

TITULO: ${v.title}
Canal: ${v.channel} | Views: ${fmtFull(v.views)} | Likes: ${fmtFull(v.likes)} | Comentarios: ${fmtFull(v.comments)}
Engajamento: ${v.eng}% | Duracao: ${v.durStr} | ${v.isShort ? 'SHORT' : 'Video Longo'}
Definicao: ${v.definition} | Legenda: ${v.caption ? 'Sim' : 'Nao'}
Tags: ${v.tags.slice(0,15).join(', ')||'Nenhuma'}
Publicado: ${fmtDate(v.published)}
Descricao (trecho): ${v.desc.substring(0,300)}
${transcript ? '\nTRANSCRICAO (Resumo/Completa): ' + transcript.substring(0, 15000) : '\nTRANSCRICAO: Indisponivel ou nao extraida.'}
${userContext ? '\nCONTEXTO DO USUARIO: ' + userContext : ''}

Gere o relatorio em portugues com Markdown:

## Estrutura e Retenção
Por que este vídeo viralizou (ou falhou)? Analise o Hook (gancho inicial), o Pacing (ritmo) e o Storytelling. Detalhe como a atenção é mantida ao longo do vídeo com base no assunto e na transcrição (se houver). Quais são os "CTAs invisíveis" ou gatilhos psicológicos usados?

## Público-Alvo e Posicionamento
Quem é o espectador ideal? Qual dor ou desejo profundo este vídeo resolve? Como ele se diferencia no mercado atual (Brasil/Global)?

## Avaliação de Engajamento
Avalie a proporção de Likes/Views e Comentários/Views. É um engajamento alto para a média do YouTube? O que isso revela sobre a conexão do criador com a audiência?

## Modelagem Faceless (Modo "Copy, Don't Paste")
Liste 3 formas práticas e distintas de recriar este exato formato **sem aparecer**.
Para cada forma: 
- Qual o conceito adaptado? 
- Quais ferramentas usar (ex: ElevenLabs, Midjourney, banco de vídeos)?
- Nível de viabilidade e dificuldade.

## Sugestão de Novo Título e Gancho
Crie 3 novos títulos Altamente Clicáveis (CTR Alto) no mesmo estilo, e escreva o Roteiro Exato dos primeiros 15 segundos para prender a pessoa imediatamente.`);
}

async function aiCompare(a, b, userContext = '') {
  const aVpw = calcVidsPerWeek(a.vids, a.created);
  const bVpw = calcVidsPerWeek(b.vids, b.created);
  return callAI(`${DSF_SYSTEM}

Compare estes canais como analista de mercado Dark Sem Filtro:

CANAL A: ${a.title}
Inscritos: ${fmtFull(a.subs)} | Views Totais: ${fmtFull(a.views)} | Videos: ${a.vids} | Vids/semana: ${aVpw} | Pais: ${a.country}
Views Recentes (média): ${fmtFull(a.avgViews)} | Engajamento Médio: ${a.avgEng}% | % Shorts: ${a.shortsPct}% | Duração média: ${fmtTime(a.avgDur)}

CANAL B: ${b.title}
Inscritos: ${fmtFull(b.subs)} | Views Totais: ${fmtFull(b.views)} | Videos: ${b.vids} | Vids/semana: ${bVpw} | Pais: ${b.country}
Views Recentes (média): ${fmtFull(b.avgViews)} | Engajamento Médio: ${b.avgEng}% | % Shorts: ${b.shortsPct}% | Duração média: ${fmtTime(b.avgDur)}

${userContext ? `CONTEXTO DO USUÁRIO:\n${userContext}\n` : ''}
Relatorio em portugues com Markdown:
## Comparativo Geral
## Eficiencia de Conteudo
Qual canal converte melhor views em inscritos? Qual tem melhor views/video?
## Qualidade das Metricas (Aprofundado)
Analise o engajamento medio de cada um, formato escolhido (% de Shorts), e capacidade de retencao visual com base nessas metricas.
## Analise de Nicho e Posicionamento
## Pontos Fortes e Fracos de Cada Um
## Veredicto para Canal Faceless
Se voce fosse comecar um canal dark hoje, qual modelo seguiria e por que?`);
}

async function aiTrending(videos, label, userContext = '') {
  const top = videos.slice(0,10).map((v,i)=>`${i+1}. "${v.title}" (${v.channel}) — ${fmtNum(v.views)} views, ${v.eng}% eng, ${v.durStr}`).join('\n');
  return callAI(`${DSF_SYSTEM}

Analise os videos em alta de ${label} e identifique oportunidades para canais dark/faceless:

TOP 10:
${top}

${userContext ? `CONTEXTO DO USUÁRIO:\n${userContext}\n` : ''}
Relatorio em portugues com Markdown:
## Tendencias Dominantes
Quais padroes se repetem? Quais nichos estao em alta?
## Oportunidades Faceless
Quais trends sao replicaveis sem aparecer na camera?
## Nichos em Alta com Baixa Concorrencia
## 5 Ideias de Video Faceless (com titulos prontos)
Para cada: titulo, formato, duracao, gancho de abertura.
## Acao Imediata
O que publicar HOJE para surfar nos trends. Seja especifico e operacional.`);
}

async function aiHistory(ch, vids, userContext = '') {
  const vpw = calcVidsPerWeek(ch.vids, ch.created);
  const list = vids.slice(0,15).map((v,i)=>`${i+1}. "${v.title}" — ${fmtNum(v.views)} views, ${v.eng}% eng, ${v.durStr}, ${v.isShort?'SHORT':'Longo'}, ${timeAgo(v.published)}`).join('\n');
  return callAI(`${DSF_SYSTEM}

Analise a performance recente deste canal como consultor Dark Sem Filtro:

CANAL: ${ch.title} (${fmtFull(ch.subs)} subs, ${vpw} vids/semana)

ULTIMOS VIDEOS:
${list}

${userContext ? `CONTEXTO DO USUÁRIO:\n${userContext}\n` : ''}
Relatorio em portugues com Markdown:
## Diagnostico de Performance
Media de views, tendencia (crescimento ou queda?), consistencia.
## Padrao de Conteudo
Que tipo de video performa melhor? Duracao ideal? Shorts vs Longos?
## Top 3 Formatos que Funcionam
Identifique padroes nos videos de melhor performance.
## Gargalos Invisiveis
O que esta impedindo o crescimento? Analise frequencia, qualidade dos titulos, variedade.
## Recomendacoes Operacionais
O que mudar esta semana para melhorar resultados. Seja especifico.`);
}

async function aiKeywords(idea, niche, lang, country) {
  return callAI(`${DSF_SYSTEM}

Atue como um Especialista em SEO do YouTube focado em Canais Dark.
Gere 20 ideias de palavras-chave altamente buscadas e com potencial de viralização para o seguinte contexto:

Assunto Adicional/Ideia: ${idea || 'Nenhum especifico'}
Nicho Principal: ${niche || 'Nao informado'}
Idioma: ${lang}
Publico/Pais: ${country}

MUITO IMPORTANTE: Se o "Assunto Adicional/Ideia" foi preenchido, ele é o SEU FOCO PRINCIPAL. O "Nicho" serve APENAS de contexto metodológico. Exemplo: se a ideia for "UNO" no nicho "IA", a keyword não deve ser só sobre IA, mas sim "Como criar um jogo de UNO usando IA". Jamais ignore a "Ideia" informada!

Estruture a resposta em Markdown com a seguinte organizacao:

## Top 10 Palavras-chave de Cauda Longa (Long-tail)
As melhores oportunidades para rankear rapido.

## 5 Termos Broad/Alta Concorrencia
Palavras mais dificeis, porem com volume extremo.

## 5 Ideias de Titulos Clickbait (Eticos)
Titulos que geram extrema curiosidade usando as palavras-chave acima.

Seja direto, nao use introducoes generalistas. Retorne as listas formatadas em bullet points claramente legiveis.`);
}
