// Lemon Social: site estático + API de aprovação de conteúdo.
// Rotas:
//   GET  /api/aprova/:cliente/:mes             estado salvo (cliente retoma de onde parou)
//   PUT  /api/aprova/:cliente/:mes             salva o estado {state}
//   POST /api/aprova/:cliente/:mes/finalizar   marca como finalizado
//   GET  /api/painel/:cliente                  (senha) todas as aprovações do cliente
//   POST /api/painel/:cliente/:mes/reabrir     (senha) libera de novo para o cliente
//   POST /api/painel/:cliente/:mes/zerar       (senha) apaga todas as respostas do mês
//   GET  /api/datas/:cliente/:mes              datas de publicação definidas pela equipe
//   PUT  /api/painel/:cliente/:mes/data        (senha) {id, date} define ou limpa a data de um post

const SLUG = /^[a-z0-9-]{1,40}$/;
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function authorized(request, env) {
  const senha = request.headers.get('x-senha') || '';
  return senha && (await sha256(senha)) === env.PAINEL_SENHA_SHA256;
}

function cleanState(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [id, v] of Object.entries(input).slice(0, 200)) {
    if (!/^[0-9a-z]{1,6}$/i.test(id) || !v || typeof v !== 'object') continue;
    const s = {};
    if (v.status === 'a' || v.status === 'w') s.status = v.status;
    if (typeof v.type === 'string') s.type = v.type.slice(0, 60);
    if (typeof v.note === 'string') s.note = v.note.slice(0, 300);
    if (typeof v.at === 'string') s.at = v.at.slice(0, 40);
    out[id] = s;
  }
  return out;
}

async function api(request, env, parts) {
  const method = request.method;
  const key = (c, m) => `aprova:${c}:${m}`;

  if (parts[0] === 'aprova' && SLUG.test(parts[1] || '') && SLUG.test(parts[2] || '')) {
    const k = key(parts[1], parts[2]);
    const rec = (await env.APROVA.get(k, 'json')) || { state: {} };
    if (parts.length === 3 && method === 'GET') return json(rec);
    if (parts.length === 3 && method === 'PUT') {
      if (rec.finalizedAt) return json({ error: 'finalizado', ...rec }, 409);
      const body = await request.json().catch(() => null);
      if (!body) return json({ error: 'corpo inválido' }, 400);
      const next = { ...rec, state: cleanState(body.state), updatedAt: new Date().toISOString() };
      if (!next.startedAt) next.startedAt = next.updatedAt;
      await env.APROVA.put(k, JSON.stringify(next));
      return json(next);
    }
    if (parts.length === 4 && parts[3] === 'finalizar' && method === 'POST') {
      if (rec.finalizedAt) return json(rec);
      const body = await request.json().catch(() => ({}));
      const now = new Date().toISOString();
      const next = { ...rec, state: body.state ? cleanState(body.state) : rec.state, updatedAt: now, finalizedAt: now };
      await env.APROVA.put(k, JSON.stringify(next));
      return json(next);
    }
  }

  if (parts[0] === 'datas' && SLUG.test(parts[1] || '') && SLUG.test(parts[2] || '') && parts.length === 3 && method === 'GET') {
    return json({ dates: (await env.APROVA.get(`datas:${parts[1]}:${parts[2]}`, 'json')) || {} });
  }

  if (parts[0] === 'painel' && SLUG.test(parts[1] || '')) {
    if (!(await authorized(request, env))) return json({ error: 'senha incorreta' }, 401);
    if (parts.length === 2 && method === 'GET') {
      const list = await env.APROVA.list({ prefix: `aprova:${parts[1]}:` });
      const meses = {};
      for (const { name } of list.keys) meses[name.split(':')[2]] = await env.APROVA.get(name, 'json');
      return json({ cliente: parts[1], meses });
    }
    if (parts.length === 4 && parts[3] === 'data' && method === 'PUT' && SLUG.test(parts[2] || '')) {
      const body = await request.json().catch(() => null);
      if (!body || !/^[0-9a-z]{1,6}$/i.test(body.id || '')) return json({ error: 'post inválido' }, 400);
      const dk = `datas:${parts[1]}:${parts[2]}`;
      const dates = (await env.APROVA.get(dk, 'json')) || {};
      if (body.date === '' || body.date == null) dates[body.id] = '';
      else if (/^\d{4}-\d{2}-\d{2}$/.test(body.date)) dates[body.id] = body.date;
      else return json({ error: 'data inválida' }, 400);
      await env.APROVA.put(dk, JSON.stringify(dates));
      return json({ dates });
    }
    if (parts.length === 4 && parts[3] === 'zerar' && method === 'POST' && SLUG.test(parts[2] || '')) {
      await env.APROVA.delete(key(parts[1], parts[2]));
      return json({ state: {} });
    }
    if (parts.length === 4 && parts[3] === 'reabrir' && method === 'POST' && SLUG.test(parts[2] || '')) {
      const k = key(parts[1], parts[2]);
      const rec = (await env.APROVA.get(k, 'json')) || { state: {} };
      delete rec.finalizedAt;
      rec.reopenedAt = new Date().toISOString();
      await env.APROVA.put(k, JSON.stringify(rec));
      return json(rec);
    }
  }
  return json({ error: 'não encontrado' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url.pathname.slice(5).split('/').filter(Boolean));
      } catch (e) {
        return json({ error: 'erro interno' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
