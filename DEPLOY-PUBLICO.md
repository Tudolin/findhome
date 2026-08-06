# Publicando o FindHome com segurança (do notebook para a internet)

Guia passo a passo para deixar o FindHome acessível de fora de casa — rodando no
seu próprio notebook, com HTTPS, sem abrir porta no roteador e sem pagar domínio.

**Leia primeiro:** o FindHome é uma ferramenta doméstica. Ele guarda e-mails,
senhas (com hash), notas privadas e a sua agenda de visitas. Colocar isso na
internet aberta é uma decisão real, não um detalhe de configuração — então este
guia começa por fechar o que está aberto e só depois abre a porta.

---

## Índice

- [Passo 0 — Limpeza obrigatória antes de qualquer coisa](#passo-0--limpeza-obrigatória-antes-de-qualquer-coisa)
- [Passo 1 — Escolha o caminho](#passo-1--escolha-o-caminho)
- [Passo 2 — Preparar o notebook](#passo-2--preparar-o-notebook)
- [Passo 3 — Blindar o `.env`](#passo-3--blindar-o-env)
- [Passo 4A — Tailscale (privado, mais seguro)](#passo-4a--tailscale-privado-mais-seguro)
- [Passo 4B — Tailscale Funnel (público, domínio grátis)](#passo-4b--tailscale-funnel-público-domínio-grátis)
- [Passo 4C — Cloudflare Tunnel (público, com domínio próprio)](#passo-4c--cloudflare-tunnel-público-com-domínio-próprio)
- [Passo 5 — Fechar a porta 3000](#passo-5--fechar-a-porta-3000)
- [Passo 6 — Criar as contas e trancar o cadastro](#passo-6--criar-as-contas-e-trancar-o-cadastro)
- [Passo 7 — Backup automático](#passo-7--backup-automático)
- [Passo 8 — O notebook não pode dormir](#passo-8--o-notebook-não-pode-dormir)
- [Passo 9 — Checklist final](#passo-9--checklist-final)
- [Manutenção](#manutenção)
- [Perguntas que aparecem depois](#perguntas-que-aparecem-depois)

---

## Passo 0 — Limpeza obrigatória antes de qualquer coisa

### 0.1 Credenciais vazadas no repositório

O arquivo `.env.example` deste projeto estava corrompido: além de lixo no meio
dos comentários, havia um bloco de JSON colado dentro dele com credenciais reais
de uma API do Google Ads (`client_id`, `client_secret`, `refresh_token`,
`access_token`, `developer_token`, `login_customer_id`) e um e-mail corporativo.

O arquivo já foi reescrito limpo, **mas isso não resolve o vazamento**:

1. **Revogue os tokens agora.** No Google Cloud Console, no projeto dono daquele
   OAuth client: `APIs e serviços → Credenciais →` apague/rotacione o client
   secret. Revogue o refresh token em `https://myaccount.google.com/permissions`.
   Um refresh token do Google não expira sozinho — enquanto não for revogado, ele
   continua valendo.
2. **Avise quem cuida daquela conta.** O e-mail que aparecia no blob não é o seu.
3. **Se este projeto já esteve em algum Git**, o arquivo antigo continua no
   histórico. `git log -p -- .env.example` mostra. Reescrever o histórico
   (`git filter-repo`) só faz sentido *depois* de revogar — a revogação é o que
   realmente resolve.
4. **Nunca publique este repositório** antes de conferir: `git log --all -p |
   grep -iE 'refresh_token|client_secret|api[_-]?key'`.

### 0.2 Confirme que `.env` não vai para o Git

```bash
grep -n '^\.env' .gitignore     # deve listar .env
git check-ignore -v .env        # deve dizer que está ignorado
```

Se `.env` já foi commitado alguma vez, trate as senhas dele como vazadas também
e gere novas no Passo 3.

---

## Passo 1 — Escolha o caminho

Três formas de acessar de fora. Elas não são equivalentes — a diferença é *quem
consegue bater na porta*.

| | Quem alcança o app | Domínio grátis | Abre porta no roteador | Esforço |
|---|---|---|---|---|
| **A. Tailscale (privado)** | só os seus dispositivos | não precisa | não | 10 min |
| **B. Tailscale Funnel** | qualquer um na internet | sim, `*.ts.net` | não | 15 min |
| **C. Cloudflare Tunnel** | qualquer um na internet | precisa de domínio | não | 30 min |

**A recomendação honesta é o caminho A.** Você pediu "deixar público", mas quase
sempre o que se quer é *"acessar de qualquer lugar"* — e isso o Tailscale privado
faz sem nunca expor a tela de login para a internet. Se são você e mais uma ou
duas pessoas, instalar o app do Tailscale no celular delas é menos trabalho do
que blindar um endpoint público, e é ordens de grandeza mais seguro: um bug de
autenticação no FindHome deixa de ser um problema de internet.

Escolha B ou C se você realmente precisa que alguém sem app nenhum abra um link.
C é o melhor dos dois (WAF, rate limit e uma segunda camada de login antes do
app), mas exige um domínio no Cloudflare.

> **Nenhum dos três abre porta no roteador.** Isso é de propósito. Port
> forwarding + DDNS funciona, mas expõe o IP da sua casa, depende de IP dinâmico e
> não funciona atrás de CGNAT (comum em fibra no Brasil). Todos os caminhos aqui
> usam uma conexão *de dentro para fora*, o que resolve os três problemas de uma
> vez.

---

## Passo 2 — Preparar o notebook

### Se o notebook é Linux (Ubuntu/Debian)

```bash
cd ~/findhome           # onde está o projeto
./setup.sh              # instala Docker, gera o .env, sobe tudo
make status
```

### Se o notebook é Windows 11

O projeto é Docker Compose com scripts em bash, então rode **dentro do WSL2** —
não no PowerShell.

```powershell
# 1. Instale o WSL2 com Ubuntu (PowerShell como administrador)
wsl --install -d Ubuntu
# reinicie quando pedir, crie usuário e senha do Ubuntu
```

1. Instale o **Docker Desktop** (<https://docker.com/products/docker-desktop>).
2. Em `Settings → Resources → WSL Integration`, ligue a integração com **Ubuntu**.
3. Em `Settings → General`, marque **Start Docker Desktop when you log in**.
4. Abra o Ubuntu (menu Iniciar) e copie o projeto para **dentro** do WSL:

```bash
# Dentro do Ubuntu/WSL. Copiar para o filesystem do Linux, não deixar em /mnt/c:
# em /mnt/c o Docker fica lento e as permissões de arquivo dão problema.
mkdir -p ~/findhome && cd ~/findhome
cp -r /mnt/c/TESTE/findhome/. .
chmod +x setup.sh deploy/backup.sh
./setup.sh
```

> **Confirme que está no lugar certo:** `pwd` deve responder `/home/<voce>/findhome`,
> não `/mnt/c/...`.

### Confirme que subiu

```bash
make status          # db, web e scraper devem estar Up/healthy
curl -s localhost:3000/api/health
```

Abra `http://localhost:3000` no navegador. Deve aparecer a tela de login.

---

## Passo 3 — Blindar o `.env`

Abra o `.env` e ajuste. Estes valores são o que separa "app doméstico" de "porta
aberta":

```bash
cd ~/findhome
nano .env
```

**Gere segredos de verdade** (não reaproveite, não invente à mão):

```bash
openssl rand -base64 24     # POSTGRES_PASSWORD
openssl rand -base64 48     # JWT_SECRET  (mínimo 32 caracteres, o app recusa menos)
openssl rand -hex 24        # SCRAPE_CONTROL_TOKEN
```

Valores obrigatórios antes de expor:

```ini
# Segredos gerados acima
POSTGRES_PASSWORD=<openssl rand -base64 24>
JWT_SECRET=<openssl rand -base64 48>
SCRAPE_CONTROL_TOKEN=<openssl rand -hex 24>

# O app passa a ficar acessível SÓ pelo túnel, não pela rede local.
# (Faremos isso valer no Passo 5.)
BIND_ADDRESS=127.0.0.1

# Cookie de sessão só viaja por HTTPS. Ligue APENAS quando o HTTPS existir
# (Passo 4). Se ligar antes, o login entra em loop: o navegador descarta o
# cookie Secure em http:// e o app nunca vê a sessão.
COOKIE_SECURE=true

# Deixe true só até criar as contas. O Passo 6 fecha.
ALLOW_REGISTRATION=true

# O endereço público, para os links do feed de calendário e das mensagens.
# Preencha com o hostname que o Passo 4 te der.
APP_ORIGIN=https://SEU-HOSTNAME
```

> **Trocar `JWT_SECRET` invalida todas as sessões abertas.** Faça isso agora, não
> depois — trocar depois desloga todo mundo sem explicação.

Ainda **não** reinicie. Volte aqui depois de escolher o caminho no Passo 4.

---

## Passo 4A — Tailscale (privado, mais seguro)

Uma VPN ponto-a-ponto. O app fica visível apenas para os dispositivos que você
autorizar na sua conta. Nada é exposto à internet.

### 4A.1 Instalar no notebook

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

O comando imprime uma URL. Abra, entre com Google/GitHub/e-mail. Depois:

```bash
tailscale ip -4          # ex.: 100.101.102.103
tailscale status
```

> **No Windows/WSL2:** instale o Tailscale **no Windows** (o cliente nativo, não
> dentro do WSL). O Docker Desktop publica as portas no host Windows, então é o
> Windows que precisa estar no tailnet. Baixe em
> <https://tailscale.com/download/windows>.

### 4A.2 Ligar o MagicDNS e o HTTPS

No painel <https://login.tailscale.com/admin/dns>:

1. Ative **MagicDNS**.
2. Ative **HTTPS Certificates**.

Seu notebook passa a ter um nome estável, algo como
`notebook.tailnet-abc123.ts.net`.

### 4A.3 Servir o app com HTTPS dentro do tailnet

```bash
# Encaminha https://<seu-host>.ts.net  ->  http://127.0.0.1:3000
sudo tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve status
```

### 4A.4 Ajustar o `.env`

```ini
COOKIE_SECURE=true
APP_ORIGIN=https://notebook.tailnet-abc123.ts.net
```

```bash
docker compose up -d
```

### 4A.5 Dar acesso a outra pessoa

Duas opções:

- **Convidar para o tailnet** (<https://login.tailscale.com/admin/users> →
  *Invite external users*). Ela instala o app do Tailscale no celular e acessa a
  URL `.ts.net` normalmente. É o caminho certo para um casal procurando
  apartamento junto.
- **Compartilhar só esta máquina**: `tailscale share` / no painel, em *Machines →
  ⋯ → Share*. A pessoa vê apenas este dispositivo, não o resto da sua rede.

**Pronto.** Você tem HTTPS válido, nome estável, acesso de qualquer lugar, zero
superfície pública. Se isso já resolve, pare aqui e vá para o Passo 5.

---

## Passo 4B — Tailscale Funnel (público, domínio grátis)

O Funnel expõe o mesmo hostname `.ts.net` para **toda a internet**, com
certificado válido, sem comprar domínio e sem tocar no roteador. É a resposta
mais direta para "quero um domínio grátis".

Faça o **Passo 4A inteiro primeiro** (Funnel depende do `serve` e do MagicDNS).

### 4B.1 Liberar o Funnel na sua conta

No painel <https://login.tailscale.com/admin/acls>, adicione o atributo
`funnel` ao seu nó. No editor de ACL:

```jsonc
{
  "nodeAttrs": [
    { "target": ["autogroup:member"], "attr": ["funnel"] }
  ]
}
```

### 4B.2 Ligar

```bash
sudo tailscale funnel --bg --https=443 http://127.0.0.1:3000
tailscale funnel status
```

A URL pública é a mesma do 4A:
`https://notebook.tailnet-abc123.ts.net`.

### 4B.3 O que muda em relação ao 4A

O login do FindHome passa a ser a **única** barreira. Então, obrigatoriamente:

- `ALLOW_REGISTRATION=false` depois de criar as contas (Passo 6). Sem isso,
  qualquer um cria conta no seu servidor.
- Senhas longas nas contas. O app limita tentativas
  (10 por conta a cada 15 min, ver `web/src/lib/rate-limit.ts`), mas o limitador
  é em memória e some quando o container reinicia.
- Revise `make logs-web` de vez em quando procurando `401`/`429` em rajada.

**Limitações do Funnel** (não são problemas, mas surpreendem):

- Só as portas 443, 8443 e 10000.
- O hostname é feio e não personalizável.
- O tráfego passa pela infraestrutura do Tailscale.

Se qualquer uma dessas te incomoda, vá para o 4C.

---

## Passo 4C — Cloudflare Tunnel (público, com domínio próprio)

O melhor conjunto de proteções, porque coloca uma camada inteira **antes** do
app: TLS, WAF, rate limiting e — o item que importa — **Cloudflare Access**, um
login por e-mail que roda antes de a requisição chegar no FindHome.

### 4C.1 Conseguir um domínio

O Cloudflare Tunnel precisa de um domínio cuja **zona DNS** esteja no
Cloudflare. Um subdomínio grátis emprestado de terceiros (DuckDNS, FreeDNS,
No-IP) **não serve** — você não controla a zona.

Opções reais:

- **`.com.br` ou `.com`** — R$ 40–60/ano. É o caminho sem atrito, e sinceramente
  o melhor custo-benefício se você vai manter isso rodando.
- **`.eu.org`** — grátis e permanente, domínio real, aceita delegação de NS para
  o Cloudflare. Peça em <https://nic.eu.org>. **A aprovação é manual e pode levar
  de dias a semanas** — comece o pedido agora e use o Passo 4B enquanto espera.

Depois de ter o domínio: <https://dash.cloudflare.com> → *Add a site* → siga as
instruções para trocar os nameservers no registrador. Espere ficar **Active**.

### 4C.2 Criar o túnel

```bash
# Instalar o cloudflared (Debian/Ubuntu)
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared
```

O caminho mais simples é criar o túnel pelo painel, porque ele já entrega o token
pronto:

1. <https://one.dash.cloudflare.com> → **Networks → Tunnels → Create a tunnel**
2. Tipo: **Cloudflared**. Nome: `findhome`.
3. Copie o token que aparece (uma string longa começando com `ey...`).
4. Em **Public Hostnames**, adicione:
   - Subdomain: `findhome` · Domain: `seudominio.com`
   - Service: `HTTP` → `web:3000`

> **`web:3000`, não `localhost:3000`.** O `cloudflared` vai rodar como container
> na mesma rede Docker do app (próximo passo), então ele alcança o serviço pelo
> nome. `localhost` apontaria para o próprio container do cloudflared.

### 4C.3 Subir o cloudflared junto do stack

Já existe um overlay pronto neste repositório:

```bash
# Guarde o token no .env (ele NÃO vai para o Git)
echo 'CLOUDFLARE_TUNNEL_TOKEN=ey...' >> .env

docker compose -f docker-compose.yml -f deploy/cloudflared-compose.yml up -d
docker compose logs -f cloudflared     # deve dizer "Registered tunnel connection"
```

### 4C.4 Ajustar o `.env`

```ini
BIND_ADDRESS=127.0.0.1
COOKIE_SECURE=true
APP_ORIGIN=https://findhome.seudominio.com
```

```bash
docker compose -f docker-compose.yml -f deploy/cloudflared-compose.yml up -d
```

Teste: `https://findhome.seudominio.com`.

### 4C.5 A parte que vale o trabalho todo: Cloudflare Access

Um login por e-mail **antes** do app. Grátis até 50 usuários.

1. <https://one.dash.cloudflare.com> → **Access → Applications → Add an
   application → Self-hosted**
2. Nome: `FindHome` · Domain: `findhome.seudominio.com`
3. **Policy**: `Allow` → Include → **Emails** → liste só os e-mails de quem pode
   entrar (o seu e o da outra pessoa).
4. Em **Authentication**, deixe **One-time PIN** ligado. É suficiente e não exige
   configurar provedor de identidade.

Com isso, um estranho que descubra a URL vê a tela do Cloudflare pedindo um
e-mail autorizado — e a tela de login do FindHome deixa de ser exposta.

> **Não confunda com o `_next` cache.** O Access protege o app inteiro,
> inclusive `/api/*`. Se um dia você quiser assinar o feed de calendário no
> Google/Apple Calendar (que não sabe fazer login no Access), crie uma policy
> `Bypass` só para o caminho `/api/calendar/*`. Aquele endpoint já é protegido
> por um token secreto na própria URL.

### 4C.6 Recomendado: HSTS e rate limit no Cloudflare

- **SSL/TLS → Edge Certificates**: ligue *Always Use HTTPS* e
  *HTTP Strict Transport Security (HSTS)*.
  Por isso o app **não** manda HSTS por conta própria (veja o comentário em
  `web/next.config.mjs`): quem termina o TLS é quem deve mandar o header.
- **Security → WAF → Rate limiting rules**: crie uma regra para
  `/api/auth/login` — por exemplo 10 requisições por minuto por IP, ação
  *Block*. Isso complementa o limitador em memória do app, que não sobrevive a
  um restart.
- **Security → Settings**: *Bot Fight Mode* ligado.

---

## Passo 5 — Fechar a porta 3000

Todos os caminhos acima falam com o app por dentro. Então a porta 3000 não deve
mais estar aberta na rede local.

```bash
# .env
BIND_ADDRESS=127.0.0.1
```

```bash
docker compose up -d          # ou com o overlay do cloudflared
```

Confirme:

```bash
# De OUTRO computador na mesma rede. Deve dar timeout / connection refused:
curl -m 5 http://IP-DO-NOTEBOOK:3000
```

Se ainda responder, o `docker compose up -d` não recriou o container: force com
`docker compose up -d --force-recreate web`.

### Firewall

**Linux:**

```bash
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp                 # SSH, se você usa
sudo ufw enable
sudo ufw status verbose
```

**Windows:** o Docker Desktop com `BIND_ADDRESS=127.0.0.1` já não publica na
rede. Confirme que o perfil da sua rede Wi-Fi está como **Pública** em
`Configurações → Rede e Internet → Wi-Fi → Propriedades`.

### Nunca exponha o Postgres

Confira que o bloco `ports:` do serviço `db` no `docker-compose.yml` continua
comentado. Ele já vem assim — mantenha.

---

## Passo 6 — Criar as contas e trancar o cadastro

1. Acesse a URL pública e crie a sua conta.
2. Se for procurar apartamento com alguém: crie a party (**Central da Party →
   Criar**), copie o código de convite e mande para a pessoa. Ela se cadastra com
   o código e cai direto no espaço compartilhado.
3. **Agora feche o cadastro:**

```bash
# .env
ALLOW_REGISTRATION=false
```

```bash
docker compose up -d
```

Teste: abra `/register` numa janela anônima. Deve recusar.

> Precisou criar mais uma conta depois? Volte para `true`, crie, volte para
> `false`. Dois `docker compose up -d` e uns 20 segundos.

Se você rodou `make seed` em algum momento, **apague as contas de demonstração** —
a senha delas está no `.env` (`SEED_PASSWORD`) e é conhecida:

```bash
make psql
```

```sql
-- Veja o que existe antes de apagar
SELECT id, email, name FROM users ORDER BY created_at;
-- Apague as que não são suas (as interações e notas vão com elas, por cascade)
DELETE FROM users WHERE email IN ('demo@findhome.local', 'outra@demo.local');
```

---

## Passo 7 — Backup automático

O banco tem as suas notas, avaliações e visitas — não está em portal nenhum.
Perder isso é perder o trabalho todo.

```bash
make backup                  # escreve em ./backups/findhome-<data>.sql.gz
ls -lh backups/
```

Agende (Linux, ou dentro do WSL com `systemd` habilitado):

```bash
crontab -e
```

```cron
# Backup diário às 03:00
0 3 * * * cd /home/SEU-USUARIO/findhome && make backup >> /tmp/findhome-backup.log 2>&1
# Mantém 30 dias
30 3 * * * find /home/SEU-USUARIO/findhome/backups -name '*.sql.gz' -mtime +30 -delete
```

> No WSL2, o cron só roda com o WSL aberto. Alternativa no Windows: crie uma
> tarefa no **Agendador de Tarefas** executando
> `wsl -d Ubuntu -- bash -lc "cd ~/findhome && make backup"`.

**Leve uma cópia para fora do notebook.** Um backup no mesmo disco que o banco
não é backup. Um `rclone copy backups/ remote:findhome` ou até arrastar para o
Google Drive uma vez por semana já resolve.

Teste a restauração pelo menos uma vez, num banco descartável:

```bash
make restore FILE=backups/findhome-2026-08-06.sql.gz
```

---

## Passo 8 — O notebook não pode dormir

Notebook fechado é notebook suspenso, e servidor suspenso é servidor fora do ar.

**Linux:**

```bash
# Ignorar a tampa fechada
sudo sed -i 's/^#\?HandleLidSwitch=.*/HandleLidSwitch=ignore/' /etc/systemd/logind.conf
sudo sed -i 's/^#\?HandleLidSwitchExternalPower=.*/HandleLidSwitchExternalPower=ignore/' /etc/systemd/logind.conf
sudo systemctl restart systemd-logind

# Nunca suspender/hibernar
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

**Windows 11:**

```powershell
# Ligado na tomada: nunca dormir, nunca desligar a tela, tampa não faz nada
powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 15
powercfg /setacvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0
powercfg /setactive SCHEME_CURRENT
```

Também: `Configurações → Windows Update → Opções avançadas` → desligue
**Reiniciar assim que possível**, ou uma atualização derruba o app às 3h da manhã.

E deixe o Docker subir sozinho depois de um reboot: os containers já usam
`restart: unless-stopped`, então basta o Docker iniciar com o sistema
(no Windows, aquele *Start Docker Desktop when you log in* do Passo 2).

---

## Passo 9 — Checklist final

Antes de mandar o link para alguém, confira cada linha:

```bash
cd ~/findhome

# Segredos não são os de exemplo
grep -E '^(JWT_SECRET|POSTGRES_PASSWORD|SCRAPE_CONTROL_TOKEN)=' .env
#   -> nada de "change-me". JWT_SECRET com 32+ caracteres.

# Cadastro fechado, cookie seguro, app só no localhost
grep -E '^(ALLOW_REGISTRATION|COOKIE_SECURE|BIND_ADDRESS|APP_ORIGIN)=' .env
#   -> false / true / 127.0.0.1 / https://...

# Nada além do necessário publicado no host
docker compose ps
#   -> a coluna PORTS de `web` deve mostrar 127.0.0.1:3000->3000
#   -> `db` e `scraper` sem nenhuma porta

# A porta não responde de fora
# (de outro aparelho na rede) curl -m 5 http://IP-DO-NOTEBOOK:3000   -> falha

# HTTPS de verdade na URL pública
curl -sI https://SEU-HOSTNAME | head -n 20
#   -> HTTP/2 200 (ou 302 para /login), e o certificado válido

# .env fora do Git
git check-ignore -v .env

# Backup existe e não está vazio
ls -lh backups/ | tail -5
```

- [ ] Passo 0 feito: tokens do Google Ads revogados
- [ ] `.env` com segredos gerados por `openssl`
- [ ] `ALLOW_REGISTRATION=false`
- [ ] `COOKIE_SECURE=true` **e** HTTPS funcionando
- [ ] `BIND_ADDRESS=127.0.0.1`
- [ ] Contas de seed apagadas
- [ ] Postgres sem porta publicada
- [ ] Backup automático agendado + uma cópia fora do notebook
- [ ] Notebook não suspende
- [ ] (Caminho 4C) Cloudflare Access com lista de e-mails
- [ ] (Caminho 4C) HSTS e rate limit no `/api/auth/login`

---

## Manutenção

```bash
make status          # os containers estão de pé?
make logs-web        # o app
make logs-scraper    # a coleta
make scrape-status   # o que cada portal devolveu na última rodada
make doctor          # por que um portal parou de funcionar
make photos          # buscar as galerias que ficaram com uma foto só
make backup
make update          # git pull + rebuild + migrate
make prune           # recuperar espaço em disco
```

Vale olhar uma vez por semana:

- `make scrape-status` — um portal com `0 listings` por dias seguidos quebrou.
  `make doctor` diz se foi bot wall, URL que mudou ou campo renomeado.
- `docker stats --no-stream` — o scraper sobe até ~1GB durante a coleta (Chromium)
  e volta. Se ficar cravado no limite, baixe `SCRAPE_MAX_PAGES`.
- `df -h` — imagens antigas do Docker enchem disco. `make prune`.

---

## Perguntas que aparecem depois

**Dá para usar DuckDNS/No-IP com Cloudflare Tunnel?**
Não. O túnel exige que a zona DNS esteja no Cloudflare, e num subdomínio
emprestado você não controla a zona. Use o Passo 4B (Funnel) se quiser algo
grátis hoje, ou um domínio de verdade para o 4C.

**Meu IP é dinâmico / estou atrás de CGNAT. Muda algo?**
Não. Nenhum dos três caminhos aceita conexão de entrada — o notebook é que abre a
conexão para fora. É justamente por isso que eles funcionam onde port forwarding
não funciona.

**O login está entrando em loop.**
`COOKIE_SECURE=true` sem HTTPS na ponta. O navegador descarta um cookie `Secure`
recebido por `http://`, então o app nunca vê a sessão. Ou termine o TLS
(Passo 4), ou volte para `COOKIE_SECURE=false` enquanto testa em `localhost`.

**Posso deixar isso público de verdade, para estranhos usarem?**
Tecnicamente sim; na prática, não deixe. Dois motivos concretos. Primeiro, o
FindHome raspa portais de terceiros — os termos de uso deles não contemplam você
operar um serviço em cima disso, e o volume de requisições de vários usuários
deixa de ser "uso doméstico". Segundo, ele foi construído para um número pequeno
de pessoas que confiam umas nas outras: o limitador de requisições vive em
memória num único processo, o registro é aberto/fechado por variável de ambiente,
não existe verificação de e-mail nem recuperação de senha. É um app de casa. Para
oferecer para outras pessoas, o caminho é a landing page em `landing/` e uma
conversa sobre o que precisaria mudar antes.

**Como eu removo o acesso público depois?**

```bash
# Caminho 4B
sudo tailscale funnel --https=443 off
# Caminho 4C
docker compose -f docker-compose.yml -f deploy/cloudflared-compose.yml down cloudflared
```

O app continua no ar para você em `localhost` e (no caminho A) dentro do tailnet.
