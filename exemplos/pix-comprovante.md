# Pix pelo comprovante (Compartilhar → Pendentes)

Você abre o comprovante do Pix no app do banco, toca em **Compartilhar** e o app cria o Pix em **Pendentes**
(entrada ou saída, com valor, data e nome de quem pagou ou recebeu). Você só escolhe a conta e a categoria e confirma.

- Formatos reconhecidos: comprovantes do **C6** e do **Nubank**. Outros bancos podem funcionar, mas se o app não
  conseguir ler, ele avisa e guarda um trecho (com os números escondidos) em **Configurações → Diagnóstico**,
  para ajustar o leitor.
- O texto é lido **no seu iPhone** e vai só para o **seu** servidor.
- Pré-requisito: a variável `ATALHO_CHAVE` na Vercel (a mesma senha do atalho do Apple Pay; veja `atalho-apple-pay.md`).

## Montar o atalho (uma vez, no iPhone)
1. App **Atalhos** → **+** (novo atalho) → nome: "Enviar Pix".
2. Nos detalhes do atalho (ícone ⓘ): ligue **Mostrar na Folha de Compartilhamento** e aceite **Imagens** (e **PDFs**,
   se o seu banco gera comprovante em PDF).
3. Ação **Extrair Texto da Imagem**, usando a **Entrada de Atalho**. (Para PDF, use a ação que transforma a entrada em
   texto, como "Obter texto da entrada". Os nomes das ações podem variar um pouco conforme a versão do iOS.)
4. Ação **Obter conteúdo de URL**:
   - **URL:** `https://SEU-ENDERECO.vercel.app/api/gastos?recurso=pendentes`
   - **Método:** POST
   - **Cabeçalhos:** `x-atalho` = o valor de `ATALHO_CHAVE`
   - **Corpo da solicitação:** JSON, com os campos de texto:
     - `texto` = o **Texto extraído** da ação anterior (obrigatório)
     - `meuNome` = seu nome **como aparece no banco**, de preferência completo (recomendado: é como o app descobre se o Pix
       foi enviado ou recebido por você; sem ele vale o nome cadastrado em Configurações → Pessoas)
     - `conta` = o nome da conta do app de onde o Pix saiu ou onde entrou, ex.: `C6 Bank` (opcional; sem isso vale a conta
       principal; dica: faça um atalho para cada banco, cada um com a sua conta)
     - `quem` = o nome da pessoa (só no modo casal)
5. (Opcional) Ação **Mostrar notificação** com o resultado, para ver na hora se deu certo.

## Usar
No app do banco, abra o comprovante, tire um print (ou compartilhe o PDF) → **Compartilhar** → **Enviar Pix**.
Em alguns segundos o Pix aparece em **Pendentes** (e chega o aviso no celular, se estiver ligado). Escolha a conta e a
categoria (ou a origem, nas entradas) e toque em **Confirmar**.

- Enviar o mesmo comprovante duas vezes não duplica.
- Se aparecer "não consegui ler o nome…" ou "não achei o valor", abra **Configurações → Diagnóstico → Copiar relatório**
  e mande para quem está ajudando.
