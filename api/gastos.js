// api/gastos.js — Vercel Serverless Function
// Guarda tudo num único registro no Upstash Redis: lançamentos, contas
// fixas, cartões, tetos e categorias extras, cada um numa chave dentro
// do mesmo JSON.

const crypto = require("crypto");
const VERSAO = "1.3.0";
const { liberado } = require("./_seguranca");

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
// Prefixo das chaves no Redis. Mude APP_PREFIXO só se for dividir o mesmo banco com outro app.
const PREFIXO = process.env.APP_PREFIXO || "financeiro";
const CHAVE_REDIS = `${PREFIXO}-dados`;
const CHAVE_LOCK = `${PREFIXO}-lock`;
const LOCK_TTL_MS = 8000;
const LOCK_ESPERA_MAX_MS = 5000;

// Dados iniciais: tudo vazio. A pessoa cadastra nome, contas, cartões, contas fixas e
// categorias na primeira abertura do app (tela de boas-vindas).
const PADRAO = {
  lancamentos: [],
  contasFixas: [],
  cartoes: [],
  tetos: { categorias: {}, reservaInicial: null, reservaData: null, saldosContas: {} },
  categoriasExtras: [],
  // compras avisadas pelo Atalhos do iPhone (Apple Pay), esperando confirmação
  pendentes: [],
  // personalização das categorias: as escondidas do "+" e os ícones trocados
  // (chave = nome da categoria, ou "grupo:<nome do grupo>")
  categoriasConfig: { ocultas: [], emojis: {} },
  // investimentos que rendem % do CDI (saldo recalculado no app com o CDI do Banco Central)
  investimentos: [],
  // quem usa o app: nome, contas bancárias (Pix/débito) e se a boas-vindas já foi concluída
  perfil: { nome: "", contas: [], concluido: false, pessoas: [] },
};
const CHAVE_CDI = `${PREFIXO}-cdi`;
const CDI_VALIDADE_MS = 6 * 60 * 60 * 1000;

async function corpoErro(r) {
  try {
    const j = await r.json();
    return j && (j.message || j.erro) ? (j.message || j.erro) : JSON.stringify(j);
  } catch (e) {
    try { return await r.text(); } catch (e2) { return ""; }
  }
}

