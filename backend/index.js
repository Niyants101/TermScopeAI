const MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const MAX_DOCUMENTS = 1;
const MAX_CHARS_PER_DOCUMENT = 16000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      ...extraHeaders
    }
  });
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function normalizeDocuments(input) {
  if (!Array.isArray(input)) return [];

  return input
    .slice(0, MAX_DOCUMENTS)
    .map((doc) => ({
      title: cleanText(doc.title).slice(0, 200),
      label: cleanText(doc.label).slice(0, 100),
      sourceName: cleanText(doc.sourceName).slice(0, 100),
      type: ["terms", "privacy"].includes(doc.type) ? doc.type : "policy",
      url: safeUrl(doc.url),
      text: cleanText(doc.text).slice(0, MAX_CHARS_PER_DOCUMENT)
    }))
    .filter((doc) => doc.url && doc.text.length >= 100);
}

function parseJsonText(raw) {
  const cleaned = String(raw || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  if (!cleaned) {
    throw new Error("The AI returned an empty response.");
  }

  return JSON.parse(cleaned);
}

function parseModelJson(result) {
  if (!result) {
    throw new Error("The AI returned an empty response.");
  }

  if (Array.isArray(result.risks)) {
    return result;
  }

  if (result.response && typeof result.response === "object") {
    return result.response;
  }

  if (typeof result.response === "string") {
    return parseJsonText(result.response);
  }

  const choiceContent = result?.choices?.[0]?.message?.content;

  if (choiceContent && typeof choiceContent === "object") {
    return choiceContent;
  }

  if (typeof choiceContent === "string") {
    return parseJsonText(choiceContent);
  }

  if (typeof result === "string") {
    return parseJsonText(result);
  }

  throw new Error("The AI response format was not recognized.");
}

function significantWords(value) {
  const ignored = new Set([
    "the",
    "and",
    "that",
    "this",
    "with",
    "from",
    "your",
    "you",
    "for",
    "are",
    "may",
    "will",
    "our",
    "their",
    "have",
    "not",
    "but",
    "can",
    "any",
    "all",
    "such",
    "when",
    "where"
  ]);

  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !ignored.has(word));
}

function findVerifiedQuote(sourceText, proposedQuote) {
  const source = cleanText(sourceText);
  const quote = cleanText(proposedQuote).slice(0, 700);

  if (quote.length < 20) return "";

  const sourceLower = source.toLowerCase();
  const quoteLower = quote.toLowerCase();
  const exactIndex = sourceLower.indexOf(quoteLower);

  if (exactIndex >= 0) {
    return source.slice(exactIndex, exactIndex + quote.length);
  }

  for (const length of [180, 120, 80, 55]) {
    const prefix = quoteLower.slice(0, length);
    if (prefix.length < 35) continue;

    const prefixIndex = sourceLower.indexOf(prefix);
    if (prefixIndex >= 0) {
      const end = Math.min(source.length, prefixIndex + Math.max(length, 420));
      const candidate = source.slice(prefixIndex, end);
      const sentenceEnd = candidate.search(/[.!?](?:\s|$)/);
      return sentenceEnd >= 40
        ? candidate.slice(0, sentenceEnd + 1)
        : candidate.slice(0, 420);
    }
  }

  const proposedWords = new Set(significantWords(quote));
  if (proposedWords.size < 4) return "";

  const chunks = source
    .split(/(?<=[.!?;])\s+(?=[A-Z0-9])/)
    .map((part) => cleanText(part))
    .filter((part) => part.length >= 35 && part.length <= 900);

  let best = { score: 0, text: "" };

  for (const chunk of chunks) {
    const chunkWords = new Set(significantWords(chunk));
    let overlap = 0;

    for (const word of proposedWords) {
      if (chunkWords.has(word)) overlap += 1;
    }

    const score = overlap / Math.max(1, proposedWords.size);
    if (score > best.score) {
      best = { score, text: chunk };
    }
  }

  return best.score >= 0.58 ? best.text.slice(0, 700) : "";
}

function calculateRating(risks) {
  const penalty = risks.reduce((total, risk) => {
    if (risk.severity === "high") return total + 2.25;
    if (risk.severity === "medium") return total + 1;
    return total + 0.35;
  }, 0);

  const rating = Math.max(0, Math.min(10, 10 - penalty));
  return Math.round(rating * 10) / 10;
}

function ratingLabel(rating) {
  if (rating >= 8) return "Strong";
  if (rating >= 5) return "Mixed";
  return "Concerning";
}

