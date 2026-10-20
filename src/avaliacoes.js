// Avaliações pós atendimento.
//
// Fluxo: o garçom abre /<cliente>/garcom/, escolhe o nome dele e cadastra nome + WhatsApp do
// cliente. O sistema gera um link único (/a/<token>) e envia pelo WhatsApp oficial do restaurante
// (WhatsApp Cloud API). Se a API ainda não estiver configurada ou falhar, devolve um link wa.me
// para o garçom mandar do próprio celular. O cliente abre o link, preenche os dados e avalia.
//
// Rotas (todas sob /api/av):
//   GET  /api/av/:cliente/garcons                 (PIN) lista de garçons ativos
//   POST /api/av/:cliente/enviar                  (PIN) {garcom, nome, whatsapp} cria e envia
//   GET  /api/av/r/:token                         dados do pedido para a página do cliente
//   POST /api/av/r/:token                         {nome, whatsapp, aniversario, ofertas, geral, comida, atendimento, comentario}
//   GET  /api/painel/:cliente/avaliacoes?dias=N   (senha) respostas e pedidos do período
//   GET  /api/painel/:cliente/clientes            (senha) base de clientes
//   GET  /api/painel/:cliente/av-config           (senha) garçons e configurações
//   PUT  /api/painel/:cliente/av-config           (senha) {nome, pin, google_url, wa_template, wa_idioma}
//   POST /api/painel/:cliente/garcons             (senha) {nome}
//   PUT  /api/painel/:cliente/garcons/:id         (senha) {ativo}
//
// Segredos do WhatsApp (por cliente, definidos no painel da Cloudflare, nunca no código):
//   WA_TOKEN_<CLIENTE>     token permanente do usuário de sistema da Meta
//   WA_PHONE_ID_<CLIENTE>  Phone Number ID do número do restaurante
//   (CLIENTE em maiúsculas, sem hífen. Ex.: WA_TOKEN_THESEVEN)

const SLUG = /^[a-z0-9-]{1,40}$/;
const TOKEN = /^[A-Za-z0-9]{10}$/;
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const agora = () => new Date().toISOString();
const diaBR = (d = new Date()) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
const txt = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const nota = v => { const n = parseInt(v, 10); return n >= 1 && n <= 5 ? n : null; };
const envKey = c => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function novoToken() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const b = crypto.getRandomValues(new Uint8Array(10));
  return [...b].map(x => abc[x % abc.length]).join('');
}

// Normaliza para 55 + DDD + número. Aceita com ou sem 55, com máscara.
export function normalizaWhats(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (!/^55\d{10,11}$/.test(d)) return null;
  // Celular sem o nono dígito (55 DD 8 dígitos começando com 6 a 9): acrescenta o 9
  if (d.length === 12 && /[6-9]/.test(d[4])) d = d.slice(0, 4) + '9' + d.slice(4);
  return d;
}

async function config(env, cliente) {
  return (await env.ACESSOS.prepare('SELECT * FROM av_config WHERE cliente = ?1').bind(cliente).first()) || { cliente };
}

async function pinOk(request, env, cliente) {
  const cfg = await config(env, cliente);
  if (!cfg.pin_hash) return false;
  const pin = request.headers.get('x-pin') || '';
  return !!pin && (await sha256(cliente + ':' + pin)) === cfg.pin_hash;
}

function linkAvaliacao(request, env, token) {
  const base = (env.AV_BASE_URL || new URL(request.url).origin).replace(/\/$/, '');
  return `${base}/a/${token}`;
}

function primeiroNome(nome) {
  return (nome || '').split(' ')[0] || '';
}

function mensagemManual(cfg, nome, link) {
  const oi = primeiroNome(nome) ? `Oi, ${primeiroNome(nome)}! ` : 'Oi! ';
  return `${oi}Obrigado pela visita ao ${cfg.nome || 'restaurante'}. Leva menos de 1 minuto: conta pra gente como foi? ${link}`;
}

