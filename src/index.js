// Worker do controlo de pagamentos.
// Trata os pedidos a /api/estado e entrega tudo o resto a partir da pasta public.
// O login é feito pelo Cloudflare Access, antes de qualquer pedido chegar aqui.

const MES_VALIDO = /^\d{4}-\d{2}$/;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

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
  const quem = request.headers.get('cf-access-authenticated-user-email') || 'desconhecido';

  if (request.method === 'GET') {
    const bruto = await env.ESTADO.get(chave);
    if (!bruto) return json({ ok: true, estado: null, at: 0 });
    try {
      const guardado = JSON.parse(bruto);
      return json({ ok: true, estado: guardado.estado, at: guardado.at || 0, por: guardado.por || '' });
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
    await env.ESTADO.put(chave, JSON.stringify({ estado: corpo.estado, at, por: quem }));
    return json({ ok: true, at, por: quem });
  }

  return json({ ok: false, erro: 'Método não suportado.' }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/estado') {
      return estado(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};