function verifyFindings(output, documents) {
  const docsByUrl = new Map(documents.map((doc) => [doc.url, doc]));
  const risks = Array.isArray(output.risks) ? output.risks : [];

  const verified = risks
    .slice(0, 6)
    .map((risk) => {
      const sourceUrl = safeUrl(risk.sourceUrl);
      const source = docsByUrl.get(sourceUrl) || documents[0];
      if (!source) return null;

      const quote = findVerifiedQuote(source.text, risk.quote);
      if (!quote) return null;

      const severity = ["high", "medium", "low"].includes(risk.severity)
        ? risk.severity
        : "medium";

      return {
        title: cleanText(risk.title).slice(0, 120) || "Potential concern",
        severity,
        shortSummary: cleanText(risk.shortSummary).slice(0, 240),
        plainMeaning: cleanText(risk.plainMeaning).slice(0, 650),
        whyItMatters: cleanText(risk.whyItMatters).slice(0, 550),
        action: cleanText(risk.action).slice(0, 350),
        quote,
        sourceUrl: source.url,
        policyType: source.type,
        sourceName: source.sourceName || source.title || source.label
      };
    })
    .filter(Boolean);

  const policyRating = calculateRating(verified);

  return {
    title:
      cleanText(output.title).slice(0, 120) ||
      `${documents[0]?.sourceName || "Website"} policy review`,
    overview:
      cleanText(output.overview).slice(0, 520) ||
      "These are the clauses most worth understanding before you continue.",
    policyRating,
    ratingLabel: ratingLabel(policyRating),
    risks: verified
  };
}

async function createCacheKey(documents, preferences) {
  const source = JSON.stringify({
    documents: documents.map((doc) => ({
      url: doc.url,
      text: doc.text,
      type: doc.type
    })),
    readingLevel: preferences.readingLevel || "simple",
    priorities: Array.isArray(preferences.priorities)
      ? preferences.priorities
      : []
  });

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source)
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    overview: { type: "string" },
    risks: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          severity: {
            type: "string",
            enum: ["high", "medium", "low"]
          },
          shortSummary: { type: "string" },
          plainMeaning: { type: "string" },
          whyItMatters: { type: "string" },
          action: { type: "string" },
          quote: { type: "string" },
          sourceUrl: { type: "string" }
        },
        required: [
          "title",
          "severity",
          "shortSummary",
          "plainMeaning",
          "whyItMatters",
          "action",
          "quote",
          "sourceUrl"
        ]
      }
    }
  },
  required: ["title", "overview", "risks"]
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        ok: true,
        service: "TermScope API",
        version: "5.0.0"
      });
    }

    if (request.method !== "POST" || url.pathname !== "/analyze") {
      return json({ error: "Not found" }, 404);
    }

    try {
      const body = await request.json();
      const documents = normalizeDocuments(body.documents);

      if (!documents.length) {
        return json(
          { error: "No readable policy document was supplied." },
          400
        );
      }

      const preferences = body.preferences || {};
      const cache = caches.default;
      const cacheKey = await createCacheKey(documents, preferences);
      const cacheRequest = new Request(
        `${url.origin}/cached-analysis/${cacheKey}`,
        { method: "GET" }
      );
      const cached = await cache.match(cacheRequest);

      if (cached) {
        return cached;
      }

      const document = documents[0];
      const systemPrompt = `You explain one website Terms of Use or Privacy Policy to an ordinary person. Identify only material problems, restrictions, or tradeoffs. Do not provide legal advice. Do not invent anything. Every finding must use an exact quote copied from the supplied document and the exact source URL. Use clear language. Focus on data sharing, tracking, location, AI training, content licenses, automatic renewal, refunds, forced arbitration, class action waivers, account deletion, data retention, termination, and unilateral policy changes. Return no more than 6 findings from most serious to least serious. shortSummary must be one short sentence. plainMeaning must explain the clause in simple language. whyItMatters must explain the practical consequence. action must give one realistic step the user can take.`;

      const response = await env.AI.run(MODEL, {
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: `Reading style: ${
              cleanText(preferences.readingLevel) || "simple"
            }.
Priority categories: ${
              Array.isArray(preferences.priorities)
                ? preferences.priorities.join(", ")
                : "all"
            }.

DOCUMENT TYPE: ${document.type}
SOURCE NAME: ${document.sourceName || document.title || document.label}
URL: ${document.url}
TITLE: ${document.title || document.label}
TEXT:
${document.text}`
          }
        ],
        temperature: 0.1,
        max_tokens: 1500,
        response_format: {
          type: "json_schema",
          json_schema: RESPONSE_SCHEMA
        }
      });

      const parsed = parseModelJson(response);
      const result = verifyFindings(parsed, documents);
      const finalResponse = json(result, 200, {
        "Cache-Control": "public, max-age=86400"
      });

      await cache.put(cacheRequest, finalResponse.clone());
      return finalResponse;
    } catch (error) {
      console.error("TermScope analysis error", error);
      return json(
        { error: error?.message || "Analysis failed." },
        500
      );
    }
  }
};