// Envio pela WhatsApp Cloud API usando modelo (template) aprovado.
// O modelo deve ter: corpo com {{1}} = primeiro nome, e botão de URL dinâmica
// com a base https://<dominio>/a/{{1}} (o sistema preenche só o token).
async function enviaApi(env, cfg, cliente, whatsapp, nome, token) {
  const k = envKey(cliente);
  const tk = env['WA_TOKEN_' + k], phone = env['WA_PHONE_ID_' + k];
  if (!tk || !phone || !cfg.wa_template) return { ok: false, motivo: 'nao-configurado' };
  const versao = env.WA_API_VERSION || 'v23.0';
  const body = {
    messaging_product: 'whatsapp',
    to: whatsapp,
    type: 'template',
    template: {
      name: cfg.wa_template,
      language: { code: cfg.wa_idioma || 'pt_BR' },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: primeiroNome(nome) || 'tudo bem' }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
      ],
    },
  };
  try {
    const r = await fetch(`https://graph.facebook.com/${versao}/${phone}/messages`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + tk, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.messages) return { ok: true };
    return { ok: false, motivo: (data.error && (data.error.error_user_msg || data.error.message)) || 'HTTP ' + r.status };
  } catch (e) {
    return { ok: false, motivo: 'falha de conexão' };
  }
}

async function garcom(request, env, cliente, acao) {
  if (!(await pinOk(request, env, cliente))) return json({ error: 'PIN incorreto' }, 401);
  const cfg = await config(env, cliente);

  if (acao === 'garcons' && request.method === 'GET') {
    const { results } = await env.ACESSOS.prepare(
      'SELECT nome FROM av_garcons WHERE cliente = ?1 AND ativo = 1 ORDER BY nome COLLATE NOCASE'
    ).bind(cliente).all();
    return json({ restaurante: cfg.nome || cliente, garcons: results.map(r => r.nome) });
  }

  if (acao === 'enviar' && request.method === 'POST') {
    const b = await request.json().catch(() => null);
    if (!b) return json({ error: 'corpo inválido' }, 400);
    const g = txt(b.garcom, 60), nome = txt(b.nome, 80), whats = normalizaWhats(b.whatsapp);
    if (!whats) return json({ error: 'WhatsApp inválido. Use DDD + número.' }, 400);
    const valido = await env.ACESSOS.prepare(
      'SELECT 1 FROM av_garcons WHERE cliente = ?1 AND nome = ?2 AND ativo = 1'
    ).bind(cliente, g).first();
    if (!valido) return json({ error: 'Garçom não encontrado. Escolha seu nome de novo.' }, 400);

    // Evita duplicar se o garçom tocar duas vezes: reaproveita pedido do mesmo número nos últimos 10 min
    const recente = await env.ACESSOS.prepare(
      'SELECT token, envio FROM av_pedidos WHERE cliente = ?1 AND whatsapp = ?2 AND criado_em > ?3 ORDER BY criado_em DESC LIMIT 1'
    ).bind(cliente, whats, new Date(Date.now() - 10 * 60e3).toISOString()).first();

    let token, envio;
    if (recente) {
      token = recente.token;
      envio = recente.envio === 'api' ? { ok: true, repetido: true } : await enviaApi(env, cfg, cliente, whats, nome, token);
    } else {
      token = novoToken();
      envio = await enviaApi(env, cfg, cliente, whats, nome, token);
    }
    const status = envio.ok ? 'api' : envio.motivo === 'nao-configurado' ? 'manual' : 'erro';
    if (recente) {
      if (!envio.repetido) {
        await env.ACESSOS.prepare('UPDATE av_pedidos SET envio = ?2, envio_erro = ?3, nome = COALESCE(NULLIF(?4, \'\'), nome) WHERE token = ?1')
          .bind(token, status, envio.ok ? null : envio.motivo, nome).run();
      }
    } else {
      await env.ACESSOS.prepare(
        'INSERT INTO av_pedidos (token, cliente, garcom, nome, whatsapp, dia, criado_em, envio, envio_erro) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)'
      ).bind(token, cliente, g, nome, whats, diaBR(), agora(), status, envio.ok ? null : envio.motivo).run();
    }

    const link = linkAvaliacao(request, env, token);
    return json({
      enviado: envio.ok,
      motivo: envio.ok ? null : envio.motivo,
      link,
      wa_link: `https://wa.me/${whats}?text=${encodeURIComponent(mensagemManual(cfg, nome, link))}`,
    });
  }
  return json({ error: 'não encontrado' }, 404);
}

