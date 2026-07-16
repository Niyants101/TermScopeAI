const MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const VERSION = "9.0.0";
const SCORING_VERSION = "7.0";
const MAX_DOCUMENTS = 1;
const MAX_CHARS_PER_DOCUMENT = 20000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};

const MATERIAL_RISK_PATTERN = /\b(?:sell(?:s|ing)?|sale of personal|share(?:s|d|ing)?|disclos(?:e|es|ed|ure)|third part(?:y|ies)|advertis(?:e|ing|er|ers)|track(?:s|ed|ing)?|cookie|device identifier|fingerprint|precise location|geolocation|biometric|facial recognition|sensitive (?:data|information)|retain|retention|delete|deletion|arbitration|class action|jury trial|waiv(?:e|er)|automatic(?:ally)? renew|auto.?renew|subscription|nonrefundable|no refund|charge|license|irrevocable|perpetual|worldwide|sublicensable|content ownership|intellectual property|artificial intelligence|machine learning|train(?:s|ed|ing)? (?:an? )?(?:model|ai)|terminate|termination|suspend|suspension|without notice|change(?:s|d|ing)? (?:these )?(?:terms|policy)|modify(?:ies|ied|ing)? (?:these )?(?:terms|policy)|government request|law enforcement|international transfer|cross.border transfer)\b/i;

const HIGH_RISK_PATTERN = /\b(?:sell(?:s|ing)? (?:your|personal|sensitive)|sale of personal|share(?:s|d|ing)? (?:your )?(?:sensitive|biometric|precise location)|biometric|facial recognition|precise location|forced arbitration|binding arbitration|class action waiver|waive (?:your )?right|jury trial waiver|irrevocable|perpetual|sublicensable|automatic(?:ally)? renew|auto.?renew|nonrefundable|no refunds?|train(?:s|ed|ing)? (?:an? )?(?:ai|model)|artificial intelligence training|terminate (?:your )?account without notice|suspend (?:your )?account without notice|change (?:these )?(?:terms|policy) without notice|modify (?:these )?(?:terms|policy) without notice)\b/i;

const NON_RISK_PATTERN = /\b(?:welcome to|effective date|last updated|please read|review and understand|this policy explains|contact us|table of contents|introduction|about this policy)\b/i;

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

  if (Array.isArray(result.risks)) return result;
  if (result.response && typeof result.response === "object") return result.response;
  if (typeof result.response === "string") return parseJsonText(result.response);

  const choiceContent = result?.choices?.[0]?.message?.content;
  if (choiceContent && typeof choiceContent === "object") return choiceContent;
  if (typeof choiceContent === "string") return parseJsonText(choiceContent);
  if (typeof result === "string") return parseJsonText(result);

  throw new Error("The AI response format was not recognized.");
}

