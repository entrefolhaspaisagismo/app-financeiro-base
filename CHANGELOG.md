# Histórico de versões

Cada versão é uma etiqueta (tag) do Git. Você só atualiza se quiser.
Versões marcadas com **(recomendada)** trazem correção de segurança ou de dados.

## Sem versão — sincronização automática
- Rotina diária (`.github/workflows/sync-base.yml`) que puxa a branch `estavel` do base para a cópia do usuário.

## v1.0.0 — primeira versão **(recomendada)**
- App de controle financeiro para uma pessoa: lançamentos, contas fixas, cartões e faturas, parcelas,
  investimentos (rendimento pelo CDI do Banco Central), tetos de gasto, importação de fatura (CSV/PDF).
- Tela de boas-vindas: nome e contas bancárias cadastrados no primeiro acesso.
- Face ID (passkey), com `CODIGO_INICIAL` opcional para o primeiro cadastro.
- Compras do Apple Pay em Pendentes (Atalhos do iPhone) e avisos no celular (Web Push).
- Dados 100% no Upstash Redis da própria pessoa.
