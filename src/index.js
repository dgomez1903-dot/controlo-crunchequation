// Worker do controlo de pagamentos.
//
// As páginas e a leitura do estado são abertas a quem tiver o endereço.
// Gravar exige a palavra-passe guardada no segredo SENHA.
// Quem entra fica com um cookie assinado válido 30 dias.
// Trocar a SENHA invalida todas as sessões abertas.

const MES_VALIDO = /^\d{4}-\d{2}$/;
const DIAS_SESSAO = 30;
const MAX_TENTATIVAS = 8;          // por janela
const JANELA_SEGUNDOS = 15 * 60;   // 15 minutos

const enc = new TextEncoder();

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign(
      { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      extra
    )
  });
}

// ---- sessão --------------------------------------------------------------

async function assinar(msg, segredo) {
  const chave = await crypto.subtle.importKey(
    'raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', chave, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function igual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function cookieDe(request, nome) {
  const bruto = request.headers.get('cookie') || '';
  for (const parte of bruto.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return v.join('=');
  }
  return null;
}

async function autenticado(request, segredo) {
  const c = cookieDe(request, 'sessao');
  if (!c) return false;
  const [exp, sig] = c.split('.');
  if (!exp || !sig) return false;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return igual(sig, await assinar(exp, segredo));
}

async function cookieNovo(segredo) {
  const exp = String(Date.now() + DIAS_SESSAO * 86400000);
  const sig = await assinar(exp, segredo);
  return `sessao=${exp}.${sig}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${DIAS_SESSAO * 86400}`;
}

const COOKIE_VAZIO = 'sessao=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';

// ---- limite de tentativas ------------------------------------------------

async function tentativas(env, ip) {
  if (!env.ESTADO) return 0;
  const v = await env.ESTADO.get('tentativas:' + ip);
  return v ? Number(v) : 0;
}

async function falhou(env, ip) {
  if (!env.ESTADO) return;
  const n = (await tentativas(env, ip)) + 1;
  await env.ESTADO.put('tentativas:' + ip, String(n), { expirationTtl: JANELA_SEGUNDOS });
}

// ---- estado --------------------------------------------------------------

async function estado(request, env, podeGravar) {
  if (!env.ESTADO) {
    return json({ ok: false, erro: 'Falta a ligação ao KV. Confirma a binding ESTADO no wrangler.jsonc.' }, 500);
  }

  const url = new URL(request.url);
  const mes = url.searchParams.get('mes') || '';
  if (!MES_VALIDO.test(mes)) {
    return json({ ok: false, erro: 'Competência inválida. Usa o formato AAAA-MM.' }, 400);
  }
  const chave = 'estado:' + mes;

  if (request.method === 'GET') {
    const bruto = await env.ESTADO.get(chave);
    if (!bruto) return json({ ok: true, estado: null, at: 0, podeGravar });
    try {
      const guardado = JSON.parse(bruto);
      return json({ ok: true, estado: guardado.estado, at: guardado.at || 0, podeGravar });
    } catch (e) {
      return json({ ok: false, erro: 'O estado guardado está corrompido.' }, 500);
    }
  }

  if (request.method === 'PUT') {
    if (!podeGravar) {
      return json({ ok: false, erro: 'Precisas da palavra-passe para gravar.', podeGravar: false }, 401);
    }
    let corpo;
    try {
      corpo = await request.json();
    } catch (e) {
      return json({ ok: false, erro: 'Corpo do pedido ilegível.' }, 400);
    }
    if (!corpo || typeof corpo.estado !== 'object' || corpo.estado === null) {
      return json({ ok: false, erro: 'Falta o estado.' }, 400);
    }
    const at = Date.now();
    await env.ESTADO.put(chave, JSON.stringify({ estado: corpo.estado, at }));
    return json({ ok: true, at, podeGravar: true });
  }

  return json({ ok: false, erro: 'Método não suportado.' }, 405);
}

// ---- entrada -------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!env.SENHA) {
      return new Response(
        'Falta definir o segredo SENHA nas definições do Worker (Settings → Variables and Secrets).',
        { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } }
      );
    }

    if (url.pathname === '/api/sair') {
      return json({ ok: true, podeGravar: false }, 200, { 'set-cookie': COOKIE_VAZIO });
    }

    if (url.pathname === '/api/entrar') {
      if (request.method !== 'POST') {
        return json({ ok: false, erro: 'Método não suportado.' }, 405);
      }

      const ip = request.headers.get('cf-connecting-ip') || 'sem-ip';
      if (await tentativas(env, ip) >= MAX_TENTATIVAS) {
        return json({ ok: false, erro: 'Demasiadas tentativas falhadas. Espera um quarto de hora.' }, 429);
      }

      let senha = '';
      try {
        const corpo = await request.json();
        senha = String((corpo && corpo.senha) || '');
      } catch (e) {
        return json({ ok: false, erro: 'Pedido inválido.' }, 400);
      }

      if (!igual(senha, env.SENHA)) {
        await falhou(env, ip);
        return json({ ok: false, erro: 'Palavra-passe errada.' }, 401);
      }

      await env.ESTADO.delete('tentativas:' + ip);
      return json({ ok: true, podeGravar: true }, 200, { 'set-cookie': await cookieNovo(env.SENHA) });
    }

    const podeGravar = await autenticado(request, env.SENHA);

    if (url.pathname === '/api/estado') return estado(request, env, podeGravar);

    // As páginas não ficam em cache, para o estado de sessão nunca aparecer desatualizado.
    const resposta = await env.ASSETS.fetch(request);
    const tipo = resposta.headers.get('content-type') || '';
    if (tipo.includes('text/html')) {
      const nova = new Response(resposta.body, resposta);
      nova.headers.set('cache-control', 'no-store, must-revalidate');
      return nova;
    }
    return resposta;
  }
};