function significantWords(value) {
  const ignored = new Set([
    "the", "and", "that", "this", "with", "from", "your", "you", "for",
    "are", "may", "will", "our", "their", "have", "not", "but", "can",
    "any", "all", "such", "when", "where", "into", "than", "then"
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

  for (const length of [220, 180, 120, 80, 55]) {
    const prefix = quoteLower.slice(0, length);
    if (prefix.length < 35) continue;

    const prefixIndex = sourceLower.indexOf(prefix);
    if (prefixIndex >= 0) {
      const end = Math.min(source.length, prefixIndex + Math.max(length, 480));
      const candidate = source.slice(prefixIndex, end);
      const sentenceEnd = candidate.search(/[.!?](?:\s|$)/);
      return sentenceEnd >= 40
        ? candidate.slice(0, sentenceEnd + 1)
        : candidate.slice(0, 480);
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
    if (score > best.score) best = { score, text: chunk };
  }

  return best.score >= 0.55 ? best.text.slice(0, 700) : "";
}

function materialTextForRisk(risk, quote) {
  return cleanText([
    risk.title,
    risk.shortSummary,
    risk.plainMeaning,
    risk.whyItMatters,
    risk.action,
    quote
  ].join(" "));
}

function isMaterialFinding(risk, quote) {
  const text = materialTextForRisk(risk, quote);
  if (!MATERIAL_RISK_PATTERN.test(text)) return false;

  const onlyGenericNotice = NON_RISK_PATTERN.test(text) && !HIGH_RISK_PATTERN.test(text);
  return !onlyGenericNotice;
}

function calibrateSeverity(risk, quote) {
  const requested = ["high", "medium", "low"].includes(risk.severity)
    ? risk.severity
    : "medium";
  const text = materialTextForRisk(risk, quote);

  if (HIGH_RISK_PATTERN.test(text)) return "high";
  if (MATERIAL_RISK_PATTERN.test(text)) {
    return requested === "low" ? "low" : "medium";
  }

  return "low";
}

function fallbackActionForRisk(risk, quote) {
  const text = cleanText([
    risk.title,
    risk.shortSummary,
    risk.plainMeaning,
    risk.whyItMatters,
    quote
  ].join(" ")).toLowerCase();

  if (/biometric|facial recognition|voiceprint|fingerprint/.test(text)) {
    return "Avoid enabling biometric features unless they are necessary. Use another sign in method when available, and delete stored biometric data through the account or privacy settings if the service allows it.";
  }

  if (/precise location|geolocation|location data/.test(text)) {
    return "Turn off precise location access unless the feature truly needs it. Choose approximate location or a one time browser permission when those options are available.";
  }

  if (/targeted advert|personalized advert|tracking|cookie|analytics/.test(text)) {
    return "Review the privacy and cookie controls, turn off personalized advertising where available, and limit optional tracking permissions in your browser or device settings.";
  }

  if (/sell|sale of personal|share|third part|disclos/.test(text)) {
    return "Use the service's privacy controls to limit sharing where available, opt out of targeted advertising or data sales, and avoid providing optional personal information.";
  }

  if (/retain|retention|delete|deletion/.test(text)) {
    return "Check the account and privacy settings for deletion controls, download anything you need first, and contact support if the policy does not clearly explain when retained data is removed.";
  }

  if (/arbitration|class action|jury trial|dispute/.test(text)) {
    return "Read the dispute section before accepting, look for any opt out deadline, and save a copy of the terms if you decide to opt out.";
  }

  if (/automatic renewal|auto.?renew|subscription|refund|nonrefundable|charge/.test(text)) {
    return "Check the renewal date, cancellation steps, and refund rules before paying. Set a reminder before the next charge so you have time to cancel.";
  }

  if (/license|ownership|content|intellectual property|sublicens/.test(text)) {
    return "Only upload content you are comfortable licensing under these terms, remove sensitive files, and keep your own backup of anything important.";
  }

  if (/artificial intelligence|machine learning|train.*(?:model|ai)/.test(text)) {
    return "Avoid submitting sensitive or proprietary content, check for an AI training opt out, and remove earlier uploads when the service provides that control.";
  }

  if (/terminate|termination|suspend|suspension|account access/.test(text)) {
    return "Keep backups of important content, follow the account rules, and do not rely on this service as the only place where your files or records are stored.";
  }

  return "Review this clause before accepting, check whether the service provides an opt out or related setting, and avoid providing optional information until you are comfortable with the tradeoff.";
}

function normalizeAction(risk, quote) {
  const action = cleanText(risk.action);
  const invalid =
    action.length < 18 ||
    /^(?:high|medium|low|none|n\/?a|not applicable|unknown)$/i.test(action) ||
    /^(?:severity|risk level)\s*:?\s*(?:high|medium|low)$/i.test(action);

  return invalid ? fallbackActionForRisk(risk, quote) : action.slice(0, 520);
}

function calculateRating(risks = []) {
  const counts = risks.reduce(
    (total, risk) => {
      const severity = ["high", "medium", "low"].includes(risk.severity)
        ? risk.severity
        : "medium";
      total[severity] += 1;
      return total;
    },
    { high: 0, medium: 0, low: 0 }
  );

  let penalty = counts.high * 1.9 + counts.medium * 0.8 + counts.low * 0.25;

  if (counts.high > 1) penalty += (counts.high - 1) * 0.6;
  if (counts.high >= 4) penalty += 0.4;
  if (counts.medium >= 4) penalty += 0.35;

  let rating = Math.max(0, Math.min(10, 10 - penalty));

  if (counts.high === 1) rating = Math.min(rating, 7.5);
  if (counts.high === 2) rating = Math.min(rating, 6);
  if (counts.high === 3) rating = Math.min(rating, 4.5);
  if (counts.high >= 4) rating = Math.min(rating, 3.5);

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
    .slice(0, 8)
    .map((risk) => {
      const sourceUrl = safeUrl(risk.sourceUrl);
      const source = docsByUrl.get(sourceUrl) || documents[0];
      if (!source) return null;

      const quote = findVerifiedQuote(source.text, risk.quote);
      if (!quote || !isMaterialFinding(risk, quote)) return null;

      return {
        title: cleanText(risk.title).slice(0, 120) || "Potential concern",
        severity: calibrateSeverity(risk, quote),
        shortSummary: cleanText(risk.shortSummary).slice(0, 260),
        plainMeaning: cleanText(risk.plainMeaning).slice(0, 950),
        whyItMatters: cleanText(risk.whyItMatters).slice(0, 850),
        action: normalizeAction(risk, quote),
        quote,
        sourceUrl: source.url,
        policyType: source.type,
        sourceName: source.sourceName || source.title || source.label
      };
    })
    .filter(Boolean)
    .slice(0, 6)
    .sort((a, b) => {
      const weight = { high: 3, medium: 2, low: 1 };
      return weight[b.severity] - weight[a.severity];
    });

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
    scoringVersion: SCORING_VERSION,
    analysisVersion: "9.0",
    risks: verified
  };
}

async function createCacheKey(documents, preferences) {
  const source = JSON.stringify({
    scoringVersion: SCORING_VERSION,
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
          severity: { type: "string", enum: ["high", "medium", "low"] },
          shortSummary: { type: "string" },
          plainMeaning: { type: "string" },
          whyItMatters: { type: "string" },
          action: { type: "string" },
          quote: { type: "string" },
          sourceUrl: { type: "string" }
        },
        required: [
          "title", "severity", "shortSummary", "plainMeaning",
          "whyItMatters", "action", "quote", "sourceUrl"
        ]
      }
    }
  },
  required: ["title", "overview", "risks"]
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        ok: true,
        service: "TermScopeAI API",
        version: VERSION,
        scoringVersion: SCORING_VERSION
      });
    }

    if (request.method !== "POST" || url.pathname !== "/analyze") {
      return json({ error: "Not found" }, 404);
    }

    try {
      const body = await request.json();
      const documents = normalizeDocuments(body.documents);

      if (!documents.length) {
        return json({ error: "No readable policy document was supplied." }, 400);
      }

      const preferences = body.preferences || {};
      const cache = caches.default;
      const cacheKey = await createCacheKey(documents, preferences);
      const cacheRequest = new Request(
        `${url.origin}/cached-analysis/${cacheKey}`,
        { method: "GET" }
      );
      const cached = await cache.match(cacheRequest);

      if (cached) return cached;

      const document = documents[0];
      const systemPrompt = `You explain one website Terms of Use or Privacy Policy to an ordinary person. Identify only material restrictions, risks, or tradeoffs. Do not treat an effective date, a welcome message, a request to read the policy, a table of contents, or a normal description of the policy as a risk. Do not provide legal advice. Do not invent anything. Every finding must use an exact quote copied from the supplied document and the exact source URL. Focus on data selling or sharing, sensitive data, tracking, location, biometrics, AI training, broad content licenses, automatic renewal, refunds, forced arbitration, class action waivers, account deletion, data retention, suspension, termination, and unilateral policy changes. Use high only when the practical consequence could seriously affect privacy, money, ownership, access, or legal rights. Use medium for meaningful tradeoffs. Use low for limited concerns. Return no more than 6 findings from most serious to least serious. shortSummary must be one clear sentence that states the main issue. plainMeaning must use 2 or 3 concise sentences explaining who may do what, when it applies, and how broad the clause is. whyItMatters must use about 2 concise sentences explaining the realistic effect on the user and the most important possible consequence. action must use 1 or 2 concrete sentences with a practical step the user can take. Never put only a severity word such as High, Medium, or Low in action.`;

      const response = await env.AI.run(MODEL, {
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Reading style: ${cleanText(preferences.readingLevel) || "simple"}.
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
        temperature: 0.05,
        max_tokens: 2300,
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
      console.error("TermScopeAI analysis error", error);
      return json({ error: error?.message || "Analysis failed." }, 500);
    }
  }
};
