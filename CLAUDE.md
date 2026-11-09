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
- `quem` dos lançamentos é o id da pessoa: `"EU"` (primeira) ou `"P2"` (segunda, modo casal opcional). Os nomes ficam em
  `perfil.pessoas`. Cada celular sabe quem é: o Face ID cadastra o celular com a pessoa (convite gerado em
  Configurações → Face ID → "Liberar outro celular", escolhendo "Liberar para"); fica em `localStorage 'quem'`
  e pode ser trocado em Configurações → Pessoas. Os dados são compartilhados; há filtros por pessoa no modo casal.
- A primeira conta cadastrada é a **conta principal** (`contaPrincipal()` em `index.html`): recebe recebimentos sem
  conta marcada, contas fixas e faturas pagas.
- Contas bancárias (nome, ícone em foto, qual é a principal) são editadas em Configurações → Contas bancárias (`perfil.contas`).
  O ícone escolhido pelo usuário vence o selo colorido de `BANCOS`.
- A fatura paga de um cartão desconta da conta `contaDebito` do cartão (`contaDebitoDoCartao` em `index.html`; sem escolha, a
  conta principal; '' = fora dos saldos). Saldo da conta = saldo-base + lançamentos − contas fixas pagas − faturas pagas.
- Cartões de crédito são cadastrados em Cartões → "+ Novo cartão" (nome, melhor dia, vencimento, limite, titular).
- Ícones dos bancos: `BANCOS` em `index.html` (selo na cor do banco). Para usar o logo oficial, ponha o arquivo em
  `/logos/<chave>.png` e liste a chave em `LOGOS_IMG`.
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

## Avisos no celular e atalho do Apple Pay (opcional)
Passo a passo em `exemplos/atalho-apple-pay.md`. As chaves dos avisos são geradas no navegador, em `/chaves.html`
(nada é enviado a lugar nenhum); a chave privada vai só para a Vercel (`VAPID_PRIVATE_KEY`). Nunca peça nem cole
chaves, tokens ou senhas na conversa.

## Pix pelo comprovante (opcional)
Guia em `exemplos/pix-comprovante.md`. O atalho de Compartilhar do iPhone lê o texto do comprovante e o manda no campo
`texto` para o mesmo endpoint do Apple Pay (`/api/gastos?recurso=pendentes`, cabeçalho `x-atalho`). O servidor
(`lerComprovantePix` em `api/gastos.js`, portado do app Mars) entende comprovantes do C6 e do Nubank e cria um pendente
`forma: "PIX"` com `tipo` ENTRADA ou SAÍDA. Para outro banco, peça ao dono o relatório do Diagnóstico (traz um trecho do
texto lido, com os números escondidos) e ajuste o leitor.

## Diagnóstico de avisos e do Apple Pay
Se "a compra não gerou aviso", peça ao dono: **Configurações → Diagnóstico → Copiar relatório** e colar na conversa.
O relatório mostra o que está configurado e o resultado das últimas compras. Como ler:
- **ATALHO_CHAVE não configurada / senha incorreta / chegou sem a senha do atalho:** a variável não existe na Vercel (ou não foi
  republicada), ou o cabeçalho `x-atalho` do atalho do iPhone não é exatamente o mesmo valor.
- **Faltaram dados na compra:** o corpo do atalho precisa ser JSON com `valor` e `estabelecimento` (veja "Campos recebidos").
- **Nenhum evento:** o atalho não disparou. Confira no iPhone: Atalhos → Automação → Transação, "Executar imediatamente".
- **Compra recebida, aviso NÃO enviado:** o motivo vem escrito (chaves VAPID, modo "Lembrete do dia", pessoa diferente etc.).
O relatório nunca traz senhas nem chaves. Nunca peça isso ao dono.

## Sincronização automática (repositório do usuário)
O modelo da rotina está em `exemplos/sync-base.yml` (no base). No repositório do **usuário**, crie
`.github/workflows/sync-base.yml` com esse conteúdo (uma vez só, à mão: a atualização nunca altera arquivos de
workflow) e ligue em **Actions**. A rotina assina os commits como o dono do repositório e sempre cria um commit de
merge (`--no-ff`): no plano gratuito da Vercel, commits de outra assinatura ficam **Bloqueados** e o app não republica. Ela puxa todo dia a branch **`estavel`** do base
(`entrefolhaspaisagismo/app-financeiro-base`) para o `main` do usuário; a Vercel republica sozinha.
Se houver conflito, a rotina para e falha (sem sobrescrever nada): rode
`git fetch upstream estavel && git merge upstream/estavel` (adicione o remoto `upstream` se faltar),
resolva preservando as mudanças pessoais e envie.
No repositório base: o trabalho vai no `main`; só o que está aprovado vai para `estavel`.

## Testar localmente (opcional)
Não há build. `vercel dev` com as variáveis de ambiente, ou abrir os arquivos num servidor estático.
Antes de mexer em `index.html`, confira a sintaxe do JavaScript dentro das tags `<script>`.
