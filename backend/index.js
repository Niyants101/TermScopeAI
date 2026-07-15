const MODEL = "@cf/zai-org/glm-4.7-flash";
const MAX_DOCUMENTS = 2;
const MAX_CHARS_PER_DOCUMENT = 45000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeDocuments(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_DOCUMENTS).map((doc) => ({
    title: cleanText(doc.title).slice(0, 200),
    label: cleanText(doc.label).slice(0, 100),
    type: ["terms", "privacy"].includes(doc.type) ? doc.type : "policy",
    url: safeUrl(doc.url),
    text: cleanText(doc.text).slice(0, MAX_CHARS_PER_DOCUMENT)
  })).filter((doc) => doc.url && doc.text.length >= 100);
}

function parseModelJson(result) {
  if (result && typeof result === "object" && Array.isArray(result.risks)) return result;
  const raw = typeof result === "string" ? result : result?.response;
  if (!raw) throw new Error("The AI returned an empty response.");
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

function verifyFindings(output, documents) {
  const docsByUrl = new Map(documents.map((doc) => [doc.url, doc]));
  const risks = Array.isArray(output.risks) ? output.risks : [];
  const verified = risks.slice(0, 8).map((risk) => {
    const sourceUrl = safeUrl(risk.sourceUrl);
    const source = docsByUrl.get(sourceUrl);
    const quote = cleanText(risk.quote).slice(0, 700);
    if (!source || quote.length < 20) return null;

    const sourceNormalized = source.text.toLowerCase();
    const quoteNormalized = quote.toLowerCase();
    const exact = sourceNormalized.includes(quoteNormalized);
    const partial = quoteNormalized.length > 80 && sourceNormalized.includes(quoteNormalized.slice(0, 80));
    if (!exact && !partial) return null;

    const severity = ["high", "medium", "low"].includes(risk.severity) ? risk.severity : "medium";
    return {
      title: cleanText(risk.title).slice(0, 120) || "Potential concern",
      severity,
      explanation: cleanText(risk.explanation).slice(0, 500),
      action: cleanText(risk.action).slice(0, 350),
      quote,
      sourceUrl,
      policyType: source.type
    };
  }).filter(Boolean);

  const calculatedScore = Math.min(100, verified.reduce((total, risk) => {
    return total + (risk.severity === "high" ? 20 : risk.severity === "medium" ? 10 : 4);
  }, 0));

  return {
    title: cleanText(output.title).slice(0, 120) || "Important problems",
    overview: cleanText(output.overview).slice(0, 500) || "These are the clauses most worth knowing before you continue.",
    riskScore: Number.isFinite(output.riskScore) ? Math.max(0, Math.min(100, Math.round(output.riskScore))) : calculatedScore,
    risks: verified
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "TermScope API", version: "0.3.0" });
    }
    if (request.method !== "POST" || url.pathname !== "/analyze") {
      return json({ error: "Not found" }, 404);
    }

    try {
      const body = await request.json();
      const documents = normalizeDocuments(body.documents);
      if (!documents.length) return json({ error: "No readable policy documents were supplied." }, 400);

      const preferences = body.preferences || {};
      const promptDocuments = documents.map((doc, index) =>
        `DOCUMENT ${index + 1}\nTYPE: ${doc.type}\nURL: ${doc.url}\nTITLE: ${doc.title || doc.label}\nTEXT:\n${doc.text}`
      ).join("\n\n");

      const systemPrompt = `You analyze website Terms of Use and Privacy Policies for ordinary users. Identify only material problems or restrictions. Do not provide legal advice. Do not invent anything. Every finding must include an exact quote copied from the supplied document and the exact sourceUrl. Focus on data sharing, tracking, location, AI training, content licenses, automatic renewal, refunds, forced arbitration, class action waivers, account deletion, data retention, termination, and unilateral policy changes. Explain each issue in simple language and give one practical action. Return at most 8 findings, ordered from most serious to least serious.`;

      const response = await env.AI.run(MODEL, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Reading style: ${cleanText(preferences.readingLevel) || "simple"}. Priority categories: ${Array.isArray(preferences.priorities) ? preferences.priorities.join(", ") : "all"}.\n\n${promptDocuments}` }
        ],
        temperature: 0.1,
        max_tokens: 2200,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "termscope_analysis",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                overview: { type: "string" },
                riskScore: { type: "integer", minimum: 0, maximum: 100 },
                risks: {
                  type: "array",
                  maxItems: 8,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      title: { type: "string" },
                      severity: { type: "string", enum: ["high", "medium", "low"] },
                      explanation: { type: "string" },
                      action: { type: "string" },
                      quote: { type: "string" },
                      sourceUrl: { type: "string" }
                    },
                    required: ["title", "severity", "explanation", "action", "quote", "sourceUrl"]
                  }
                }
              },
              required: ["title", "overview", "riskScore", "risks"]
            }
          }
        }
      });

      const parsed = parseModelJson(response);
      return json(verifyFindings(parsed, documents));
    } catch (error) {
      console.error(error);
      return json({ error: error?.message || "Analysis failed." }, 500);
    }
  }
};
