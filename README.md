# Controlo de pagamentos — Crunchequation, Lda

Painel mensal de pagamentos em falta. O código vive no GitHub, a página é servida
pelo Cloudflare Pages, o estado é guardado no Cloudflare KV e o acesso é protegido
por login por email através do Cloudflare Access.

```
index.html              lista de meses
2026-09/index.html      painel da competência
functions/api/estado.js função que lê e grava o estado (Cloudflare Pages Functions)
```

## Instalação, uma vez só

Tudo o que segue é gratuito nos planos de base do Cloudflare.

### 1. Pôr o código no GitHub

Cria um repositório e envia estes ficheiros para lá. Não é preciso ativar o GitHub Pages.

### 2. Criar o projeto no Cloudflare Pages

No painel do Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**.
Escolhe o repositório e confirma as definições de build:

- Framework preset: **None**
- Build command: deixar vazio
- Build output directory: `/`

Faz **Save and Deploy**. Fica com um endereço do tipo `nome-do-projeto.pages.dev`.
Nesta altura a página abre, mas ainda não sincroniza.

### 3. Criar o armazém do estado

**Storage & Databases → KV → Create a namespace**. Chama-lhe `controlo-estado`.

### 4. Ligar o armazém ao projeto

No projeto Pages: **Settings → Bindings → Add → KV namespace**.

- Variable name: `ESTADO` (o nome tem de ser exatamente este)
- KV namespace: `controlo-estado`

Adiciona a binding tanto em **Production** como em **Preview**. Depois vai a
**Deployments** e faz **Retry deployment** no último, para o projeto arrancar já com a ligação.

Para confirmar, abre `https://o-teu-projeto.pages.dev/api/estado?mes=2026-09`.
Deve responder `{"ok":true,"estado":null,"at":0}`. Se disser que falta ligar o KV,
a binding não ficou bem posta ou falta o novo deploy.

### 5. Pôr o login à frente

**Zero Trust → Access → Applications → Add an application → Self-hosted**.

- Application name: Controlo Crunchequation
- Domain: o domínio `pages.dev` do projeto
- Identity provider: **One-time PIN**

Cria uma política:

- Nome: Acesso
- Action: **Allow**
- Include → **Emails** → os endereços que podem entrar

Guarda. A partir daqui, abrir o link pede um email da lista e envia-lhe um código de
seis dígitos. A sessão dura o tempo que definires em **Session Duration**.

## Como funciona no dia a dia

Abres o link no computador ou no telemóvel, entras com o código, e marcas ou editas
o que precisares. Cada alteração é gravada no browser de imediato e enviada para o
servidor logo a seguir; o rodapé mostra a hora da última sincronização. Quando voltas
a um separador que estava aberto, o painel vai buscar a versão mais recente sozinho.

Se a ligação falhar, continua a funcionar em modo local e o rodapé avisa. As alterações
seguem para o servidor na sincronização seguinte, feita à mão pelo botão do rodapé.

Se duas pessoas mexerem ao mesmo tempo, fica a última alteração gravada. Para um painel
usado por uma ou duas pessoas não é um problema; se passar a ser, diz.

## Acrescentar um mês

1. Duplica a pasta `2026-09/` com o nome da nova competência.
2. No ficheiro novo, muda `var MES = '2026-09'` para a competência certa e atualiza a
   lista `SEED` com os pagamentos do mês.
3. Acrescenta uma linha ao array `MESES` no `index.html` da raiz.
4. Commit. O Cloudflare publica sozinho em menos de um minuto.

Cada competência guarda o seu estado à parte, na chave `estado:AAAA-MM`.
