import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const port = Number(process.env.PORT || 8787);
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const schema = {
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
};

function trimDocuments(documents) {
  const perDocument = Math.max(18000, Math.floor(90000 / Math.max(1, documents.length)));
  return documents.map(document => ({
    title: document.title,
    label: document.label,
    type: document.type,
    url: document.url,
    text: String(document.text || "").slice(0, perDocument)
  }));
}

app.post("/analyze", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is missing in backend/.env" });
    }

    const documents = trimDocuments(req.body.documents || []);
    if (!documents.length) return res.status(400).json({ error: "No policy documents were supplied." });

    const priorities = req.body.preferences?.priorities || [];
    const readingLevel = req.body.preferences?.readingLevel || "simple";

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `You analyze Terms of Use and Privacy Policies for ordinary users. Return only the most meaningful problems, not a full neutral summary. Focus on: ${priorities.join(", ") || "privacy, payments, legal rights, content ownership, account control, and AI training"}. Use ${readingLevel} language. Do not invent concerns. Every risk must include a short exact quote copied from the supplied document and the exact source URL. Rank serious and surprising issues first. Explain practical consequences and one useful action. Avoid legal conclusions and do not call something illegal.`
        },
        {
          role: "user",
          content: JSON.stringify({ hostname: req.body.hostname, documents })
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "termscope_policy_analysis",
          strict: true,
          schema
        }
      }
    });

    const result = JSON.parse(response.output_text);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "AI analysis failed." });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(port, () => {
  console.log(`TermScope AI backend running at http://localhost:${port}`);
});
