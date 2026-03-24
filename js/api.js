// ============ YouTube Data API v3 ============
const YT = 'https://www.googleapis.com/youtube/v3';

async function ytFetch(endpoint, params) {
  const key = getYTKey();
  if (!key) throw new Error('Chave do YouTube não configurada.');
  params.key = key;
  const url = `${YT}/${endpoint}?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error?.message || 'Erro na API do YouTube. Verifique sua chave.'); }
  return res.json();
}

async function resolveChannelId(input) {
  input = input.trim();
  if (input.startsWith('UC') && input.length === 24) return input;
  let handle = '';
  if (input.includes('youtube.com') || input.includes('youtu.be')) {
    try {
      const u = new URL(input.startsWith('http') ? input : 'https://'+input);
      const p = u.pathname;
      if (p.startsWith('/@')) handle = p.substring(1);
      else if (p.startsWith('/channel/')) return p.split('/channel/')[1].split('/')[0];
      else if (p.startsWith('/c/')) handle = '@'+p.split('/c/')[1].split('/')[0];
      else handle = p.replace('/','');
    } catch(e) {}
  } else handle = input.startsWith('@') ? input : '@'+input;
  if (handle) {
    const d = await ytFetch('search', { part:'snippet', q:handle, type:'channel', maxResults:1 });
    quota.add('yt', API_LIMITS.yt.costSearch);
    if (d.items?.length) return d.items[0].snippet.channelId;
    throw new Error(`Canal "${input}" não encontrado.`);
  }
  throw new Error('Formato inválido. Use @handle, URL ou Channel ID.');
}

async function fetchChannel(chId) {
  const d = await ytFetch('channels', { part:'snippet,statistics,brandingSettings,contentDetails', id:chId });
  quota.add('yt', API_LIMITS.yt.costList);
  if (!d.items?.length) throw new Error('Canal não encontrado.');
  const c = d.items[0];
  const s = c.statistics;
  return {
    id: c.id,
    title: c.snippet.title,
    desc: c.snippet.description || '',
    url: c.snippet.customUrl || '',
    avatar: c.snippet.thumbnails?.high?.url || c.snippet.thumbnails?.default?.url || '',
    bannerUrl: c.brandingSettings?.image?.bannerExternalUrl || '',
    country: c.snippet.country || '--',
    created: c.snippet.publishedAt,
    subs: parseInt(s.subscriberCount)||0,
    views: parseInt(s.viewCount)||0,
    vids: parseInt(s.videoCount)||0,
    hiddenSubs: s.hiddenSubscriberCount||false,
    uploadsId: c.contentDetails?.relatedPlaylists?.uploads || ''
  };
}

async function fetchVideo(input) {
  let vid = input.trim();
  if (vid.includes('youtube.com') || vid.includes('youtu.be')) {
    try {
      const u = new URL(vid.startsWith('http') ? vid : 'https://'+vid);
      vid = u.hostname.includes('youtu.be') ? u.pathname.substring(1) : (u.searchParams.get('v') || u.pathname.split('/').pop());
    } catch(e) {}
  }
  // Remove shorts/ prefix
  vid = vid.replace('shorts/','');
  const d = await ytFetch('videos', { part:'snippet,statistics,contentDetails,topicDetails', id:vid });
  quota.add('yt', API_LIMITS.yt.costList);
  if (!d.items?.length) throw new Error('Vídeo não encontrado.');
  const v = d.items[0];
  const st = v.statistics;
  const views = parseInt(st.viewCount)||0;
  const likes = parseInt(st.likeCount)||0;
  const comments = parseInt(st.commentCount)||0;
  const durSec = getDurationSec(v.contentDetails.duration);
  return {
    id: v.id, title: v.snippet.title, desc: v.snippet.description||'',
    channel: v.snippet.channelTitle, channelId: v.snippet.channelId,
    thumb: v.snippet.thumbnails?.maxres?.url || v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.medium?.url || '',
    published: v.snippet.publishedAt,
    durSec, durStr: fmtTime(durSec),
    isShort: durSec > 0 && durSec <= 60,
    views, likes, comments,
    eng: calcEng(views, likes, comments),
    tags: v.snippet.tags||[],
    catId: v.snippet.categoryId||'',
    topics: v.topicDetails?.topicCategories || [],
    definition: v.contentDetails.definition || 'sd',
    caption: v.contentDetails.caption === 'true'
  };
}

window.fetchVideoTranscript = async function(videoId) {
  try {
    // Usando uma API proxy pública para contornar CORS e extrair transcrição
    const res = await fetch(`https://subtitles-youtube.vercel.app/api/video/${videoId}`);
    if (!res.ok) return '';
    const data = await res.json();
    if (data && data.text) {
      return data.text;
    }
    return '';
  } catch(e) {
    return '';
  }
};

async function fetchChannelVideos(chId, max=30) {
  const ch = await fetchChannel(chId);
  if (!ch.uploadsId) throw new Error('Playlist de uploads não encontrada.');
  const pl = await ytFetch('playlistItems', { part:'snippet,contentDetails', playlistId:ch.uploadsId, maxResults:Math.min(max,50) });
  quota.add('yt', API_LIMITS.yt.costList);
  if (!pl.items?.length) return { channel: ch, videos: [] };
  const ids = pl.items.map(i=>i.contentDetails.videoId).join(',');
  const vd = await ytFetch('videos', { part:'statistics,contentDetails', id:ids });
  quota.add('yt', API_LIMITS.yt.costList);
  const map = {};
  vd.items.forEach(v => {
    const durSec = getDurationSec(v.contentDetails.duration);
    map[v.id] = {
      views: parseInt(v.statistics.viewCount)||0,
      likes: parseInt(v.statistics.likeCount)||0,
      comments: parseInt(v.statistics.commentCount)||0,
      durSec, durStr: fmtTime(durSec),
      isShort: durSec > 0 && durSec <= 60
    };
  });
  const videos = pl.items.map(i => {
    const vid = i.contentDetails.videoId;
    const s = map[vid] || { views:0, likes:0, comments:0, durSec:0, durStr:'--', isShort:false };
    return {
      id: vid, title: i.snippet.title,
      thumb: i.snippet.thumbnails?.medium?.url || i.snippet.thumbnails?.default?.url || '',
      published: i.snippet.publishedAt || i.contentDetails.videoPublishedAt,
      ...s, eng: calcEng(s.views, s.likes, s.comments)
    };
  });
  return { channel: ch, videos };
}

