// api/_seguranca.js — Face ID (passkeys / WebAuthn) e sessões.
// O "_" no nome faz a Vercel não publicar este arquivo como rota: ele só é
// usado por api/auth.js e api/gastos.js.
//
// Como funciona:
// - Cada celular cadastra uma passkey (o Face ID do iPhone guarda a chave
//   privada; o servidor só guarda a chave pública).
// - Para desbloquear, o servidor manda um desafio aleatório, o celular assina
//   com o Face ID e o servidor confere a assinatura. Se bater, devolve uma
//   sessão (token) que vale por algumas horas.
// - Depois do primeiro cadastro, os dados só saem com sessão válida. Outro
//   celular só se cadastra com uma sessão válida ou com um código de convite.
//
// Para desligar tudo numa emergência (ex.: perdeu o acesso), apague a chave
// "financeiro-auth" (ou "<APP_PREFIXO>-auth") no painel do Upstash.

const crypto = require("crypto");

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const PREFIXO = process.env.APP_PREFIXO || "financeiro";
const CHAVE_AUTH = `${PREFIXO}-auth`;
const PREFIXO_DESAFIO = `${PREFIXO}-desafio-`;
const PREFIXO_CONVITE = `${PREFIXO}-convite-`;
const CHAVE_TENTATIVAS = `${PREFIXO}-convite-tentativas`;
const SESSAO_MS = 12 * 60 * 60 * 1000;
const DESAFIO_S = 300;
const CONVITE_S = 600;
const TENTATIVAS_MAX = 10;

async function redis(...partes) {
  const caminho = partes.map((p) => encodeURIComponent(String(p))).join("/");
  const r = await fetch(`${UPSTASH_URL}/${caminho}`, { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } });
  if (!r.ok) throw new Error(`falha no banco (${r.status})`);
  return (await r.json()).result;
}

async function lerAuth() {
  const v = await redis("get", CHAVE_AUTH);
  return v ? JSON.parse(v) : null;
}
async function salvarAuth(auth) {
  const r = await fetch(`${UPSTASH_URL}/set/${CHAVE_AUTH}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain", Authorization: `Bearer ${UPSTASH_TOKEN}` },
    body: JSON.stringify(auth),
  });
  if (!r.ok) throw new Error(`falha ao salvar o Face ID (${r.status})`);
}
async function apagarAuth() { await redis("del", CHAVE_AUTH); }

const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64u = (s) => Buffer.from(String(s || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest();
const iguais = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

// endereço que o celular vê (ex.: https://meu-app.vercel.app)
function origemDe(req) {
  const h = req.headers || {};
  const host = String(h["x-forwarded-host"] || h.host || "").split(",")[0].trim();
  const proto = String(h["x-forwarded-proto"] || (/^localhost(:|$)|^127\./.test(host) ? "http" : "https")).split(",")[0].trim();
  return { origem: `${proto}://${host}`, rpId: host.replace(/:\d+$/, "") };
}

// ---------- sessão ----------
function assina(segredo, texto) { return b64u(crypto.createHmac("sha256", segredo).update(texto).digest()); }
function criaSessao(auth, credId, pessoa) {
  const corpo = b64u(JSON.stringify({ exp: Date.now() + SESSAO_MS, c: credId, p: pessoa }));
  return { sessao: `${corpo}.${assina(auth.segredo, corpo)}`, expiraEm: Date.now() + SESSAO_MS };
}
function sessaoValida(auth, req) {
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(String((req.headers || {}).authorization || ""));
  if (!m) return null;
  const [corpo, ass] = m[1].split(".");
  if (!corpo || !ass || !iguais(Buffer.from(ass), Buffer.from(assina(auth.segredo, corpo)))) return null;
  try {
    const s = JSON.parse(deB64u(corpo).toString());
    if (!(s.exp > Date.now())) return null;
    // celular removido em Configurações perde a sessão na hora
    if (!auth.credenciais.some((c) => c.id === s.c)) return null;
    return s;
  } catch (e) { return null; }
}

// Usado pelo api/gastos.js: true quando pode seguir, false quando está trancado.
async function liberado(req) {
  const auth = await lerAuth();
  if (!auth || !auth.credenciais || !auth.credenciais.length) return true;
  return !!sessaoValida(auth, req);
}

// ---------- desafios e convites ----------
async function novoDesafio(tipo) {
  const desafio = b64u(crypto.randomBytes(32));
  await redis("set", PREFIXO_DESAFIO + desafio, tipo, "EX", DESAFIO_S);
  return desafio;
}
async function usaDesafio(desafio, tipo) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(String(desafio || ""))) return false;
  const v = await redis("getdel", PREFIXO_DESAFIO + desafio);
  return v === tipo;
}
async function novoConvite() {
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await redis("set", PREFIXO_CONVITE + codigo, "1", "EX", CONVITE_S);
  return codigo;
}
async function usaConvite(codigo) {
  if (!/^\d{6}$/.test(String(codigo || ""))) return false;
  // trava chutes: no máximo 10 tentativas a cada 10 minutos
  const n = await redis("incr", CHAVE_TENTATIVAS);
  if (n === 1) await redis("expire", CHAVE_TENTATIVAS, CONVITE_S);
  if (n > TENTATIVAS_MAX) return false;
  return (await redis("getdel", PREFIXO_CONVITE + codigo)) === "1";
}

// ---------- conferência do WebAuthn ----------
// clientDataJSON: tipo, desafio e endereço que o navegador assinou
function confereCliente(clientDataB64, tipo, desafio, origem) {
  const cd = JSON.parse(deB64u(clientDataB64).toString());
  if (cd.type !== tipo) throw new Error("resposta de outro tipo");
  if (cd.challenge !== desafio) throw new Error("desafio não confere");
  if (cd.origin !== origem) throw new Error("endereço não confere");
}
// authenticatorData: hash do domínio + flags (presença e Face ID confirmados)
function confereAutenticador(authDataB64, rpId) {
  const ad = deB64u(authDataB64);
  if (ad.length < 37) throw new Error("dados do aparelho incompletos");
  if (!iguais(ad.subarray(0, 32), sha256(Buffer.from(rpId)))) throw new Error("domínio não confere");
  const flags = ad[32];
  if (!(flags & 0x01)) throw new Error("presença não confirmada");
  if (!(flags & 0x04)) throw new Error("Face ID não confirmado");
  return ad;
}
function confereAssinatura(cred, authData, clientDataB64, assinaturaB64) {
  const dados = Buffer.concat([authData, sha256(deB64u(clientDataB64))]);
  const chave = crypto.createPublicKey({ key: deB64u(cred.chave), format: "der", type: "spki" });
  const ok = cred.alg === -257
    ? crypto.verify("sha256", dados, chave, deB64u(assinaturaB64))
    : crypto.verify("sha256", dados, { key: chave, dsaEncoding: "der" }, deB64u(assinaturaB64));
  if (!ok) throw new Error("assinatura inválida");
}

module.exports = {
  CHAVE_AUTH, b64u, origemDe, lerAuth, salvarAuth, apagarAuth, criaSessao, sessaoValida, liberado,
  novoDesafio, usaDesafio, novoConvite, usaConvite, confereCliente, confereAutenticador, confereAssinatura,
};
