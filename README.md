# Lemon Social

Landing page da Lemon Social para captação de leads.

* Página: `public/index.html`
* Deploy: Cloudflare Workers (static assets), configurado em `wrangler.jsonc`. Cada push na branch `main` publica automaticamente.
* Configurações (WhatsApp e webhook de leads) ficam no início do `<script>` no fim do `index.html`.

## Aprovação de conteúdo

* Página do cliente: `public/<cliente>/index.html` (ex.: `/yasmine/`). Os meses ficam no JSON `months` dentro da página.
* Painel da Lemon: `public/<cliente>/painel/` (ex.: `/yasmine/painel/`), protegido por senha.
* API e armazenamento: `src/worker.js`, com as respostas salvas no KV `lemon-aprovacoes` (binding `APROVA`).
* Acessos das páginas de links (lmon.cc): `/painel/acessos/`, mesma senha. Contagem via `POST /api/hit` (script `t.js` no repo lmon-cc), gravada no D1 `lemon-acessos` (binding `ACESSOS`).
* A senha do painel fica como hash SHA-256 em `PAINEL_SENHA_SHA256` no `wrangler.jsonc`.

## Avaliações pós atendimento

* Garçom: `/<cliente>/garcom/` (ex.: `/theseven/garcom/`). Entra com PIN, escolhe o nome, cadastra nome e WhatsApp do cliente.
* Cliente: recebe o link `/a/<token>` (página `public/avaliar/`), avalia (geral, comida, atendimento, comentário) e informa nome, WhatsApp e aniversário.
* Painel: `/painel/avaliacoes/`, mesma senha. Notas, por garçom, base de clientes (CSV), aniversariantes do mês e configurações (garçons, PIN, link do Google, WhatsApp).
* API: `src/avaliacoes.js`. Dados no D1 `lemon-acessos`, tabelas `av_*` (`migrations/0002_avaliacoes.sql`).
* Envio automático: WhatsApp Cloud API com modelo aprovado. Segredos `WA_TOKEN_<CLIENTE>` e `WA_PHONE_ID_<CLIENTE>` no Worker. Sem eles, o garçom envia pelo próprio WhatsApp com um toque.
* Novo restaurante: copiar `public/theseven/garcom/` para `public/<cliente>/garcom/`, incluir em `CLIENTS` no painel e em `TEMAS` na página `avaliar`.
