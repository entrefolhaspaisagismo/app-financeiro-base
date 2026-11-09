// api/_push.js — avisos no celular (Web Push). O "_" no nome faz a Vercel não publicar este arquivo como rota.
//
// Variáveis de ambiente (painel da Vercel):
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  — chaves de envio dos avisos
//   VAPID_SUBJECT (opcional)              — contato (mailto: ou https://), por padrão o endereço do app
//
// Cada aparelho guarda no Redis: endpoint + chaves da inscrição, o modo escolhido
// nas configurações do app: "diario" (lembrete do dia, 20h), "cada" (a cada compra) ou "ambos".

const webpush = require("web-push");

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const PREFIXO = process.env.APP_PREFIXO || "financeiro";
const CHAVE_SUBS = `${PREFIXO}-push`;
const CHAVE_DADOS = `${PREFIXO}-dados`;
// endereço do app: SITE_URL (se definido) ou o domínio de produção que a própria Vercel informa
const SITE = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://exemplo.vercel.app");
const MODOS = ["diario", "cada", "ambos"];
const CHAVE_LOG = `${PREFIXO}-log`;

function pronto() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || SITE, pub, priv);
  return true;
}

async function lerChave(chave) {
  const r = await fetch(`${UPSTASH_URL}/get/${chave}`, { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } });
  if (!r.ok) throw new Error(`falha ao ler (${r.status})`);
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : null;
}
async function gravarChave(chave, valor) {
  const r = await fetch(`${UPSTASH_URL}/set/${chave}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain", Authorization: `Bearer ${UPSTASH_TOKEN}` },
    body: JSON.stringify(valor),
  });
  if (!r.ok) throw new Error(`falha ao salvar (${r.status})`);
}
async function lerSubs() { const v = await lerChave(CHAVE_SUBS); return Array.isArray(v) ? v : []; }
async function salvarSubs(subs) { await gravarChave(CHAVE_SUBS, subs); }

// histórico curto do que aconteceu (últimos 30 eventos), para a tela Configurações → Diagnóstico.
// Nunca guarda senhas nem chaves; o log nunca atrapalha o fluxo principal.
async function registrarLog(ev) {
  try {
    const atual = await lerChave(CHAVE_LOG);
    const lista = Array.isArray(atual) ? atual : [];
    lista.unshift({ t: new Date().toISOString(), ...ev });
    await gravarChave(CHAVE_LOG, lista.slice(0, 30));
  } catch (e) { /* ignora */ }
}
async function lerLog() { const v = await lerChave(CHAVE_LOG); return Array.isArray(v) ? v : []; }

const hojeBR = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const urlPendentes = () => "/#pendentes";

async function enviar(sub, payload) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), { TTL: 86400 });
    return { ok: true };
  } catch (e) {
    return { ok: false, gone: e && (e.statusCode === 404 || e.statusCode === 410), erro: String((e && e.message) || e) };
  }
}

// uma compra nova chegou do Apple Pay: avisa os aparelhos da pessoa no modo "a cada compra" (ou "ambos")
// Devolve { enviados, falhas, motivo } para o diagnóstico.
async function avisarCompra(item) {
  if (!pronto()) return { enviados: 0, falhas: 0, motivo: "as chaves VAPID não estão configuradas na Vercel" };
  const subs = await lerSubs();
  const daPessoa = subs.filter((s) => s.pessoa === item.quem);
  const alvos = daPessoa.filter((s) => s.modo === "cada" || s.modo === "ambos");
  if (!alvos.length) {
    const motivo = !subs.length ? "nenhum aparelho com avisos ativados"
      : !daPessoa.length ? `nenhum aparelho ativado para esta pessoa (${item.quem})`
      : 'os aparelhos desta pessoa estão no modo "Lembrete do dia" (troque para "A cada compra" ou "Os dois")';
    return { enviados: 0, falhas: 0, motivo };
  }
  const pix = item.forma === "PIX";
  const payload = pix
    ? { titulo: item.tipo === "ENTRADA" ? "Pix recebido" : "Pix enviado",
        corpo: `R$ ${brl(item.valor)} ${item.tipo === "ENTRADA" ? "de" : "para"} ${item.estabelecimento || "—"} — toque para confirmar`,
        url: urlPendentes(), tag: "pix" }
    : { titulo: "Nova compra no cartão", corpo: `R$ ${brl(item.valor)} em ${item.estabelecimento || "compra"} — toque para confirmar`,
        url: urlPendentes(), tag: "compra" };
  const resultados = await Promise.all(alvos.map((s) => enviar(s, payload)));
  const mortos = new Set(alvos.filter((_, i) => resultados[i].gone).map((s) => s.endpoint));
  if (mortos.size) await salvarSubs(subs.filter((s) => !mortos.has(s.endpoint)));
  const falhas = resultados.filter((r) => !r.ok);
  return { enviados: resultados.length - falhas.length, falhas: falhas.length, motivo: falhas.length ? falhas[0].erro : "" };
}

// lembrete do dia: uma vez por dia por aparelho, só se a pessoa tiver pendentes (chamado pelo agendamento da Vercel)
async function lembreteDiario() {
  if (!pronto()) return { enviados: 0, motivo: "chaves não configuradas" };
  const dados = (await lerChave(CHAVE_DADOS)) || {};
  const pend = Array.isArray(dados.pendentes) ? dados.pendentes : [];
  const hoje = hojeBR();
  const subs = await lerSubs();
  const alvos = subs.filter((s) => (s.modo === "diario" || s.modo === "ambos") && s.ultimoLembrete !== hoje
    && pend.some((p) => p.quem === s.pessoa));
  const payloadDe = (s) => {
    const n = pend.filter((p) => p.quem === s.pessoa).length;
    return { titulo: "Lançamentos pendentes", corpo: n === 1 ? "Você tem 1 compra para confirmar" : `Você tem ${n} compras para confirmar`,
      url: urlPendentes(), tag: "lembrete" };
  };
  const resultados = await Promise.all(alvos.map((s) => enviar(s, payloadDe(s))));
  let enviados = 0;
  const mortos = new Set();
  alvos.forEach((s, i) => { if (resultados[i].ok) { s.ultimoLembrete = hoje; enviados++; } else if (resultados[i].gone) mortos.add(s.endpoint); });
  if (alvos.length) await salvarSubs(subs.filter((s) => !mortos.has(s.endpoint)));
  return { enviados };
}

module.exports = { MODOS, pronto, lerSubs, salvarSubs, enviar, avisarCompra, lembreteDiario, urlPendentes, registrarLog, lerLog };
