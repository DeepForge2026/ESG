// _worker.js — Advanced Mode do Cloudflare Pages
// Um único arquivo na raiz que o Cloudflare SEMPRE reconhece como backend.
// Ele intercepta /api/analise e /api/relatorio; qualquer outra rota serve o site estático.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Pré-flight CORS
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { headers: cors });
    }

    // Rota: análise ESG
    if (url.pathname === "/api/analise" && request.method === "POST") {
      return handleAnalise(request, env, cors);
    }

    // Rota: relatório
    if (url.pathname === "/api/relatorio" && request.method === "POST") {
      return handleRelatorio(request, env, cors);
    }

    // Qualquer outra coisa: serve os arquivos estáticos (index.html etc.)
    return env.ASSETS.fetch(request);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...(cors || {}) },
  });
}

// ─── ANÁLISE ESG ─────────────────────────────────────────────────────────────
async function handleAnalise(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "Chave da API não configurada no servidor." }, 500, cors);

  let d;
  try { d = await request.json(); }
  catch { return json({ error: "Corpo inválido." }, 400, cors); }

  const prompt = `Você é um analista sênior de ESG especializado em PMEs industriais brasileiras. Analise os dados e gere um diagnóstico ESG completo.

DADOS DA EMPRESA:
Nome: ${d.nome} | Setor: ${d.setorLivre || d.setor} | Cidade: ${d.cidade}
Funcionários: ${d.func} | Faturamento: ${d.fat} | Produto: ${d.produto}
Energia elétrica: ${d.energia} kWh/mês
Combustível: ${d.comb} — ${d.combVol} L/mês | Geração própria: ${d.solar} | Capta água: ${d.captaAgua}
CLT: ${d.clt}% | Treinamentos/ano: ${d.trein} | Acidentes: ${d.acid}
LGPD: ${d.lgpd} | Certificações: ${d.cert} | Licença ambiental: ${d.licenca} | Exporta: ${d.export}
Resíduos: ${JSON.stringify(d.residuos)}
Contexto: ${d.contexto || "Nenhum"}

Use a ferramenta gerar_analise_esg para retornar a análise. No plano de ação, o campo "retorno" deve trazer o benefício econômico/de negócio (ex: "Destrava contrato com cliente exigente", "Economia de ~R$ X/ano", "Evita multa de até R$ Y").`;

  const tool = {
    name: "gerar_analise_esg",
    description: "Retorna a análise ESG estruturada da empresa.",
    input_schema: {
      type: "object",
      properties: {
        scoreTotal: { type: "integer" }, scoreE: { type: "integer" }, scoreS: { type: "integer" }, scoreG: { type: "integer" },
        co2Total: { type: "number" }, co2Escopo1: { type: "number" }, co2Escopo2: { type: "number" }, meta2030: { type: "number" },
        alertas: { type: "array", items: { type: "object", properties: { tipo: { type: "string", enum: ["critico", "gap", "atencao", "oportunidade"] }, texto: { type: "string" } }, required: ["tipo", "texto"] } },
        residuosClassificados: { type: "array", items: { type: "object", properties: { tipo: { type: "string" }, volume: { type: "string" }, classe: { type: "string", enum: ["Classe I", "Classe II-A", "Classe II-B", "Classe III"] }, mtr: { type: "boolean" }, status: { type: "string", enum: ["ok", "atencao", "gap", "critico"] }, risco: { type: "string" } }, required: ["tipo", "classe", "mtr", "status"] } },
        acoes: { type: "array", items: { type: "object", properties: { prioridade: { type: "string", enum: ["Crítica", "Alta", "Média"] }, acao: { type: "string" }, prazo: { type: "string" }, impacto: { type: "string" }, custo: { type: "string" }, retorno: { type: "string" } }, required: ["prioridade", "acao", "prazo", "impacto", "custo"] } },
        insightCarbono: { type: "string" }
      },
      required: ["scoreTotal", "scoreE", "scoreS", "scoreG", "co2Total", "co2Escopo1", "co2Escopo2", "alertas", "residuosClassificados", "acoes", "insightCarbono"]
    }
  };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 3000, tools: [tool], tool_choice: { type: "tool", name: "gerar_analise_esg" }, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) { const t = await res.text(); return json({ error: "API Anthropic " + res.status, detalhe: t.slice(0, 300) }, 502, cors); }
    const data = await res.json();
    const block = (data.content || []).find(b => b.type === "tool_use");
    if (!block) return json({ error: "Resposta sem análise estruturada." }, 502, cors);
    return json(block.input, 200, cors);
  } catch (e) {
    return json({ error: "Falha ao chamar a IA.", detalhe: String(e).slice(0, 200) }, 500, cors);
  }
}