async function searchVideos(query, opts={}) {
  const params = { part:'snippet', q:query, type:'video', maxResults:opts.max||30 };
  if (opts.region) params.regionCode = opts.region;
  if (opts.after) params.publishedAfter = opts.after;
  if (opts.before) params.publishedBefore = opts.before;
  if (opts.order) params.order = opts.order;
  if (opts.lang) params.relevanceLanguage = opts.lang;
  if (opts.durFilter === 'short') params.videoDuration = 'short';
  // Note: we don't set videoDuration='long' here because YT API 'long' means > 20 min.
  // We want anything > 60s, so we'll fetch all and filter client-side.
  const d = await ytFetch('search', params);
  quota.add('yt', API_LIMITS.yt.costSearch);
  if (!d.items?.length) return [];
  const ids = d.items.map(i=>i.id.videoId).join(',');
  const vd = await ytFetch('videos', { part:'snippet,statistics,contentDetails', id:ids });
  quota.add('yt', API_LIMITS.yt.costList);
  
  // Fetch channel stats for subscribers
  const uniqueChIds = [...new Set(vd.items.map(v => v.snippet.channelId))].join(',');
  let chStats = {};
  if (uniqueChIds) {
    const cd = await ytFetch('channels', { part:'statistics', id:uniqueChIds });
    quota.add('yt', API_LIMITS.yt.costList);
    if (cd.items) {
      cd.items.forEach(c => {
        chStats[c.id] = {
          subs: parseInt(c.statistics.subscriberCount)||0,
          views: parseInt(c.statistics.viewCount)||0
        };
      });
    }
  }

  let results = vd.items.map(v => {
    const views=parseInt(v.statistics.viewCount)||0;
    const likes=parseInt(v.statistics.likeCount)||0;
    const comments=parseInt(v.statistics.commentCount)||0;
    const durSec=getDurationSec(v.contentDetails.duration);
    const ch = chStats[v.snippet.channelId] || {subs:0, views:0};
    return {
      id:v.id, title:v.snippet.title, channel:v.snippet.channelTitle,
      channelId:v.snippet.channelId,
      subs: ch.subs,
      channelViews: ch.views,
      thumb:v.snippet.thumbnails?.medium?.url||'',
      views, likes, comments,
      eng: calcEng(views,likes,comments),
      durSec, durStr:fmtTime(durSec),
      isShort: durSec>0&&durSec<=60,
      tags:v.snippet.tags||[],
      published:v.snippet.publishedAt,
      desc:v.snippet.description||''
    };
  });
  if (opts.durFilter === 'long') {
    results = results.filter(v => !v.isShort);
  }
  return results;
}

async function fetchTrending(region='BR', max=24, catId='0') {
  const params = { part:'snippet,statistics,contentDetails', chart:'mostPopular', regionCode:region, maxResults:max };
  if (catId && catId !== '0') params.videoCategoryId = catId;
  let d;
  try {
    d = await ytFetch('videos', params);
  } catch(e) {
    // Some categories are not available in all regions — retry without category
    if (catId && catId !== '0' && e.message.includes('not found')) {
      delete params.videoCategoryId;
      d = await ytFetch('videos', params);
      toast('Categoria indisponivel nessa regiao, mostrando todos.', 'error');
    } else { throw e; }
  }
  quota.add('yt', API_LIMITS.yt.costTrending);
  
  // Fetch channel stats for subs and total views
  const uniqueChIds = [...new Set((d.items||[]).map(v => v.snippet.channelId))].join(',');
  let chStats = {};
  if (uniqueChIds) {
    try {
      const cd = await ytFetch('channels', { part:'statistics', id:uniqueChIds });
      quota.add('yt', API_LIMITS.yt.costList);
      if (cd.items) {
        cd.items.forEach(c => {
          chStats[c.id] = {
            subs: parseInt(c.statistics.subscriberCount)||0,
            views: parseInt(c.statistics.viewCount)||0
          };
        });
      }
    } catch(e) { console.error('Erro buscando stats de canais do trending', e); }
  }

  return (d.items||[]).map(v => {
    const views=parseInt(v.statistics.viewCount)||0;
    const likes=parseInt(v.statistics.likeCount)||0;
    const comments=parseInt(v.statistics.commentCount)||0;
    const durSec=getDurationSec(v.contentDetails.duration);
    const ch = chStats[v.snippet.channelId] || {subs:0, views:0};
    // Use medium thumbnail with https to avoid file:// CORS issues
    const thumb = v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || '';
    return {
      id:v.id, title:v.snippet.title, channel:v.snippet.channelTitle,
      channelId:v.snippet.channelId,
      subs: ch.subs,
      channelViews: ch.views,
      thumb: thumb,
      views, likes, comments,
      eng: calcEng(views,likes,comments),
      durSec, durStr:fmtTime(durSec),
      isShort: durSec>0&&durSec<=60,
      published:v.snippet.publishedAt
    };
  });
}