// Lock distribuído no Redis: evita que duas gravações concorrentes (duas
// abas, celular + computador, etc.) façam leitura-mescla-escrita ao mesmo
// tempo e uma pise na outra. SET ... NX só grava se a chave ainda não
// existir; o TTL (PX) garante que o lock se solta sozinho mesmo se uma
// requisição travar antes de liberar.
async function adquirirLock() {
  const inicio = Date.now();
  while (Date.now() - inicio < LOCK_ESPERA_MAX_MS) {
    const r = await fetch(`${UPSTASH_URL}/set/${CHAVE_LOCK}/1/NX/PX/${LOCK_TTL_MS}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    if (r.ok) {
      const j = await r.json();
      if (j.result === "OK") return true;
    }
    await new Promise((res) => setTimeout(res, 80 + Math.random() * 120));
  }
  return false;
}

async function liberarLock() {
  try {
    await fetch(`${UPSTASH_URL}/del/${CHAVE_LOCK}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
  } catch (e) {}
}

async function lerTudo() {
  const r = await fetch(`${UPSTASH_URL}/get/${CHAVE_REDIS}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  if (!r.ok) throw new Error(`falha ao ler os dados: ${r.status} - ${await corpoErro(r)}`);
  const j = await r.json();
  const record = j.result ? JSON.parse(j.result) : {};
  const dados = JSON.parse(JSON.stringify({ ...PADRAO, ...record }));
  const t = dados.tetos || {};
  dados.tetos = {
    categorias: t.categorias || {},
    reservaInicial: t.reservaInicial !== undefined ? t.reservaInicial : null,
    reservaData: t.reservaData || null,
    // saldo inicial + data-base de cada conta: { "Nome da conta": { inicial, data } }
    saldosContas: t.saldosContas || {},
  };
  dados.perfil = { nome: "", contas: [], concluido: false, pessoas: [], ...(dados.perfil || {}) };
  // pessoas que usam o app: sempre há a primeira ("EU"); a segunda ("P2") só no modo casal
  if (!Array.isArray(dados.perfil.pessoas) || !dados.perfil.pessoas.length) dados.perfil.pessoas = [{ id: "EU", nome: dados.perfil.nome || "" }];
  return dados;
}

// CDI diário (série 12 do SGS do Banco Central, em % ao dia), guardado em
// cache no Redis por algumas horas pra não consultar o BC a cada abertura.
// Devolve { serie: { "AAAA-MM-DD": taxa }, atualizadoEm, desatualizado? }.
const isoParaBr = (iso) => iso.split("-").reverse().join("/");
async function serieCdi(desde) {
  let cache = null;
  try {
    const r = await fetch(`${UPSTASH_URL}/get/${CHAVE_CDI}`, { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } });
    if (r.ok) { const j = await r.json(); cache = j.result ? JSON.parse(j.result) : null; }
  } catch (e) {}
  const fresco = cache && cache.desde <= desde && Date.now() - cache.atualizadoEm < CDI_VALIDADE_MS;
  if (fresco) return { serie: cache.serie, atualizadoEm: cache.atualizadoEm };
  const inicio = cache && cache.desde < desde ? cache.desde : desde;
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${isoParaBr(inicio)}&dataFinal=${isoParaBr(hoje)}`;
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "controle-financeiro/1.0" } });
    if (!r.ok) throw new Error(`Banco Central respondeu ${r.status}`);
    const lista = await r.json();
    if (!Array.isArray(lista)) throw new Error("resposta inesperada do Banco Central");
    const serie = {};
    lista.forEach((d) => {
      const [dia, mes, ano] = String(d.data).split("/");
      const taxa = parseFloat(String(d.valor).replace(",", "."));
      if (ano && !isNaN(taxa)) serie[`${ano}-${mes}-${dia}`] = taxa;
    });
    const novo = { desde: inicio, atualizadoEm: Date.now(), serie };
    await fetch(`${UPSTASH_URL}/set/${CHAVE_CDI}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Authorization: `Bearer ${UPSTASH_TOKEN}` },
      body: JSON.stringify(novo),
    });
    return { serie, atualizadoEm: novo.atualizadoEm };
  } catch (e) {
    // sem BC agora: usa o último CDI guardado, avisando que pode estar velho
    if (cache) return { serie: cache.serie, atualizadoEm: cache.atualizadoEm, desatualizado: true };
    throw e;
  }
}

// "R$ 1.234,56" -> 1234.56 ; "45.90" -> 45.9 ; 45.9 -> 45.9
function lerValor(v) {
  if (typeof v === "number") return v;
  let t = String(v == null ? "" : v).replace(/[^\d,.-]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
const semAcento = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const hojeBR = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());

// Atalhos do iPhone: não tem Face ID, então usa uma senha própria (ATALHO_CHAVE)
// que só serve para enviar compras para "pendentes" — não lê nada.
function atalhoAutorizado(req) {
  const esperado = process.env.ATALHO_CHAVE;
  const enviado = String((req.headers || {})["x-atalho"] || "");
  if (!esperado || !enviado) return false;
  const a = Buffer.from(enviado), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- fatura do cartão (vencimento) a partir do melhor dia de compra e do dia de vencimento ----
const pad2 = (n) => String(n).padStart(2, "0");
function dataVencimento(ano, mes, dia) {
  const d = new Date(ano, mes - 1, 1);
  const a = d.getFullYear(), m = d.getMonth() + 1;
  return `${a}-${pad2(m)}-${pad2(Math.min(dia, new Date(a, m, 0).getDate()))}`;
}
// O cartão fecha no dia anterior ao "melhor dia de compra": compras a partir desse dia entram na fatura seguinte.
// Devolve "" se o cartão não tem o dia de vencimento cadastrado.
function dataFaturaDaCompra(c, iso) {
  const venc = Number(c && c.diaVencimentoFatura) || 0, melhor = Number(c && c.melhorDiaCompra) || 0;
  if (!venc) return "";
  const [a, m, d] = iso.split("-").map(Number);
  if (melhor) {
    const fecha = melhor - 1;
    const mesFecha = d >= melhor ? m + 1 : m;
    return dataVencimento(a, venc > fecha ? mesFecha : mesFecha + 1, venc);
  }
  return dataVencimento(a, venc > d ? m : m + 1, venc);
}

function novoPendente(dados, b) {
  const k = {};
  Object.keys(b || {}).forEach((c) => { k[semAcento(c)] = b[c]; });
  const valor = Math.abs(lerValor(k.valor));
  const estab = String(k.estabelecimento || k.comerciante || k.merchant || "").trim().slice(0, 80);
  if (!(valor > 0) || !estab) return { erro: "valor e estabelecimento são obrigatórios" };
  const data = /^\d{4}-\d{2}-\d{2}$/.test(String(k.data || "")) ? k.data : hojeBR();
  // de quem é a compra: o atalho manda o nome ("quem"); sem nome ou sem casar, é da primeira pessoa
  const pessoas = (dados.perfil && dados.perfil.pessoas) || [];
  const dona = pessoas.find((p) => semAcento(p.nome) === semAcento(k.quem));
  const quem = (dona && dona.id) || "EU";
  const cartaoTxt = semAcento(k.cartao);
  const contas = (dados.perfil && dados.perfil.contas) || [];
  // padrão: débito na primeira conta (é o que mais se usa); quem usou crédito troca no seletor e o app lembra por estabelecimento
  let forma = "Débito", cartaoId = null, conta = (contas[0] && contas[0].nome) || null, cartaoNome = "";
  // o texto do atalho (ex.: "Nubank", "Visa final 1234") é comparado com o nome de cada conta e cartão cadastrado
  const bate = (nome) => { const n = semAcento(nome); return n.length >= 2 && cartaoTxt.includes(n); };
  const contaCasada = contas.find((c) => bate(c.nome));
  const cartaoCasado = (dados.cartoes || []).find((x) => x.ativo !== false && bate(x.nome));
  // vale o nome mais específico: "Visa Nubank" (cartão) ganha de "Nubank" (conta)
  const tamConta = contaCasada ? semAcento(contaCasada.nome).length : 0;
  const tamCartao = cartaoCasado ? semAcento(cartaoCasado.nome).length : 0;
  if (cartaoCasado && tamCartao >= tamConta) { cartaoId = cartaoCasado.id; cartaoNome = cartaoCasado.nome; }
  else if (contaCasada) { conta = contaCasada.nome; cartaoNome = contaCasada.nome; }
  // sugere a categoria do último lançamento com o mesmo nome
  const ultimo = [...(dados.lancamentos || [])].reverse()
    .find((l) => l.tipo === "SAÍDA" && l.categoria && semAcento(l.descricao) === semAcento(estab));
  // o Apple Pay não diz se foi crédito ou débito: repete o que você escolheu da última vez nesse estabelecimento
  if (ultimo && ultimo.forma === "Débito") { forma = "Débito"; cartaoId = null; conta = ultimo.conta || conta; }
  else if (ultimo && ultimo.forma === "Crédito") {
    forma = "Crédito"; conta = null;
    if (ultimo.cartaoId && (dados.cartoes || []).some((x) => x.id === ultimo.cartaoId)) cartaoId = ultimo.cartaoId;
  }
  const msgId = `wallet:${data}:${valor.toFixed(2)}:${semAcento(estab)}`;
  return {
    item: {
      id: Date.now(), data, quem, valor, estabelecimento: estab, forma, cartaoId, conta,
      cartaoNome, origem: "Carteira (iPhone)", msgId,
      ...(ultimo ? { sugestaoCategoria: ultimo.categoria } : {}),
    },
  };
}

// ---- comprovante de Pix (texto lido do print/PDF pelo Atalhos): C6 e Nubank ----
const MESES_ABREV = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
function dataDoComprovante(plano) {
  const achados = [];
  let m;
  const reNum = /(\d{2})\/(\d{2})\/(\d{4})/g;
  while ((m = reNum.exec(plano))) achados.push({ i: m.index, d: `${m[3]}-${m[2]}-${m[1]}` });
  const reTxt = /(\d{1,2})\s+(?:de\s+)?([a-zçãé]{3,})\.?\s+(?:de\s+)?(\d{4})/gi;
  while ((m = reTxt.exec(plano))) {
    const mes = MESES_ABREV[semAcento(m[2]).slice(0, 3)] || ({ marco: 3 }[semAcento(m[2])]);
    if (mes) achados.push({ i: m.index, d: `${m[3]}-${pad2(mes)}-${pad2(Number(m[1]))}` });
  }
  achados.sort((a, b) => a.i - b.i);
  return achados.length ? achados[0].d : "";
}
function nomeLimpo(n) {
  // tira iniciais soltas do "avatar" (ex.: "W WILLIAM ROSA…") e espaços sobrando
  return String(n || "").replace(/^(?:[A-ZÀ-Ú]{1,2}\s+)+(?=[A-ZÀ-Ú]{3,})/, "").replace(/\s+/g, " ").trim().slice(0, 80);
}
const ehMeuNome = (nome, meuNome) => {
  const alvo = semAcento(meuNome).split(/\s+/).filter((t) => t.length > 2);
  const n = semAcento(nome);
  return alvo.length > 0 && alvo.every((t) => n.includes(t));
};
// Nubank, texto lido do print pelo iPhone: os títulos vêm primeiro e os valores depois
// ("Destino Nome CNPJ Instituição Tipo de conta CAIXA ECONOMICA FEDERAL 00360305000104 CAIXA ECONOMICA FEDERAL Conta corrente Origem …").
const TITULOS_NU = /^(?:Nome|CNPJ|CPF|Institui[cç][aã]o|Tipo de conta|Ag[eê]ncia|Conta)\s+/i;
const PALAVRAS_BANCO = /^(?:NU|NUBANK|ITA[UÚ]|BCO|BANCO|BRADESCO|SANTANDER|INTER|C6|MERCADO|PAGSEGURO|PICPAY|NEON|ORIGINAL|SICOOB|SICREDI|BANRISUL|BTG|XP|STONE|CIELO|GETNET|ASAAS|EFI|CAIXA)$/i;
function nomeAposTitulos(seg, cortarNoBanco) {
  let t = String(seg || "").trim();
  while (TITULOS_NU.test(t)) t = t.replace(TITULOS_NU, "");
  const out = [];
  for (const w of t.split(/\s+/)) {
    if (/[\d]/.test(w) || /^[.•·]/.test(w)) break;           // CNPJ/CPF vêm depois do nome
    if (cortarNoBanco && out.length && PALAVRAS_BANCO.test(w)) break; // origem: o banco vem colado depois do nome
    out.push(w);
  }
  return nomeLimpo(out.join(" "));
}
function lerComprovantePix(texto, meuNome) {
  const plano = String(texto || "").replace(/\s+/g, " ").trim();
  if (!plano) return { erro: "texto do comprovante vazio" };
  const mv = /Valor\s*R\$\s*([\d.]+,\d{2})/i.exec(plano) || /R\$\s*([\d.]+,\d{2})/.exec(plano);
  const valor = mv ? lerValor(mv[1]) : NaN;
  if (!(valor > 0)) return { erro: "não achei o valor no comprovante" };
  const data = dataDoComprovante(plano) || hojeBR();

  let origem = "", destino = "";
  const nome = (re) => { const x = re.exec(plano); return x ? nomeLimpo(x[1]) : ""; };
  if (/\bDestino\b/.test(plano) && /\bOrigem\b/.test(plano) && /Nome\s/.test(plano)) {
    // Nubank: "Destino … Nome X … Origem … Nome Y"
    destino = nome(/Destino[\s\S]*?Nome\s+(.+?)\s+(?:CNPJ|CPF|Institui)/);
    origem = nome(/Origem[\s\S]*?Nome\s+(.+?)\s+(?:CNPJ|CPF|Institui)/);
    // se o "nome" lido é só um título (CNPJ, Instituição…), o texto veio com os títulos primeiro: lê os valores depois dos títulos
    if (TITULOS_NU.test(destino + " ") || TITULOS_NU.test(origem + " ")) {
      const segD = /Destino\s+([\s\S]*?)\s+Origem\b/.exec(plano);
      const segO = /Origem\s+([\s\S]*?)(?:\s+Informa[cç][oõ]es adicionais|\s+Identific|$)/.exec(plano);
      const brutoO = segO ? segO[1] : "";
      const brutoD = segD ? segD[1] : "";
      destino = ehMeuNome(brutoD, meuNome) ? nomeAposTitulos(brutoD, true) : nomeAposTitulos(brutoD, false);
      origem = ehMeuNome(brutoO, meuNome) ? nomeAposTitulos(brutoO, true) : nomeAposTitulos(brutoO, true);
    }
  } else {
    // C6: nomes em maiúsculas antes de "Banco:"; "Conta de origem" (ou "Conta de destino") marca a parte do usuário
    const nomes = [];
    const re = /([A-ZÀ-Ú][A-ZÀ-Ú'.\- ]{2,}?)\s+Banco:/g;
    let m;
    while ((m = re.exec(plano))) nomes.push({ i: m.index, n: nomeLimpo(m[1]) });
    const iOrig = plano.search(/Conta de origem/i), iDest = plano.search(/Conta de destino/i);
    if (iOrig >= 0) {
      origem = (nomes.find((x) => x.i > iOrig) || {}).n || "";
      destino = (nomes.filter((x) => x.i < iOrig)[0] || {}).n || "";
    } else if (iDest >= 0) {
      destino = (nomes.find((x) => x.i > iDest) || {}).n || "";
      origem = (nomes.filter((x) => x.i < iDest)[0] || {}).n || "";
    }
  }
  let tipo, contraparte;
  if (origem && ehMeuNome(origem, meuNome)) { tipo = "SAÍDA"; contraparte = destino; }
  else if (destino && ehMeuNome(destino, meuNome)) { tipo = "ENTRADA"; contraparte = origem; }
  else if (/recebid|recebeu/i.test(plano)) { tipo = "ENTRADA"; contraparte = origem || destino; }
  else { tipo = "SAÍDA"; contraparte = destino || origem; }
  // nome que na verdade é um título do comprovante ("CNPJ", "Nome", "Instituição"…): a ordem do texto lido veio diferente do esperado.
  // Em vez de criar um Pendente com nome errado, devolve o texto lido pra eu acertar o leitor.
  if (!contraparte || contraparte.length < 3 || /^(nome|cnpj|cpf|institui[cç][aã]o|origem|destino|tipo|conta|valor|banco|ag[eê]ncia)\b/i.test(contraparte)) {
    return { erro: "não consegui ler o nome de quem pagou/recebeu — me mande um print desta tela", lido: plano.slice(0, 900) };
  }

  const mid = /ID da transa[cç][aã]o:?\s*([A-Za-z0-9]{20,})/i.exec(plano);
  const msgId = mid ? `pix:${mid[1]}` : `pix:${data}:${valor.toFixed(2)}:${semAcento(contraparte)}`;
  return { valor, data, tipo, contraparte, msgId };
}

function novoPendentePix(dados, b) {
  const k = {};
  Object.keys(b || {}).forEach((c) => { k[semAcento(c)] = b[c]; });
  // de quem é o comprovante: o atalho manda o nome ("quem"); sem nome ou sem casar, é da primeira pessoa
  const pessoas = (dados.perfil && dados.perfil.pessoas) || [];
  const pessoa = pessoas.find((p) => semAcento(p.nome) === semAcento(k.quem)) || pessoas[0] || { id: "EU", nome: "" };
  // "meuNome" (opcional) é o nome como aparece no banco; sem ele vale o nome cadastrado em Configurações → Pessoas
  const r = lerComprovantePix(k.texto, String(k.meunome || pessoa.nome || ""));
  if (r.erro) return { erro: r.erro, lido: r.lido };
  // conta do Pix: o atalho pode mandar o nome da conta ("conta"); sem isso vale a conta principal
  const contas = (dados.perfil && dados.perfil.contas) || [];
  const contaTxt = semAcento(k.conta);
  const casada = contas.find((c) => { const n = semAcento(c.nome); return n.length >= 2 && contaTxt.includes(n); });
  const conta = (casada && casada.nome) || (contas[0] && contas[0].nome) || null;
  // sugere a categoria do último lançamento do mesmo tipo com o mesmo nome
  const ultimo = [...(dados.lancamentos || [])].reverse()
    .find((l) => l.tipo === r.tipo && l.categoria && semAcento(l.descricao) === semAcento(r.contraparte));
  return {
    item: {
      id: Date.now(), data: r.data, quem: pessoa.id, valor: r.valor, estabelecimento: r.contraparte, tipo: r.tipo, forma: "PIX", conta,
      origem: "Comprovante Pix", msgId: r.msgId,
      ...(ultimo ? { sugestaoCategoria: ultimo.categoria } : {}),
    },
  };
}

// o texto lido do comprovante pode ter CPF/CNPJ/contas: o histórico do Diagnóstico guarda só um trecho, com os números escondidos
const mascaraTexto = (t) => String(t || "").replace(/\d{5,}/g, "•••").slice(0, 350);

async function salvarTudo(dados) {
  const r = await fetch(`${UPSTASH_URL}/set/${CHAVE_REDIS}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
    },
    body: JSON.stringify(dados),
  });
  if (!r.ok) throw new Error(`falha ao salvar os dados: ${r.status} - ${await corpoErro(r)}`);
}

