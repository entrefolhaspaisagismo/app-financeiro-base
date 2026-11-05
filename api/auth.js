// api/auth.js — Face ID do app (cadastro de celulares, desbloqueio e convites).
// A conferência em si fica em api/_seguranca.js.

const S = require("./_seguranca");

const curto = (v, max) => String(v || "").slice(0, max);

module.exports = async function handler(req, res) {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return res.status(500).json({ erro: "UPSTASH_REDIS_REST_URL ou UPSTASH_REDIS_REST_TOKEN não configurados" });
  }
  const acao = (req.query && req.query.acao) || "estado";
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  try {
    const auth = await S.lerAuth();
    const protegido = !!(auth && auth.credenciais && auth.credenciais.length);
    const sessao = S.sessaoValida(auth, req);
    const { origem, rpId } = S.origemDe(req);

    if (acao === "estado" && req.method === "GET") {
      return res.status(200).json({
        protegido,
        sessaoOk: !!sessao,
        credenciais: protegido ? auth.credenciais.map((c) => c.id) : [],
        // nomes dos celulares só para quem já entrou
        celulares: sessao ? auth.credenciais.map((c) => ({ id: c.id, pessoa: c.pessoa, aparelho: c.aparelho, criadoEm: c.criadoEm })) : undefined,
      });
    }
    if (req.method !== "POST") return res.status(405).json({ erro: "método não permitido" });

    // ---- cadastrar este celular ----
    if (acao === "opcoesRegistro") {
      // o primeiro cadastro só é livre se CODIGO_INICIAL não estiver definido na Vercel; com ele definido,
      // quem abrir o app primeiro precisa saber o código (evita um estranho cadastrar o Face ID antes do dono).
      // Depois do primeiro cadastro, só quem já entrou ou tem código de convite.
      if (!protegido && process.env.CODIGO_INICIAL && String(body.codigo || "") !== process.env.CODIGO_INICIAL) {
        return res.status(403).json({ erro: "código inicial incorreto" });
      }
      if (protegido && !sessao && !(await S.usaConvite(body.codigo))) {
        return res.status(403).json({ erro: "código inválido ou vencido" });
      }
      return res.status(200).json({ desafio: await S.novoDesafio("registro"), usuarioId: S.b64u(require("crypto").randomBytes(16)) });
    }
    if (acao === "registra") {
      if (!(await S.usaDesafio(body.desafio, "registro"))) return res.status(400).json({ erro: "pedido vencido, tente de novo" });
      if (auth && auth.rpId && auth.rpId !== rpId) return res.status(400).json({ erro: "endereço diferente do cadastrado" });
      S.confereCliente(body.clientData, "webauthn.create", body.desafio, origem);
      S.confereAutenticador(body.authData, rpId);
      if (![-7, -257].includes(body.alg)) return res.status(400).json({ erro: "tipo de chave não suportado" });
      require("crypto").createPublicKey({ key: Buffer.from(String(body.chave), "base64"), format: "der", type: "spki" });
      const novo = auth || { segredo: require("crypto").randomBytes(32).toString("hex"), rpId, credenciais: [] };
      novo.rpId = novo.rpId || rpId;
      const id = curto(body.id, 300);
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return res.status(400).json({ erro: "identificação inválida" });
      novo.credenciais = novo.credenciais.filter((c) => c.id !== id);
      novo.credenciais.push({
        id,
        chave: S.b64u(Buffer.from(String(body.chave), "base64")),
        alg: body.alg,
        pessoa: "EU",
        aparelho: curto(body.aparelho, 40) || "Celular",
        criadoEm: new Date().toISOString().slice(0, 10),
      });
      await S.salvarAuth(novo);
      return res.status(200).json({ ok: true, ...S.criaSessao(novo, id, "EU") });
    }

    // ---- desbloquear ----
    if (acao === "opcoesLogin") {
      if (!protegido) return res.status(400).json({ erro: "Face ID não está ativo" });
      return res.status(200).json({ desafio: await S.novoDesafio("login"), credenciais: auth.credenciais.map((c) => c.id), rpId: auth.rpId });
    }
    if (acao === "entra") {
      if (!protegido) return res.status(400).json({ erro: "Face ID não está ativo" });
      if (!(await S.usaDesafio(body.desafio, "login"))) return res.status(400).json({ erro: "pedido vencido, tente de novo" });
      const cred = auth.credenciais.find((c) => c.id === body.id);
      if (!cred) return res.status(401).json({ erro: "este celular não está cadastrado" });
      S.confereCliente(body.clientData, "webauthn.get", body.desafio, origem);
      const ad = S.confereAutenticador(body.authData, auth.rpId);
      S.confereAssinatura(cred, ad, body.clientData, body.assinatura);
      return res.status(200).json({ ok: true, pessoa: cred.pessoa, ...S.criaSessao(auth, cred.id, cred.pessoa) });
    }

    // ---- daqui pra baixo, só quem já entrou ----
    if (!sessao) return res.status(401).json({ erro: "bloqueado" });
    if (acao === "convite") {
      return res.status(200).json({ codigo: await S.novoConvite(), validoMin: 10 });
    }
    if (acao === "remove") {
      auth.credenciais = auth.credenciais.filter((c) => c.id !== body.id);
      if (auth.credenciais.length) await S.salvarAuth(auth); else await S.apagarAuth();
      return res.status(200).json({ ok: true, protegido: auth.credenciais.length > 0 });
    }
    if (acao === "desliga") {
      await S.apagarAuth();
      return res.status(200).json({ ok: true, protegido: false });
    }
    return res.status(400).json({ erro: "ação desconhecida" });
  } catch (e) {
    return res.status(400).json({ erro: String((e && e.message) || e) });
  }
};
