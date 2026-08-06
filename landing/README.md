# landing/ — página de vendas do FindHome (estática, para a Vercel)

Uma página só, sem build, sem dependência, sem framework. É de propósito: um MVP
de landing não precisa de 200MB de `node_modules` para carregar em 200ms.

```
landing/
├── index.html      a página inteira
├── styles.css      variáveis → base → componentes → seções → responsivo → reduced-motion
├── main.js         reveal, parallax, tilt 3D, progresso da rolagem (~4kB, zero deps)
├── favicon.svg     ícone da aba
├── og-image.svg    preview de compartilhamento (1200×630)
├── vercel.json     headers de segurança e cache
└── README.md       este arquivo
```

**Esta pasta é independente do app.** Nada aqui importa nada de `web/`, e o app
não sabe que ela existe — dá para publicar, apagar e republicar sem tocar no
FindHome.

---

## Publicar na Vercel

### Pela CLI (mais rápido)

```bash
npm i -g vercel
cd landing
vercel            # primeira vez: cria o projeto, gera uma URL de preview
vercel --prod     # publica em produção
```

Quando a CLI perguntar:

- *Set up and deploy?* → **Y**
- *Which scope?* → sua conta
- *Link to existing project?* → **N**
- *What's your project's name?* → `findhome-landing`
- *In which directory is your code located?* → **`./`** (você já está em `landing/`)
- *Want to modify these settings?* → **N** (o `vercel.json` já resolve)

### Pelo painel (com deploy automático a cada push)

1. Suba o repositório para o GitHub.
2. <https://vercel.com/new> → importe o repositório.
3. Em **Root Directory**, escolha **`landing`**. Esse é o passo que costuma
   passar batido — sem ele a Vercel tenta buildar o projeto todo.
4. **Framework Preset**: `Other`. Build e Install Command vazios.
5. Deploy.

### Domínio próprio

Project → **Settings → Domains** → adicione o domínio e siga as instruções de
DNS. A Vercel emite o certificado sozinha.

---

## Ligar os botões

Os CTAs são `href="#"` com `data-cta="free"` / `data-cta="premium"`, e o
`main.js` intercepta o clique para avisar que é demonstração. Assim o botão não
parece quebrado enquanto não existe fluxo por trás dele.

Para apontar para o app de verdade, edite o `index.html`:

```html
<!-- antes -->
<a class="btn btn--primary btn--block" href="#" data-cta="premium">Assinar o Premium</a>

<!-- depois -->
<a class="btn btn--primary btn--block" href="https://app.seudominio.com/register">Assinar o Premium</a>
```

Tirando o `data-cta`, o handler para de agir naquele botão. Quando não sobrar
nenhum, apague o bloco `5. CTAs` do `main.js`.

> Se você seguiu o `DEPLOY-PUBLICO.md`, a URL do app é o hostname do túnel
> (`https://...ts.net` ou `https://findhome.seudominio.com`).

---

## Editar o conteúdo

Tudo está no `index.html`, em ordem de leitura, com comentários marcando cada
seção. Os lugares que você provavelmente quer mexer:

| O quê | Onde |
|---|---|
| Título e subtítulo | `<h1 class="hero__title">` e `.hero__lead` |
| Números da prova social | `<ul class="hero__proof">` |
| Os quatro problemas | `<section id="problema">` |
| Cards de recurso | `<section id="recursos">` |
| Preços e o que cada plano inclui | `<section id="planos">` |
| Perguntas frequentes | `<section class="section--faq">` |

### Preços

No bloco `.plans`. As listas usam duas classes e nada mais:

```html
<li class="yes">Está incluído</li>
<li class="no">Não está incluído</li>
```

O `✓` verde e o `✕` apagado vêm do CSS (`.plan__list li::before`) — não escreva
o símbolo no texto.

**Os limites do plano Free na página são uma proposta, não uma regra
implementada.** O FindHome atual não tem noção de plano, cota ou cobrança: todo
mundo tem tudo. Se você for cobrar de verdade, isso precisa existir no app antes
de a página ir ao ar — o texto aqui promete 2 portais no Free e 6 no Premium, e
uma promessa de página de vendas que o produto não cumpre é um problema, não um
detalhe.

### Cores

Todas no `:root` do `styles.css`, e são as mesmas do app (pistache sobre verde
escuro — ver `web/src/app/globals.css`). Trocar `--brand-400` reskina a página
inteira.

---

## O que já está resolvido

- **Acessibilidade.** Ordem de headings correta, `skip-link`, foco visível,
  decoração com `aria-hidden`, o mockup com `role="img"` e rótulo descritivo, e
  contraste do texto acima de 4.5:1 sobre o fundo escuro.
- **`prefers-reduced-motion`.** Respeitado nos dois lados: o CSS zera as
  transições e o `main.js` nem instala os listeners de scroll e de mouse.
  Parallax e flutuação contínua provocam desconforto real — não é enfeite
  opcional.
- **Sem JavaScript.** A página aparece completa. O estado inicial do reveal fica
  atrás da classe `.js`, que o próprio `main.js` adiciona; sem ele nada é
  escondido.
- **Performance.** Nenhuma requisição externa, nenhuma fonte remota, nenhuma
  imagem raster. Só três arquivos e um SVG.
- **Responsivo.** De 320px para cima. Os cartões flutuantes recolhem para dentro
  do mockup em telas estreitas em vez de causar rolagem horizontal.
- **Headers de segurança** no `vercel.json`, com CSP fechada (sem
  `unsafe-inline`, porque todo o JS está em arquivo).

## O que não está

- **Nenhum backend.** Sem cadastro, sem checkout, sem analytics, sem formulário.
- **Nenhuma lógica de plano.** Ver o aviso em *Preços* acima.
- **Nenhum texto jurídico.** Se for cobrar, você vai precisar de Termos de Uso e
  Política de Privacidade (LGPD) de verdade. O rodapé só diz que é uma
  demonstração.

---

## Testar localmente

Qualquer servidor estático serve. Abrir o `index.html` direto pelo `file://`
também funciona, mas a CSP e o `cleanUrls` só se comportam como em produção sob
`http://`:

```bash
cd landing
python3 -m http.server 4321     # ou: npx serve .
# http://localhost:4321
```
