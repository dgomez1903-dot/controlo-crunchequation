# Controlo de pagamentos — Crunchequation, Lda

Painel mensal de pagamentos em falta. O código vive no GitHub, a página é servida
por um Worker do Cloudflare, o estado é guardado no Cloudflare KV e o acesso é protegido
por palavra-passe, verificada pelo próprio Worker.

```
wrangler.jsonc          configuração do Worker
src/index.js            Worker: API do estado + entrega das páginas
public/index.html       lista de meses
public/2026-09/index.html   painel da competência
```

## Instalação

### 1. Criar o armazém do estado

No painel do Cloudflare: **Storage & Databases → KV → Create a namespace**, com o nome
`controlo-estado`. Depois de criado, copia o **ID** do namespace, que aparece ao lado do nome.

### 2. Confirmar o ID no ficheiro de configuração

O `wrangler.jsonc` já traz o ID do namespace `controlo-estado`. Se algum dia criares
outro namespace, é neste ficheiro que se troca o valor de `id`.

Se já tinhas criado a binding pelo painel, podes deixá-la — a partir de agora quem manda
é este ficheiro, porque cada publicação reescreve as ligações do Worker.

### 3. Enviar para o GitHub

Commit de tudo. O Worker já ligado ao repositório publica sozinho em menos de um minuto.
Se o build voltar a falhar, abre o registo: a mensagem diz sempre o que faltou.

### 4. Confirmar

Abre o endereço do Worker seguido de `/api/estado?mes=2026-09`.
Deve responder `{"ok":true,"estado":null,"at":0}`.

### 5. Definir a palavra-passe

No Worker: **Settings → Variables and Secrets → Add**.

- Type: **Secret** (não Text, senão fica à vista e é apagada a cada publicação)
- Variable name: `SENHA`
- Value: a palavra-passe

Escolhe uma frase longa em vez de uma palavra curta. Guarda-a no gestor de senhas.
Sem este segredo definido, o Worker recusa-se a servir seja o que for.

Trocar a `SENHA` fecha todas as sessões abertas, em todos os dispositivos. É assim que
se revoga o acesso a alguém.

O endereço `/sair` termina a sessão no dispositivo onde for aberto. Está ligado ao
rodapé das páginas.

## Como funciona no dia a dia

Abres o link no computador ou no telemóvel, entras com a palavra-passe, e
marcas ou editas o que precisares. Cada alteração é gravada no browser de imediato e
enviada para o servidor logo a seguir; o rodapé mostra a hora da última sincronização.
Quando voltas a um separador que estava aberto, o painel vai buscar a versão mais recente.

Se a ligação falhar, continua a funcionar em modo local e o rodapé avisa. As alterações
seguem para o servidor na sincronização seguinte, feita à mão pelo botão do rodapé.

Se duas pessoas mexerem ao mesmo tempo, fica a última alteração gravada.

## Acrescentar um mês

1. Duplica a pasta `public/2026-09/` com o nome da nova competência.
2. No ficheiro novo, muda `var MES = '2026-09'` para a competência certa e atualiza a
   lista `SEED` com os pagamentos do mês.
3. Acrescenta uma linha ao array `MESES` em `public/index.html`.
4. Commit. O Cloudflare publica sozinho.

Cada competência guarda o seu estado à parte, na chave `estado:AAAA-MM`.
