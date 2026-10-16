# Lemon Social

Landing page da Lemon Social para captação de leads.

* Página: `public/index.html`
* Deploy: Cloudflare Workers (static assets), configurado em `wrangler.jsonc`. Cada push na branch `main` publica automaticamente.
* Configurações (WhatsApp e webhook de leads) ficam no início do `<script>` no fim do `index.html`.

## Aprovação de conteúdo

* Página do cliente: `public/<cliente>/index.html` (ex.: `/yasmine/`). Os meses ficam no JSON `months` dentro da página.
* Painel da Lemon: `public/<cliente>/painel/` (ex.: `/yasmine/painel/`), protegido por senha.
* API e armazenamento: `src/worker.js`, com as respostas salvas no KV `lemon-aprovacoes` (binding `APROVA`).
* A senha do painel fica como hash SHA-256 em `PAINEL_SENHA_SHA256` no `wrangler.jsonc`.