async function resposta(request, env, token) {
  const p = await env.ACESSOS.prepare('SELECT * FROM av_pedidos WHERE token = ?1').bind(token).first();
  if (!p) return json({ error: 'Link inválido ou expirado.' }, 404);
  const cfg = await config(env, p.cliente);

  if (request.method === 'GET') {
    if (!p.aberto_em) await env.ACESSOS.prepare('UPDATE av_pedidos SET aberto_em = ?2 WHERE token = ?1').bind(token, agora()).run();
    const cad = await env.ACESSOS.prepare('SELECT nome, aniversario FROM av_clientes WHERE cliente = ?1 AND whatsapp = ?2')
      .bind(p.cliente, p.whatsapp).first();
    return json({
      cliente: p.cliente,
      restaurante: cfg.nome || p.cliente,
      garcom: p.garcom,
      nome: p.nome || (cad && cad.nome) || '',
      whatsapp: p.whatsapp,
      aniversario: (cad && cad.aniversario) || '',
      respondido: !!p.respondido_em,
      google_url: cfg.google_url || '',
    });
  }

  if (request.method === 'POST') {
    if (p.respondido_em) return json({ error: 'Essa avaliação já foi enviada. Obrigado!', respondido: true }, 409);
    const b = await request.json().catch(() => null);
    if (!b) return json({ error: 'corpo inválido' }, 400);
    const geral = nota(b.geral);
    if (!geral) return json({ error: 'Dê uma nota geral de 1 a 5.' }, 400);
    const nome = txt(b.nome, 80);
    if (nome.length < 2) return json({ error: 'Informe seu nome.' }, 400);
    const whats = normalizaWhats(b.whatsapp) || p.whatsapp;
    let aniv = '';
    if (typeof b.aniversario === 'string' && /^\d{2}-\d{2}$/.test(b.aniversario)) {
      const [m, d] = b.aniversario.split('-').map(Number);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) aniv = b.aniversario;
    }
    const t = agora();
    await env.ACESSOS.batch([
      env.ACESSOS.prepare(
        'INSERT INTO av_respostas (token, cliente, garcom, dia, geral, comida, atendimento, comentario, criado_em) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)'
      ).bind(token, p.cliente, p.garcom, p.dia, geral, nota(b.comida), nota(b.atendimento), txt(b.comentario, 600) || null, t),
      env.ACESSOS.prepare('UPDATE av_pedidos SET respondido_em = ?2 WHERE token = ?1').bind(token, t),
      env.ACESSOS.prepare(
        `INSERT INTO av_clientes (cliente, whatsapp, nome, aniversario, ofertas, avaliacoes, primeira_vez, ultima_vez)
         VALUES (?1, ?2, ?3, NULLIF(?4, ''), ?5, 1, ?6, ?6)
         ON CONFLICT (cliente, whatsapp) DO UPDATE SET
           nome = excluded.nome,
           aniversario = COALESCE(excluded.aniversario, av_clientes.aniversario),
           ofertas = excluded.ofertas,
           avaliacoes = av_clientes.avaliacoes + 1,
           ultima_vez = excluded.ultima_vez`
      ).bind(p.cliente, whats, nome, aniv, b.ofertas ? 1 : 0, t),
    ]);
    return json({ ok: true, google_url: geral >= 4 ? cfg.google_url || '' : '' });
  }
  return json({ error: 'método' }, 405);
}

