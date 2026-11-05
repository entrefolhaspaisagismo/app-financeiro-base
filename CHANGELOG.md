# Histórico de versões

Cada versão é uma etiqueta (tag) do Git. Você só atualiza se quiser.
Versões marcadas com **(recomendada)** trazem correção de segurança ou de dados.

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
