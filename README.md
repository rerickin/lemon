# Lemon Social

Landing page da Lemon Social para captação de leads.

* Página: `public/index.html`
* Deploy: Cloudflare Workers (static assets), configurado em `wrangler.jsonc`. Cada push na branch `main` publica automaticamente.
* Configurações (WhatsApp e webhook de leads) ficam no início do `<script>` no fim do `index.html`.
