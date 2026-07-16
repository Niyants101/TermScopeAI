const MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const MAX_DOCUMENTS = 6;
const MAX_CHARS_PER_DOCUMENT = 18000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, ...extraHeaders }
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
      type: ["terms", "privacy"].includes(doc.type)
        ? doc.type
        : "policy",
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

  if (
    result.response &&
    typeof result.response === "object"
  ) {
    return result.response;
  }

  if (typeof result.response === "string") {
    return parseJsonText(result.response);
  }

  const choiceContent =
    result?.choices?.[0]?.message?.content;

  if (
    choiceContent &&
    typeof choiceContent === "object"
  ) {
    return choiceContent;
  }

  if (typeof choiceContent === "string") {
    return parseJsonText(choiceContent);
  }

  if (typeof result === "string") {
    return parseJsonText(result);
  }

  throw new Error(
    "The AI response format was not recognized."
  );
}

function verifyFindings(output, documents) {
  const docsByUrl = new Map(
    documents.map((doc) => [doc.url, doc])
  );

  const risks = Array.isArray(output.risks)
    ? output.risks
    : [];

  const verified = risks
    .slice(0, 6)
    .map((risk) => {
      const sourceUrl = safeUrl(risk.sourceUrl);
      const source = docsByUrl.get(sourceUrl);
      const quote = cleanText(risk.quote).slice(0, 550);

      if (!source || quote.length < 20) {
        return null;
      }

      const sourceNormalized =
        source.text.toLowerCase();

      const quoteNormalized =
        quote.toLowerCase();

      const exact =
        sourceNormalized.includes(quoteNormalized);

      const partial =
        quoteNormalized.length > 80 &&
        sourceNormalized.includes(
          quoteNormalized.slice(0, 80)
        );

      if (!exact && !partial) {
        return null;
      }

      const severity = [
        "high",
        "medium",
        "low"
      ].includes(risk.severity)
        ? risk.severity
        : "medium";

      return {
        title:
          cleanText(risk.title).slice(0, 120) ||
          "Potential concern",

        severity,

        explanation:
          cleanText(risk.explanation).slice(0, 420),

        action:
          cleanText(risk.action).slice(0, 280),

        quote,
        sourceUrl,
        policyType: source.type
      };
    })
    .filter(Boolean);

  const calculatedScore = Math.min(
    100,
    verified.reduce((total, risk) => {
      if (risk.severity === "high") {
        return total + 20;
      }

      if (risk.severity === "medium") {
        return total + 10;
      }

      return total + 4;
    }, 0)
  );

  return {
    title:
      cleanText(output.title).slice(0, 120) ||
      "Important problems",

    overview:
      cleanText(output.overview).slice(0, 420) ||
      "These are the clauses most worth knowing before you continue.",

    riskScore: Number.isFinite(output.riskScore)
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(output.riskScore)
          )
        )
      : calculatedScore,

    risks: verified
  };
}

async function createCacheKey(
  documents,
  preferences
) {
  const source = JSON.stringify({
    documents: documents.map((doc) => ({
      url: doc.url,
      text: doc.text,
      type: doc.type
    })),

    readingLevel:
      preferences.readingLevel || "simple",

    priorities:
      Array.isArray(preferences.priorities)
        ? preferences.priorities
        : []
  });

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source)
  );

  return [...new Uint8Array(digest)]
    .map((byte) =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,

  properties: {
    title: {
      type: "string"
    },

    overview: {
      type: "string"
    },

    riskScore: {
      type: "integer",
      minimum: 0,
      maximum: 100
    },

    risks: {
      type: "array",
      maxItems: 6,

      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          title: {
            type: "string"
          },

          severity: {
            type: "string",
            enum: [
              "high",
              "medium",
              "low"
            ]
          },

          explanation: {
            type: "string"
          },

          action: {
            type: "string"
          },

          quote: {
            type: "string"
          },

          sourceUrl: {
            type: "string"
          }
        },

        required: [
          "title",
          "severity",
          "explanation",
          "action",
          "quote",
          "sourceUrl"
        ]
      }
    }
  },

  required: [
    "title",
    "overview",
    "riskScore",
    "risks"
  ]
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

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      return json({
        ok: true,
        service: "TermScope API",
        version: "0.4.0"
      });
    }

    if (
      request.method !== "POST" ||
      url.pathname !== "/analyze"
    ) {
      return json(
        {
          error: "Not found"
        },
        404
      );
    }

    try {
      const body = await request.json();

      const documents = normalizeDocuments(
        body.documents
      );

      if (!documents.length) {
        return json(
          {
            error:
              "No readable policy documents were supplied."
          },
          400
        );
      }

      const preferences =
        body.preferences || {};

      const cache = caches.default;

      const cacheKey = await createCacheKey(
        documents,
        preferences
      );

      const cacheRequest = new Request(
        `${url.origin}/cached-analysis/${cacheKey}`,
        {
          method: "GET"
        }
      );

      const cached =
        await cache.match(cacheRequest);

      if (cached) {
        return cached;
      }

      const promptDocuments = documents
        .map(
          (doc, index) =>
            `DOCUMENT ${index + 1}
TYPE: ${doc.type}
URL: ${doc.url}
TITLE: ${doc.title || doc.label}
TEXT:
${doc.text}`
        )
        .join("\n\n");

      const systemPrompt = `
You analyze website Terms of Use and Privacy Policies for ordinary users.

Identify only material problems or restrictions.

Do not provide legal advice.
Do not invent anything.

Every finding must include:
1. An exact quote copied from the supplied document
2. The exact sourceUrl
3. A simple explanation
4. One practical action

Focus on:
data sharing
tracking
location collection
AI training
content licenses
automatic renewal
refund restrictions
forced arbitration
class action waivers
account deletion
data retention
account termination
unilateral policy changes

Return no more than 6 findings.
Order them from most serious to least serious.
`;

      const response = await env.AI.run(
        MODEL,
        {
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user",
              content: `Reading style: ${
                cleanText(
                  preferences.readingLevel
                ) || "simple"
              }.

Priority categories: ${
                Array.isArray(
                  preferences.priorities
                )
                  ? preferences.priorities.join(", ")
                  : "all"
              }.

${promptDocuments}`
            }
          ],

          temperature: 0.1,
          max_tokens: 1100,

          response_format: {
            type: "json_schema",
            json_schema: RESPONSE_SCHEMA
          }
        }
      );

      const parsed =
        parseModelJson(response);

      const result = verifyFindings(
        parsed,
        documents
      );

      const finalResponse = json(
        result,
        200,
        {
          "Cache-Control":
            "public, max-age=86400"
        }
      );

      await cache.put(
        cacheRequest,
        finalResponse.clone()
      );

      return finalResponse;
    } catch (error) {
      console.error(
        "TermScope analysis error",
        error
      );

      return json(
        {
          error:
            error?.message ||
            "Analysis failed."
        },
        500
      );
    }
  }
};