// Rotas do painel (a senha já foi conferida em worker.js)
export async function painelAvaliacoes(request, env, cliente, parts) {
  const method = request.method;
  const db = env.ACESSOS;

  if (parts[0] === 'avaliacoes' && parts.length === 1 && method === 'GET') {
    const dias = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get('dias') || '30', 10) || 30, 1), 3650);
    const desde = diaBR(new Date(Date.now() - (dias - 1) * 864e5));
    const [resp, ped] = await Promise.all([
      db.prepare(
        `SELECT r.token, r.garcom, r.dia, r.geral, r.comida, r.atendimento, r.comentario, r.criado_em, c.nome, c.whatsapp
         FROM av_respostas r JOIN av_pedidos p ON p.token = r.token
         LEFT JOIN av_clientes c ON c.cliente = r.cliente AND c.whatsapp = p.whatsapp
         WHERE r.cliente = ?1 AND r.dia >= ?2 ORDER BY r.criado_em DESC`
      ).bind(cliente, desde).all(),
      db.prepare(
        `SELECT garcom, COUNT(*) AS pedidos, SUM(aberto_em IS NOT NULL) AS abertos, SUM(respondido_em IS NOT NULL) AS respondidos,
                SUM(envio = 'api') AS api, SUM(envio = 'erro') AS erros
         FROM av_pedidos WHERE cliente = ?1 AND dia >= ?2 GROUP BY garcom`
      ).bind(cliente, desde).all(),
    ]);
    return json({ cliente, desde, hoje: diaBR(), respostas: resp.results, pedidos: ped.results });
  }

  if (parts[0] === 'clientes' && parts.length === 1 && method === 'GET') {
    const { results } = await db.prepare(
      'SELECT nome, whatsapp, aniversario, ofertas, avaliacoes, primeira_vez, ultima_vez FROM av_clientes WHERE cliente = ?1 ORDER BY ultima_vez DESC'
    ).bind(cliente).all();
    return json({ cliente, clientes: results });
  }

  if (parts[0] === 'av-config' && parts.length === 1) {
    if (method === 'PUT') {
      const b = await request.json().catch(() => null);
      if (!b) return json({ error: 'corpo inválido' }, 400);
      const cfg = await config(env, cliente);
      let pinHash = cfg.pin_hash || null;
      if (typeof b.pin === 'string' && b.pin) {
        if (!/^\d{4,8}$/.test(b.pin)) return json({ error: 'O PIN precisa ter de 4 a 8 números.' }, 400);
        pinHash = await sha256(cliente + ':' + b.pin);
      }
      const url = txt(b.google_url, 300);
      if (url && !/^https:\/\//.test(url)) return json({ error: 'O link do Google precisa começar com https://' }, 400);
      await db.prepare(
        `INSERT INTO av_config (cliente, nome, pin_hash, google_url, wa_template, wa_idioma) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (cliente) DO UPDATE SET nome = ?2, pin_hash = ?3, google_url = ?4, wa_template = ?5, wa_idioma = ?6`
      ).bind(cliente, txt(b.nome, 60) || cfg.nome || cliente, pinHash, url || null,
        txt(b.wa_template, 80).replace(/[^a-z0-9_]/g, '') || null, txt(b.wa_idioma, 10) || 'pt_BR').run();
    } else if (method !== 'GET') return json({ error: 'método' }, 405);
    const cfg = await config(env, cliente);
    const { results } = await db.prepare(
      'SELECT id, nome, ativo FROM av_garcons WHERE cliente = ?1 ORDER BY ativo DESC, nome COLLATE NOCASE'
    ).bind(cliente).all();
    const k = envKey(cliente);
    return json({
      nome: cfg.nome || '',
      tem_pin: !!cfg.pin_hash,
      google_url: cfg.google_url || '',
      wa_template: cfg.wa_template || '',
      wa_idioma: cfg.wa_idioma || 'pt_BR',
      wa_segredos: !!(env['WA_TOKEN_' + k] && env['WA_PHONE_ID_' + k]),
      wa_nomes: ['WA_TOKEN_' + k, 'WA_PHONE_ID_' + k],
      av_base: (env.AV_BASE_URL || new URL(request.url).origin).replace(/\/$/, ''),
      garcons: results,
    });
  }

  if (parts[0] === 'garcons') {
    if (parts.length === 1 && method === 'POST') {
      const b = await request.json().catch(() => null);
      const nome = txt(b && b.nome, 60);
      if (nome.length < 2) return json({ error: 'Informe o nome do garçom.' }, 400);
      await db.prepare(
        'INSERT INTO av_garcons (cliente, nome, ativo, criado_em) VALUES (?1, ?2, 1, ?3) ON CONFLICT (cliente, nome) DO UPDATE SET ativo = 1'
      ).bind(cliente, nome, agora()).run();
      return json({ ok: true });
    }
    if (parts.length === 2 && /^\d+$/.test(parts[1]) && method === 'PUT') {
      const b = await request.json().catch(() => ({}));
      await db.prepare('UPDATE av_garcons SET ativo = ?3 WHERE cliente = ?1 AND id = ?2').bind(cliente, +parts[1], b.ativo ? 1 : 0).run();
      return json({ ok: true });
    }
  }
  return null;
}

// Rotas públicas (/api/av/...)
export async function avaliacoesApi(request, env, parts) {
  if (parts[0] === 'r' && TOKEN.test(parts[1] || '') && parts.length === 2) return resposta(request, env, parts[1]);
  if (SLUG.test(parts[0] || '') && parts.length === 2) return garcom(request, env, parts[0], parts[1]);
  return json({ error: 'não encontrado' }, 404);
}