// ─── RELATÓRIO ───────────────────────────────────────────────────────────────
async function handleRelatorio(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "Chave da API não configurada no servidor." }, 500, cors);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Corpo inválido." }, 400, cors); }

  const { d, a, tipo, ctx } = body;
  let sys, user;

  if (tipo === "cliente") {
    sys = `Você é um analista ESG. Redija uma DECLARAÇÃO DE CONFORMIDADE ESG que a empresa possa apresentar ao cliente/comprador que exige comprovação ESG dela. Tom institucional, positivo mas honesto. Destaque pontos fortes, compromisso com melhoria contínua e ações em andamento. Português brasileiro, máximo 450 palavras, parágrafos corridos, sem markdown. Não invente certificações que a empresa não tem.`;
    user = `Empresa: ${d.nome} | ${d.setorLivre || d.setor} | ${d.cidade}
Score ESG: ${a.scoreTotal}/100 (Ambiental:${a.scoreE}, Social:${a.scoreS}, Governança:${a.scoreG})
Percentil no setor: ${ctx.percentil}º | Conformidade legal: ${ctx.conformidadePct}%
Pontos fortes: ${(a.alertas || []).filter(x => x.tipo === "oportunidade").map(x => x.texto).join("; ") || "gestão em evolução"}
Ações em andamento: ${(a.acoes || []).slice(0, 3).map(x => x.acao).join("; ")}
Contexto: ${d.contexto || "Fornecedor comprometido com ESG"}`;
  } else {
    sys = `Você é um analista sênior de ESG especializado em PMEs industriais brasileiras. Redija um relatório executivo profissional em português brasileiro. Estrutura: Sumário Executivo, Análise por Pilar (E, S, G), Riscos e Oportunidades, Próximos Passos. Máximo 600 palavras. Cite legislação brasileira relevante (PNRS, INEA, LGPD, NBR 10.004). Sem markdown — parágrafos corridos.`;
    user = `Empresa: ${d.nome} | Setor: ${d.setorLivre || d.setor} | ${d.func} funcionários | Faturamento: ${d.fat}
Score ESG: ${a.scoreTotal}/100 (E:${a.scoreE}, S:${a.scoreS}, G:${a.scoreG}) | Percentil setor: ${ctx.percentil}º
Conformidade legal: ${ctx.conformidadePct}%
CO₂: ${a.co2Total} tCO₂e/ano (Escopo 1: ${a.co2Escopo1}, Escopo 2: ${a.co2Escopo2})
Resíduos: ${(a.residuosClassificados || []).map(r => `${r.tipo}(${r.status})`).join(", ")}
Ações: ${(a.acoes || []).map(ac => `[${ac.prioridade}] ${ac.acao}`).join(" | ")}
Contexto: ${d.contexto || "Não informado"}`;
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1500, system: sys, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) return json({ error: "API Anthropic " + res.status }, 502, cors);
    const data = await res.json();
    const texto = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n") || "Não foi possível gerar.";
    return json({ texto }, 200, cors);
  } catch (e) {
    return json({ error: "Falha ao gerar relatório.", detalhe: String(e).slice(0, 200) }, 500, cors);
  }
}
