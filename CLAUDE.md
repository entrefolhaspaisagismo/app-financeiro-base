# Controle Financeiro — guia para o Claude

Este repositório é um app de controle financeiro pessoal (uso de uma pessoa), pronto para ser montado e
personalizado. **Se o dono do repositório acabou de copiá-lo (fork), conduza a montagem pelos passos abaixo,
um de cada vez, em português, esperando ele confirmar cada passo.** Ele pode não ter experiência técnica:
explique o que fazer em cada site e confira o resultado antes de seguir.

## O que é
- `index.html`: o app inteiro (uma página só, JavaScript puro, sem build).
- `api/gastos.js`: servidor (função da Vercel) que guarda tudo num único registro no Upstash Redis.
- `api/auth.js` + `api/_seguranca.js`: Face ID / passkey para trancar o app.
- `api/push.js` + `api/_push.js` + `sw.js`: avisos no celular (opcional).
- `manifest.json`, `icon-v3.png`: instalação no celular como app.
- Sem dados dentro do código: nome, contas, cartões, contas fixas e categorias são cadastrados no app.

## Montagem (primeira vez)
1. **Banco de dados (Upstash).** Criar conta em https://upstash.com, criar um banco **Redis** (plano gratuito,
   região mais próxima, ex.: São Paulo). Na aba REST, copiar `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`.
2. **Hospedagem (Vercel).** Criar conta em https://vercel.com (plano Hobby, é gratuito para uso pessoal),
   "Add New → Project", importar este repositório do GitHub. Framework: **Other**. Sem comando de build.
3. **Variáveis de ambiente** (Project → Settings → Environment Variables):
   - `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` (obrigatórias).
   - `CODIGO_INICIAL`: um código qualquer (ex.: 6 números). Recomendado: exige esse código no primeiro
     cadastro do Face ID, para um estranho que descubra o endereço não "tomar" o app antes dele.
   - Opcionais: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (avisos no celular; gerar com
     `npx web-push generate-vapid-keys`), `ATALHO_CHAVE` (senha do atalho do iPhone para o Apple Pay),
     `SITE_URL` (endereço final do app), `APP_PREFIXO` (só se for dividir o banco com outro app).
   Depois de definir, fazer **Redeploy**.
4. **Primeiro acesso.** Abrir o endereço da Vercel no celular. A tela de boas-vindas pede nome e contas
   (Pix/débito). Em **Configurações → Segurança**, ativar o **Face ID** (usa o `CODIGO_INICIAL`).
5. **Instalar no celular.** iPhone: Safari → Compartilhar → "Adicionar à Tela de Início" (necessário para avisos).
6. **Cadastros.** Cartões (melhor dia de compra e vencimento), contas fixas, saldo de cada conta
   (Configurações → Saldo das contas) e categorias (Configurações → Categorias).

## Regras do modelo (não quebre ao personalizar)
- `quem` dos lançamentos é sempre `"EU"`. A primeira conta cadastrada é a **conta principal** (`contaPrincipal()`
  em `index.html`): recebe recebimentos sem conta marcada, contas fixas e faturas pagas.
- Fatura do cartão = data de vencimento do ciclo (`dataFaturaDaCompra` em `api/gastos.js`); o dia real da compra
  fica em `dataCompra`. Pagamento é por ciclo (`pagamentos[].ciclo`).
- Dados pessoais ficam no Redis, **nunca no código**. Mantenha assim: cores, categorias e contas dele são dados.
- O servidor usa um lock no Redis a cada gravação (`adquirirLock`); preserve isso.

## Personalizar
Peça ao dono o que ele quer mudar (cores, categorias, telas, relatórios). Mudanças pessoais devem ir em
arquivos/trechos pequenos e bem localizados, para facilitar receber as atualizações do repositório base.

## Receber atualizações do repositório base
O repositório original é o "base" (guarde o endereço que o dono te passar). Para atualizar:
```bash
git remote add upstream <endereço-do-repositório-base>   # só na primeira vez
git fetch upstream --tags
git merge upstream/main        # ou uma versão específica: git merge v1.1.0
```
Leia o `CHANGELOG.md` antes, resolva conflitos preservando as mudanças pessoais dele e teste abrindo o app.
Ele **não precisa** atualizar: a versão que ele já usa continua funcionando como está. Versões marcadas como
"recomendada" no `CHANGELOG.md` trazem correções de segurança ou de dados.
Alternativa sem terminal: no GitHub, botão **Sync fork** na página do repositório dele.

## Sincronização automática (repositório do usuário)
O modelo da rotina está em `exemplos/sync-base.yml` (no base). No repositório do **usuário**, crie
`.github/workflows/sync-base.yml` com esse conteúdo (uma vez só, à mão: a atualização nunca altera arquivos de
workflow) e ligue em **Actions**. Ela puxa todo dia a branch **`estavel`** do base
(`entrefolhaspaisagismo/app-financeiro-base`) para o `main` do usuário; a Vercel republica sozinha.
Se houver conflito, a rotina para e falha (sem sobrescrever nada): rode
`git fetch upstream estavel && git merge upstream/estavel` (adicione o remoto `upstream` se faltar),
resolva preservando as mudanças pessoais e envie.
No repositório base: o trabalho vai no `main`; só o que está aprovado vai para `estavel`.

## Testar localmente (opcional)
Não há build. `vercel dev` com as variáveis de ambiente, ou abrir os arquivos num servidor estático.
Antes de mexer em `index.html`, confira a sintaxe do JavaScript dentro das tags `<script>`.
