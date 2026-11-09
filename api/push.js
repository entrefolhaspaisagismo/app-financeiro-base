// api/push.js — avisos no celular: inscrever/remover/testar um aparelho e o lembrete do dia.
//
//   GET  ?acao=chave      → chave pública para o celular se inscrever (sem sessão)
//   GET  ?acao=lembrete   → lembrete do dia (agendamento da Vercel, vercel.json); envia no máximo 1x por dia por aparelho
//   POST ?acao=inscrever  → { subscription, modo, pessoa }   (precisa da sessão do Face ID, quando ativo)
//   POST ?acao=remover    → { endpoint }
//   POST ?acao=testar     → { endpoint }

const P = require("./_push");
const { liberado } = require("./_seguranca");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) || !(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)) return res.status(500).json({ erro: "Redis não configurado" });
  const acao = (req.query && req.query.acao) || "";

  try {
    if (req.method === "GET" && acao === "chave") return res.status(200).json({ chave: process.env.VAPID_PUBLIC_KEY || "" });
    if (req.method === "GET" && acao === "lembrete") {
      const r = await P.lembreteDiario();
      await P.registrarLog({ tipo: "lembrete", resultado: "lembrete", push: { enviados: r.enviados || 0, falhas: 0, motivo: r.motivo || "" } });
      return res.status(200).json(r);
    }

    if (!(await liberado(req))) return res.status(401).json({ erro: "bloqueado" });
    if (req.method !== "POST") return res.status(405).json({ erro: "método não permitido" });
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    if (!P.pronto()) return res.status(500).json({ erro: "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY não configuradas na Vercel" });

    const subs = await P.lerSubs();
    if (acao === "inscrever") {
      const s = body.subscription || {};
      const modo = String(body.modo || "");
      const pessoa = /^[A-Za-z0-9_-]{1,20}$/.test(String(body.pessoa || "")) ? String(body.pessoa) : "EU";
      if (!P.MODOS.includes(modo)) return res.status(400).json({ erro: "modo inválido" });
      if (!/^https:\/\//.test(String(s.endpoint || "")) || !s.keys || !s.keys.p256dh || !s.keys.auth) return res.status(400).json({ erro: "inscrição inválida" });
      const outras = subs.filter((x) => x.endpoint !== s.endpoint);
      const antiga = subs.find((x) => x.endpoint === s.endpoint);
      outras.push({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, modo, pessoa, ultimoLembrete: (antiga && antiga.ultimoLembrete) || "" });
      await P.salvarSubs(outras.slice(-20));
      return res.status(200).json({ ok: true });
    }
    if (acao === "remover") {
      await P.salvarSubs(subs.filter((x) => x.endpoint !== body.endpoint));
      return res.status(200).json({ ok: true });
    }
    if (acao === "testar") {
      const s = subs.find((x) => x.endpoint === body.endpoint);
      if (!s) return res.status(404).json({ erro: "aparelho não está inscrito" });
      const r = await P.enviar(s, { titulo: "Controle Financeiro", corpo: "Aviso de teste — está tudo certo!", url: P.urlPendentes(), tag: "teste" });
      await P.registrarLog({ tipo: "teste", resultado: "teste", push: { enviados: r.ok ? 1 : 0, falhas: r.ok ? 0 : 1, motivo: r.ok ? "" : r.erro } });
      return res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true } : { erro: r.erro });
    }
    return res.status(400).json({ erro: "ação desconhecida" });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
};
