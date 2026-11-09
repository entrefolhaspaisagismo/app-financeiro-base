# Controle Financeiro

App de controle financeiro pessoal (para uma pessoa ou um casal): lançamentos, contas fixas, cartões e faturas,
investimentos, Pix e compras do Apple Pay em "Pendentes", avisos no celular e Face ID. Roda de graça na Vercel
com banco Upstash Redis, e os dados ficam só na sua conta.

## Começar
Você precisa de uma conta no **GitHub** e uma na **Vercel** (entre com o GitHub, é grátis para uso pessoal).

1. Toque no botão:

   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fentrefolhaspaisagismo%2Fapp-financeiro-base%2Ftree%2Fmodelo&project-name=meu-financeiro&repository-name=meu-financeiro&env=CODIGO_INICIAL&envDescription=Um%20c%C3%B3digo%20de%206%20n%C3%BAmeros%20que%20s%C3%B3%20voc%C3%AA%20sabe%20%28protege%20o%20cadastro%20do%20Face%20ID%29&envLink=https%3A%2F%2Fgithub.com%2Fentrefolhaspaisagismo%2Fapp-financeiro-base&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22upstash%22%2C%22productSlug%22%3A%22upstash-kv%22%7D%5D)

   A Vercel cria uma **cópia privada** do app na sua conta e oferece criar o **banco de dados Upstash Redis** (plano gratuito).
   Aceite a criação do banco e escolha um **código de 6 números** para `CODIGO_INICIAL`.
2. Clique em **Deploy** e espere terminar (cerca de 2 minutos). Depois toque em **Visit**.
3. O app abre na **tela de boas-vindas**: escolha seu nome e suas contas.
4. No **iPhone**: Safari → Compartilhar → **Adicionar à Tela de Início**; abra pelo ícone e ative o **Face ID** em
   Configurações (use o código de 6 números).

Se a Vercel não criar o banco sozinha, use este botão alternativo e cole a URL e o token que o Upstash mostra
(aba REST do banco): [Deploy alternativo](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fentrefolhaspaisagismo%2Fapp-financeiro-base%2Ftree%2Fmodelo&project-name=meu-financeiro&repository-name=meu-financeiro&env=CODIGO_INICIAL%2CUPSTASH_REDIS_REST_URL%2CUPSTASH_REDIS_REST_TOKEN&envDescription=CODIGO_INICIAL%3A%20um%20c%C3%B3digo%20de%206%20n%C3%BAmeros%20que%20s%C3%B3%20voc%C3%AA%20sabe.%20UPSTASH_%2A%3A%20URL%20e%20token%20REST%20do%20banco%20Redis%20criado%20no%20Upstash.&envLink=https%3A%2F%2Fgithub.com%2Fentrefolhaspaisagismo%2Fapp-financeiro-base).

Passo a passo manual, sem os botões, em `CLAUDE.md`. Guias opcionais (avisos no celular, Apple Pay e Pix pelo
comprovante) em `exemplos/`.

## Atualizações
A cópia criada pelo botão já vem com uma rotina que, todo dia, busca as novidades da branch `estavel` deste
repositório e atualiza o seu app. Para receber na hora: no GitHub da sua cópia, **Actions** → **Sincronizar com o base** →
**Run workflow**. O histórico de mudanças está em `CHANGELOG.md`.

Uso pessoal e não comercial; veja o arquivo `LICENSE`.
