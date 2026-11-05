# Compras do Apple Pay em "Pendentes" + avisos no celular

Cada compra no Apple Pay vira um lançamento **pendente** no app e (se ligado) um **aviso no celular**.
Você só escolhe a categoria e confirma. Precisa do app instalado na Tela de Início (iPhone com iOS 16.4 ou mais novo).

## 1. Avisos no celular (chaves)
1. Abra `https://SEU-ENDERECO.vercel.app/chaves.html` e toque em **Gerar chaves**.
2. Na Vercel: projeto → **Settings** → **Environment Variables**. Crie:
   - `VAPID_PUBLIC_KEY` = a chave pública
   - `VAPID_PRIVATE_KEY` = a chave privada (secreta)
   - (opcional) `SITE_URL` = `https://SEU-ENDERECO.vercel.app`
3. **Redeploy** (Deployments → os três pontinhos do último deploy → Redeploy).
4. No app, aberto pelo ícone da Tela de Início: **Pendentes → Avisos no celular** → escolha o modo
   ("Lembrete do dia", "A cada lançamento" ou "Os dois") e toque em **Ativar** (aceite a permissão).

## 2. Atalho do iPhone (Apple Pay)
1. Na Vercel, crie a variável `ATALHO_CHAVE` com uma senha longa e inventada (não reutilize outra senha). **Redeploy**.
2. No iPhone: app **Atalhos** → **Automação** → **+** → **Transação** → escolha os cartões →
   **Executar imediatamente** → **Próximo** → **Novo atalho em branco**.
3. Adicione a ação **Obter conteúdo de URL** e configure:
   - **URL:** `https://SEU-ENDERECO.vercel.app/api/gastos?recurso=pendentes`
   - **Método:** POST
   - **Cabeçalhos:** `x-atalho` = o valor de `ATALHO_CHAVE`
   - **Corpo da solicitação:** JSON, com estes campos de texto:
     - `valor` = variável **Valor** da transação
     - `estabelecimento` = variável **Comerciante**
     - `cartao` = variável do **Cartão** (o nome que aparece na Carteira)
     - `quem` = o nome da pessoa (modo casal; deve ser igual ao nome cadastrado em Configurações → Pessoas)
4. Faça uma compra pequena (ou use o teste do Atalhos). A compra deve aparecer em **Pendentes**.

Dicas:
- O app reconhece o cartão pelo nome: se o texto do atalho contém o nome de um cartão ou conta cadastrados
  (ex.: "Visa Nubank"), usa esse; senão cai no débito da primeira conta.
- O Apple Pay não diz se foi crédito ou débito: no primeiro lançamento você escolhe, e o app lembra por estabelecimento.
- Cada pessoa configura o próprio atalho, no próprio iPhone, com o próprio `quem`.
