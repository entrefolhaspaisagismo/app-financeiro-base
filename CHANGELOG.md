# Histórico de versões

Cada versão é uma etiqueta (tag) do Git. Você só atualiza se quiser.
Versões marcadas com **(recomendada)** trazem correção de segurança ou de dados.

## v1.4.1 — logos dos bancos
- Logos de 12 bancos no lugar do selo colorido: Nubank, C6, Itaú, Inter, Bradesco, Santander, Caixa, Banco do Brasil,
  PicPay, XP, BTG Pactual e Mercado Pago (PNG 96x96 em `logos/`, gerados a partir de SVG do Wikimedia Commons, com fundo na cor do banco).
- Origem (Wikimedia Commons): Nubank = `Nubank logo 2021.svg`; C6 = `Logo C6 Bank.svg`; Itaú = `Itaú Unibanco logo 2023.svg`;
  Inter = `Logo do banco Inter (2023).svg`; Bradesco = `Banco Bradesco logo.svg` (só o símbolo);
  Santander = `Banco santander logo.svg` (só a chama); Caixa = `Caixa Econômica Federal logo 1997.svg`;
  Banco do Brasil = `Logotipo do Banco do Brasil (símbolo).svg`; PicPay = `Logotipo do PicPay.svg`;
  XP = `Logotipo da XP Investimentos.svg`; BTG = `Btg-logo-blue.svg` (só o "btg").
- Mercado Pago: logo (aperto de mãos) enviado pelo dono do app, sobre o azul do banco.
- Os logos são marcas dos respectivos bancos, usadas só para identificar a conta. Quem preferir pode trocar o ícone de
  qualquer conta por uma foto em Configurações → Contas bancárias.

## v1.4.0
- **Configurações → Contas bancárias:** adicionar e remover contas, tornar uma conta a principal e trocar o ícone de
  qualquer banco por uma foto da galeria (tudo pelo app, sem mexer em código).
- Logo do Safra incluído.

## v1.3.0
- **Configurações → Diagnóstico:** mostra se avisos e atalho do Apple Pay estão configurados e o histórico das últimas
  compras do atalho com o motivo de cada falha, com botão "Copiar relatório" (sem senhas nem chaves).

## v1.2.2
- Ícone do Banco Safra (e Safra entre as sugestões da boas-vindas).

## v1.2.1
- Guia do atalho: o caminho dos avisos é Configurações → Avisos no celular.
- Correção: com `CODIGO_INICIAL` definido, o app agora pede o código ao ativar o Face ID (antes a ativação falhava).

## v1.2.0
- Página `/chaves.html` para gerar, no próprio navegador, as chaves dos avisos no celular, e guia do atalho do
  Apple Pay em `exemplos/atalho-apple-pay.md`.

## v1.1.1
- Textos que ficaram do app original ("da família") agora são neutros; o titular do cartão sem dono mostra "Os dois" no modo casal.

## v1.1.0 **(recomendada)**
- **Cadastro de cartões de crédito** na tela Cartões ("+ Novo cartão"): faltava na v1.0.0.
- **Modo casal (opcional):** duas pessoas no mesmo app, com dados compartilhados, filtro por pessoa, cartões por titular
  e avisos no celular por pessoa. O segundo celular entra por código de convite e o Face ID já o identifica.
  Em Configurações → Pessoas dá para ligar ou desligar depois. Quem já usa sozinho continua igual.
- **Ícones dos bancos** (Nubank, C6, Itaú, Inter, Bradesco, Santander, Caixa, Banco do Brasil, Mercado Pago, PicPay,
  XP, BTG, Sicoob, Sicredi, Will, PagBank, Next), e cartões com a cor do banco.
- Correção: tela de bloqueio de um celular novo mostrava "Olá, undefined".

## Sem versão — sincronização automática
- Rotina diária (modelo em `exemplos/sync-base.yml`) que puxa a branch `estavel` do base para a cópia do usuário.

## v1.0.0 — primeira versão **(recomendada)**
- App de controle financeiro para uma pessoa: lançamentos, contas fixas, cartões e faturas, parcelas,
  investimentos (rendimento pelo CDI do Banco Central), tetos de gasto, importação de fatura (CSV/PDF).
- Tela de boas-vindas: nome e contas bancárias cadastrados no primeiro acesso.
- Face ID (passkey), com `CODIGO_INICIAL` opcional para o primeiro cadastro.
- Compras do Apple Pay em Pendentes (Atalhos do iPhone) e avisos no celular (Web Push).
- Dados 100% no Upstash Redis da própria pessoa.
