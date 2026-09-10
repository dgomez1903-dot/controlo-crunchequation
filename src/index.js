// Worker do controlo de pagamentos.
//
// Antes de servir seja o que for, exige a palavra-passe guardada no segredo SENHA.
// Depois de entrar, o browser fica com um cookie assinado válido 30 dias.
// Trocar a SENHA invalida todas as sessões abertas.

const MES_VALIDO = /^\d{4}-\d{2}$/;
const DIAS_SESSAO = 30;
const MAX_TENTATIVAS = 8;          // por janela
const JANELA_SEGUNDOS = 15 * 60;   // 15 minutos

const enc = new TextEncoder();

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
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

// ---- página de entrada ---------------------------------------------------

function escapar(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function paginaEntrada({ erro = '', proximo = '/', status = 200 } = {}) {
  const html = `<!DOCTYPE html>
<html lang="pt"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Controlo de pagamentos</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{--ink:#14202B;--ink-soft:#4C5C68;--paper:#E9EDEF;--card:#fff;--rule:#C9D3DA;--due:#B3261E;--focus:#1B5E9B}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:var(--paper);color:var(--ink);font-family:"IBM Plex Sans",system-ui,sans-serif;
    line-height:1.45;padding:24px;-webkit-font-smoothing:antialiased}
  .caixa{background:var(--card);border:1.5px solid var(--ink);padding:26px 26px 24px;width:100%;max-width:390px}
  h1{font-size:1.15rem;font-weight:600;margin:0 0 4px;letter-spacing:-.01em}
  p.sub{font-size:.78rem;color:var(--ink-soft);margin:0 0 20px}
  label{display:block;font-size:.75rem;color:var(--ink-soft)}
  input{display:block;margin-top:5px;width:100%;font-family:inherit;font-size:1rem;
    padding:10px 11px;border:1px solid var(--rule);background:#FAFCFC;color:var(--ink)}
  input:focus-visible{outline:2px solid var(--focus);outline-offset:1px}
  button{margin-top:16px;width:100%;font:inherit;font-size:.88rem;font-weight:600;cursor:pointer;
    padding:11px;border:1.5px solid var(--ink);background:var(--ink);color:#fff}
  button:hover{background:#0C1720}
  button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .erro{font-size:.78rem;color:var(--due);font-weight:600;margin:14px 0 0}
</style></head>
<body>
  <form class="caixa" method="POST" action="/entrar">
    <h1>Controlo de pagamentos</h1>
    <p class="sub">Crunchequation, Lda</p>
    <input type="hidden" name="proximo" value="${escapar(proximo)}">
    <label for="senha">Palavra-passe
      <input id="senha" name="senha" type="password" autocomplete="current-password" autofocus required>
    </label>
    <button type="submit">Entrar</button>
    ${erro ? `<p class="erro">${escapar(erro)}</p>` : ''}
  </form>
</body></html>`;
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  });
}

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

async function estado(request, env) {
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
    if (!bruto) return json({ ok: true, estado: null, at: 0 });
    try {
      const guardado = JSON.parse(bruto);
      return json({ ok: true, estado: guardado.estado, at: guardado.at || 0 });
    } catch (e) {
      return json({ ok: false, erro: 'O estado guardado está corrompido.' }, 500);
    }
  }

  if (request.method === 'PUT') {
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
    return json({ ok: true, at });
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

    if (url.pathname === '/sair') {
      return new Response(null, {
        status: 303,
        headers: {
          'location': '/',
          'set-cookie': 'sessao=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
        }
      });
    }

    if (url.pathname === '/entrar') {
      if (request.method !== 'POST') return Response.redirect(new URL('/', url).toString(), 303);

      const ip = request.headers.get('cf-connecting-ip') || 'sem-ip';
      if (await tentativas(env, ip) >= MAX_TENTATIVAS) {
        return paginaEntrada({
          erro: 'Demasiadas tentativas falhadas. Espera um quarto de hora e tenta outra vez.',
          status: 429
        });
      }

      let form;
      try {
        form = await request.formData();
      } catch (e) {
        return paginaEntrada({ erro: 'Pedido inválido.', status: 400 });
      }

      const senha = String(form.get('senha') || '');
      let proximo = String(form.get('proximo') || '/');
      if (!proximo.startsWith('/') || proximo.startsWith('//')) proximo = '/';

      if (!igual(senha, env.SENHA)) {
        await falhou(env, ip);
        return paginaEntrada({ erro: 'Palavra-passe errada.', proximo, status: 401 });
      }

      if (env.ESTADO) await env.ESTADO.delete('tentativas:' + ip);
      return new Response(null, {
        status: 303,
        headers: { 'location': proximo, 'set-cookie': await cookieNovo(env.SENHA) }
      });
    }

    if (!(await autenticado(request, env.SENHA))) {
      if (url.pathname.startsWith('/api/')) {
        return json({ ok: false, erro: 'Sessão expirada. Recarrega a página e entra outra vez.' }, 401);
      }
      return paginaEntrada({ proximo: url.pathname + url.search });
    }

    if (url.pathname === '/api/estado') return estado(request, env);

    return env.ASSETS.fetch(request);
  }
};