module.exports = async function handler(req, res) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return res.status(500).json({ erro: "UPSTASH_REDIS_REST_URL ou UPSTASH_REDIS_REST_TOKEN não configurados" });
  }

  const recurso = req.query.recurso || "lancamentos";
  const method = req.method;
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const escreve = method !== "GET";
  let travado = false;

  try {
    if (recurso === "cdi" && method === "GET") {
      const desde = /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || "") ? req.query.desde : "2026-01-01";
      return res.status(200).json(await serieCdi(desde));
    }

    // compra enviada pelo Atalhos do iPhone: senha própria, só serve para criar pendente
    if (recurso === "pendentes" && method === "POST" && (req.headers || {})["x-atalho"] !== undefined) {
      const P = require("./_push");
      if (!atalhoAutorizado(req)) {
        await P.registrarLog({ tipo: "atalho", resultado: "senha",
          detalhe: process.env.ATALHO_CHAVE ? "a senha enviada pelo atalho não confere com ATALHO_CHAVE" : "ATALHO_CHAVE não está configurada na Vercel" });
        return res.status(401).json({ erro: "senha do atalho incorreta ou não configurada" });
      }
      travado = await adquirirLock();
      const dados = await lerTudo();
      // comprovante de Pix: o atalho de Compartilhar manda o texto lido da imagem no campo "texto"
      const ehComprovante = !!body && typeof body === "object" && Object.keys(body).some((c) => semAcento(c) === "texto");
      const r = ehComprovante ? novoPendentePix(dados, body) : novoPendente(dados, body);
      if (r.erro) {
        await P.registrarLog(ehComprovante
          ? { tipo: "atalho", resultado: "comprovante-nao-leu", detalhe: `${r.erro}${r.lido ? ". Texto lido: " + mascaraTexto(r.lido) : ""}` }
          : { tipo: "atalho", resultado: "campos", detalhe: `${r.erro}. Campos recebidos: ${Object.keys(body || {}).join(", ") || "nenhum"}` });
        return res.status(ehComprovante ? 422 : 400).json(r.lido ? { erro: r.erro, lido: r.lido } : { erro: r.erro });
      }
      const pend = Array.isArray(dados.pendentes) ? dados.pendentes : [];
      if (ehComprovante) {
        const rotuloPix = r.item.tipo === "ENTRADA" ? "Pix recebido" : "Pix enviado";
        // o mesmo comprovante compartilhado duas vezes (ou já confirmado) não duplica
        if (pend.some((p) => p.msgId === r.item.msgId) || (dados.lancamentos || []).some((l) => l.msgId === r.item.msgId)) {
          await P.registrarLog({ tipo: "atalho", resultado: "duplicada", detalhe: `${rotuloPix} · ${r.item.estabelecimento} · R$ ${r.item.valor}` });
          return res.status(200).json({ ok: true, duplicado: true });
        }
        dados.pendentes = [...pend, r.item];
        await salvarTudo(dados);
        let pushPix;
        try { pushPix = await P.avisarCompra(r.item); } catch (e) { pushPix = { enviados: 0, falhas: 0, motivo: "erro ao avisar: " + String((e && e.message) || e) }; }
        await P.registrarLog({ tipo: "atalho", resultado: "recebida", detalhe: `${rotuloPix} · ${r.item.estabelecimento} · R$ ${r.item.valor}`, push: pushPix });
        return res.status(200).json({ ok: true, tipo: r.item.tipo, valor: r.item.valor, nome: r.item.estabelecimento });
      }
      // evita duplicar se o atalho disparar duas vezes seguidas
      if (pend.some((p) => p.msgId === r.item.msgId && r.item.id - p.id < 120000)) {
        await P.registrarLog({ tipo: "atalho", resultado: "duplicada", detalhe: `${r.item.estabelecimento} · R$ ${r.item.valor}` });
        return res.status(200).json({ ok: true, duplicado: true });
      }
      dados.pendentes = [...pend, r.item];
      await salvarTudo(dados);
      let push;
      try { push = await P.avisarCompra(r.item); } catch (e) { push = { enviados: 0, falhas: 0, motivo: "erro ao avisar: " + String((e && e.message) || e) }; }  // o aviso nunca atrapalha o lançamento
      await P.registrarLog({ tipo: "atalho", resultado: "recebida", detalhe: `${r.item.estabelecimento} · R$ ${r.item.valor}`, push });
      return res.status(200).json({ ok: true });
    }

    // com Face ID ativo, os dados só saem para quem desbloqueou
    if (!(await liberado(req))) {
      // um POST em "pendentes" sem sessão e sem o cabeçalho x-atalho: provável atalho sem a senha
      if (recurso === "pendentes" && method === "POST") {
        await require("./_push").registrarLog({ tipo: "atalho", resultado: "sem-senha", detalhe: "a compra chegou sem o cabeçalho x-atalho (confira o cabeçalho no atalho do iPhone)" });
      }
      return res.status(401).json({ erro: "bloqueado" });
    }

    if (escreve) travado = await adquirirLock();

    const dados = await lerTudo();

    // painel Configurações → Diagnóstico: só estado e histórico, nunca senhas ou chaves
    if (recurso === "diagnostico" && method === "GET") {
      const P = require("./_push");
      const subs = await P.lerSubs().catch(() => []);
      return res.status(200).json({
        versao: VERSAO,
        servidor: {
          vapidPublica: !!process.env.VAPID_PUBLIC_KEY, vapidPrivada: !!process.env.VAPID_PRIVATE_KEY,
          atalhoConfigurado: !!process.env.ATALHO_CHAVE, codigoInicial: !!process.env.CODIGO_INICIAL,
        },
        pessoas: (dados.perfil && dados.perfil.pessoas) || [],
        pendentes: (dados.pendentes || []).length,
        aparelhos: subs.map((s) => ({ pessoa: s.pessoa, modo: s.modo, servico: (() => { try { return new URL(s.endpoint).host; } catch (e) { return ""; } })() })),
        log: await P.lerLog().catch(() => []),
      });
    }

    if (recurso === "tudo") {
      if (method === "GET") {
        return res.status(200).json({
          lancamentos: dados.lancamentos,
          contasFixas: dados.contasFixas,
          cartoes: dados.cartoes,
          tetos: dados.tetos,
          categoriasExtras: dados.categoriasExtras,
          categoriasConfig: dados.categoriasConfig,
          investimentos: dados.investimentos,
          pendentes: dados.pendentes || [],
          perfil: dados.perfil,
        });
      }
    }

    if (recurso === "lancamentos") {
      if (method === "GET") return res.status(200).json({ itens: dados.lancamentos });

      if (method === "POST") {
        if (!body.data || !body.valor) return res.status(400).json({ erro: "dados incompletos" });
        const item = {
          id: Date.now(),
          data: body.data,
          dataCompra: body.dataCompra || null, // dia real da compra (fatura importada)
          quem: body.quem,
          tipo: ["ENTRADA", "INVESTIMENTO", "TRANSFERÊNCIA"].includes(body.tipo) ? body.tipo : "SAÍDA",
          categoria: body.categoria || "",
          descricao: body.descricao || "",
          forma: body.forma || "",
          cartaoId: body.cartaoId || null,
          conta: body.conta || null,
          // transferência entre contas: sai de `conta` e entra em `contaDestino`
          contaDestino: body.contaDestino || null,
          investimentoId: body.investimentoId || null,
          valor: Number(body.valor),
          status: "PAGO",
        };
        dados.lancamentos.push(item);
        await salvarTudo(dados);
        return res.status(200).json({ item });
      }

      if (method === "PUT") {
        dados.lancamentos = dados.lancamentos.map((i) =>
          i.id === body.id ? { ...i, ...body } : i
        );
        await salvarTudo(dados);
        return res.status(200).json({ ok: true });
      }

      if (method === "DELETE") {
        const id = Number(req.query.id);
        dados.lancamentos = dados.lancamentos.filter((i) => i.id !== id);
        await salvarTudo(dados);
        return res.status(200).json({ ok: true });
      }
    }

    if (recurso === "pendentes") {
      const pend = Array.isArray(dados.pendentes) ? dados.pendentes : [];
      if (method === "GET") return res.status(200).json({ itens: pend });

      // confirmar: vira lançamento (e sai da fila) numa gravação só
      if (method === "PUT") {
        const p = pend.find((x) => x.id === body.id);
        if (!p) return res.status(404).json({ erro: "pendente não encontrado (já confirmado?)" });
        const categoria = String(body.categoria || "").trim();
        if (!categoria) return res.status(400).json({ erro: "escolha a categoria" });
        // o app informa se foi crédito ou débito (o Apple Pay não diz)
        const forma = p.forma === "PIX" ? "PIX" : body.forma === "Débito" || body.forma === "Crédito" ? body.forma : p.forma;
        const cartaoId = body.cartaoId !== undefined ? body.cartaoId : p.cartaoId;
        const nomesContas = ((dados.perfil && dados.perfil.contas) || []).map((c) => c.nome);
        const conta = nomesContas.includes(body.conta) ? body.conta : p.conta || nomesContas[0] || null;
        // crédito: entra na fatura do cartão (data = vencimento; o dia real da compra fica em dataCompra)
        const cartaoDoLanc = forma === "Crédito" ? (dados.cartoes || []).find((x) => x.id === cartaoId) : null;
        const faturaData = cartaoDoLanc ? dataFaturaDaCompra(cartaoDoLanc, p.data) : "";
        const item = {
          id: Date.now(),
          data: faturaData || p.data,
          dataCompra: faturaData ? p.data : null,
          quem: p.quem,
          tipo: p.tipo === "ENTRADA" ? "ENTRADA" : "SAÍDA",
          categoria,
          descricao: String(body.descricao || p.estabelecimento).slice(0, 80),
          forma: p.tipo === "ENTRADA" ? "" : forma,
          cartaoId: forma === "Crédito" ? cartaoId || null : null,
          conta: forma === "Débito" || forma === "PIX" ? conta : null,
          contaDestino: null,
          investimentoId: null,
          origem: p.origem || null,
          msgId: p.msgId || null,
          valor: p.valor,
          status: "PAGO",
        };
        dados.lancamentos.push(item);
        dados.pendentes = pend.filter((x) => x.id !== p.id);
        await salvarTudo(dados);
        return res.status(200).json({ item });
      }

      if (method === "DELETE") {
        const id = Number(req.query.id);
        dados.pendentes = pend.filter((x) => x.id !== id);
        await salvarTudo(dados);
        return res.status(200).json({ ok: true });
      }
    }

    if (recurso === "contasFixas") {
      if (method === "GET") return res.status(200).json({ itens: dados.contasFixas });

      if (method === "POST") {
        if (!body.nome || !body.valor || !body.diaVencimento)
          return res.status(400).json({ erro: "dados incompletos" });
        const item = {
          id: Date.now(),
          nome: body.nome,
          categoria: body.categoria || "Outros",
          valor: Number(body.valor),
          diaVencimento: Number(body.diaVencimento),
          ativo: true,
        };
        dados.contasFixas.push(item);
        await salvarTudo(dados);
        return res.status(200).json({ item });
      }

      if (method === "PUT") {
        dados.contasFixas = dados.contasFixas.map((i) =>
          i.id === body.id ? { ...i, ...body } : i
        );
        await salvarTudo(dados);
        return res.status(200).json({ ok: true });
      }

      if (method === "DELETE") {
        const id = Number(req.query.id);
        dados.contasFixas = dados.contasFixas.filter((i) => i.id !== id);
        await salvarTudo(dados);
        return res.status(200).json({ ok: true });
      }
    }

    // nome, contas bancárias e conclusão da tela de boas-vindas
    if (recurso === "perfil") {
      if (method === "GET") return res.status(200).json(dados.perfil);
      if (method === "PUT") {
        const atual = { ...dados.perfil };
        if (typeof body.nome === "string") atual.nome = body.nome.trim().slice(0, 40);
        // lista de nomes (1 ou 2): o primeiro é "EU", o segundo "P2"; mandar só o primeiro volta ao uso individual
        if (Array.isArray(body.pessoas)) {
          const nomes = body.pessoas.map((p) => String((p && p.nome) || p || "").trim().slice(0, 40)).filter(Boolean).slice(0, 2);
          if (nomes.length) {
            atual.pessoas = nomes.map((nome, i) => ({ id: i === 0 ? "EU" : "P2", nome }));
            atual.nome = nomes[0];
          }
        } else if (typeof body.nome === "string" && Array.isArray(atual.pessoas) && atual.pessoas.length) {
          atual.pessoas = atual.pessoas.map((p, i) => (i === 0 ? { ...p, nome: atual.nome } : p));
        }
        if (Array.isArray(body.contas)) {
          const vistos = new Set();
          atual.contas = body.contas
            .map((c) => ({
              nome: String((c && c.nome) || c || "").trim().slice(0, 30),
              cor: String((c && c.cor) || "").slice(0, 9),
              // ícone: foto pequena (data URL png/jpeg/webp) escolhida em Configurações → Contas bancárias
              icone: (c && typeof c.icone === "string" && c.icone.length <= 30000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(c.icone)) ? c.icone : "",
            }))
            .filter((c) => c.nome && !vistos.has(c.nome.toLowerCase()) && vistos.add(c.nome.toLowerCase()))
            .slice(0, 12);
        }
        if (typeof body.concluido === "boolean") atual.concluido = body.concluido;
        dados.perfil = atual;
        await salvarTudo(dados);
        return res.status(200).json(atual);
      }
    }

    if (recurso === "tetos") {
      if (method === "GET") return res.status(200).json({ tetos: dados.tetos });

      if (method === "PUT") {
        dados.tetos = {
          categorias: { ...dados.tetos.categorias, ...(body.categorias || {}) },
          reservaInicial: body.reservaInicial !== undefined ? body.reservaInicial : dados.tetos.reservaInicial,
          reservaData: body.reservaData !== undefined ? body.reservaData : dados.tetos.reservaData,
          saldosContas: { ...(dados.tetos.saldosContas || {}), ...(body.saldosContas || {}) },
        };
        await salvarTudo(dados);
        return res.status(200).json({ tetos: dados.tetos });
      }
    }

    if (recurso === "cartoes") {
      if (method === "GET") return res.status(200).json({ itens: dados.cartoes });

      if (method === "POST") {
        if (!body.nome) return res.status(400).json({ erro: "dados incompletos" });
        const item = {
          id: Date.now(),
          nome: body.nome,
          quem: body.quem || null,
          forma: body.forma || "Cartão de crédito",
          melhorDiaCompra: body.melhorDiaCompra ? Number(body.melhorDiaCompra) : null,
          diaVencimentoFatura: body.diaVencimentoFatura ? Number(body.diaVencimentoFatura) : null,
          limiteDisponivel: Number(body.limiteDisponivel) || 0,
          faturaPagaEm: null,
          ativo: true,
        };
        dados.cartoes.push(item);
        await salvarTudo(dados);
        return res.status(200).json({ item });
      }

      if (method === "PUT") {
        dados.cartoes = dados.cartoes.map((i) =>
          i.id === body.id ? { ...i, ...body } : i
        );
        // melhor dia / vencimento mudou: compras do Apple Pay no crédito (ainda não conferidas com a fatura
        // importada e em fatura não paga) são realinhadas à fatura certa
        if (body.melhorDiaCompra !== undefined || body.diaVencimentoFatura !== undefined) {
          const c = dados.cartoes.find((x) => x.id === body.id);
          if (c) {
            const pagos = new Set((c.pagamentos || []).map((p) => p.ciclo));
            dados.lancamentos.forEach((l) => {
              if (l.origem !== "Carteira (iPhone)" || l.conferido || l.forma !== "Crédito" || l.cartaoId !== c.id) return;
              if (pagos.has(String(l.data).slice(0, 7))) return;
              const dia = l.dataCompra || l.data;
              const certa = dataFaturaDaCompra(c, dia);
              if (certa && (l.data !== certa || !l.dataCompra)) { if (!l.dataCompra) l.dataCompra = dia; l.data = certa; }
            });
          }
        }
        await salvarTudo(dados);
        return res.status(200).json({ ok: true });
      }

      if (method === "DELETE") {
        const id = Number(req.query.id);
        dados.cartoes = dados.cartoes.filter((i) => i.id !== id);
        await salvarTudo(dados);
        return res.status(200).json({ ok: true });
      }
    }

    if (recurso === "investimentos") {
      if (method === "GET") return res.status(200).json({ itens: dados.investimentos });

      if (method === "POST") {
        if (!body.nome || !body.dataBase || body.saldoBase === undefined)
          return res.status(400).json({ erro: "dados incompletos" });
        const item = {
          id: Date.now(),
          nome: body.nome,
          banco: body.banco || "outro",
          percentualCdi: Number(body.percentualCdi) || 100,
          saldoBase: Number(body.saldoBase) || 0,
          dataBase: body.dataBase,
          aplicado: body.aplicado != null && body.aplicado !== "" ? Number(body.aplicado) : null,
          dataInicio: body.dataInicio || null,
          aplicacoes: Array.isArray(body.aplicacoes) ? body.aplicacoes : [],
          baseEm: Number(body.baseEm) || Date.now(),
          ativo: true,
        };
        dados.investimentos.push(item);
        await salvarTudo(dados);
        return res.status(200).json({ item });
      }

      if (method === "PUT") {
        dados.investimentos = dados.investimentos.map((i) =>
          i.id === body.id ? { ...i, ...body } : i
        );
        await salvarTudo(dados);
        return res.status(200).json({ ok: true });
      }

      if (method === "DELETE") {
        const id = Number(req.query.id);
        dados.investimentos = dados.investimentos.filter((i) => i.id !== id);
        await salvarTudo(dados);
        return res.status(200).json({ ok: true });
      }
    }

    if (recurso === "categoriasConfig") {
      if (method === "GET") return res.status(200).json(dados.categoriasConfig);
      if (method === "PUT") {
        const atual = { ocultas: [], emojis: {}, ...(dados.categoriasConfig || {}) };
        if (Array.isArray(body.ocultas)) atual.ocultas = body.ocultas.map((s) => String(s).slice(0, 40)).slice(0, 300);
        if (body.emojis && typeof body.emojis === "object") {
          const em = {};
          Object.entries(body.emojis).slice(0, 300).forEach(([k, v]) => { if (v) em[String(k).slice(0, 50)] = String(v).slice(0, 16); });
          atual.emojis = em;
        }
        dados.categoriasConfig = atual;
        await salvarTudo(dados);
        return res.status(200).json(atual);
      }
    }

    if (recurso === "categorias") {
      if (method === "GET") return res.status(200).json({ itens: dados.categoriasExtras });

      // cada categoria criada é { nome, grupo }; as antigas eram só o nome (grupo Outros)
      const nomeDe = (c) => (typeof c === "string" ? c : c && c.nome);
      if (method === "POST") {
        const nome = String(body.nome || "").trim().slice(0, 40);
        const grupo = String(body.grupo || "Outros").trim().slice(0, 40);
        if (!nome) return res.status(400).json({ erro: "nome vazio" });
        if (!dados.categoriasExtras.some((c) => nomeDe(c) === nome)) dados.categoriasExtras.push({ nome, grupo });
        await salvarTudo(dados);
        return res.status(200).json({ itens: dados.categoriasExtras });
      }

      if (method === "DELETE") {
        const nome = req.query.nome;
        dados.categoriasExtras = dados.categoriasExtras.filter((c) => nomeDe(c) !== nome);
        await salvarTudo(dados);
        return res.status(200).json({ itens: dados.categoriasExtras });
      }
    }

    return res.status(400).json({ erro: "recurso ou método desconhecido" });
  } catch (e) {
    return res.status(500).json({ erro: String(e && e.message || e) });
  } finally {
    if (travado) await liberarLock();
  }
}
