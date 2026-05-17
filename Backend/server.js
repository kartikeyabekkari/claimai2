require("dotenv").config();
//this is for dubugging
console.log("API KEY LOADED:", process.env.ANTHROPIC_API_KEY ? "YES" : "NO - KEY IS MISSING");
//end of the debug
const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(cors());
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/analyze — case strength + analysis + evidence checklist
app.post("/api/analyze", async (req, res) => {
  const { state, amount, defendant, evidence, description } = req.body;
  if (!state || !amount || !defendant || !description) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are a small claims court expert helping someone prepare their case (document preparation service, not legal advice).

Case details:
- State: ${state}
- Amount disputed: $${amount}
- Defendant type: ${defendant}
- Evidence available: ${evidence?.length ? evidence.join(", ") : "none specified"}
- Description: ${description}

Respond in this EXACT format:

STRENGTH_SCORE: [a number 1-100]
STRENGTH_LABEL: [Weak / Fair / Good / Strong / Excellent]

ANALYSIS:
[3-4 paragraphs: (1) whether they have a valid claim, (2) key legal issues for ${state} small claims court, (3) strengths/weaknesses, (4) realistic outcome. Mention the small claims limit for ${state}.]

EVIDENCE_CHECKLIST:
[Bullet list of evidence items. Use ✓ for what they have, ◻ for what they need.]`,
        },
      ],
    });

    const text = message.content.map((b) => b.text || "").join("");
    const score = parseInt((text.match(/STRENGTH_SCORE:\s*(\d+)/) || [])[1] || "50");
    const label = ((text.match(/STRENGTH_LABEL:\s*(.+)/) || [])[1] || "Fair").trim();
    const analysis = ((text.match(/ANALYSIS:\n([\s\S]*?)(?=EVIDENCE_CHECKLIST:|$)/) || [])[1] || text).trim();
    const evidenceList = ((text.match(/EVIDENCE_CHECKLIST:\n([\s\S]*)/) || [])[1] || "").trim();

    res.json({ score, label, analysis, evidenceList });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI request failed" });
  }
});

// POST /api/documents — demand letter + filing guide
app.post("/api/documents", async (req, res) => {
  const { state, amount, defendant, description } = req.body;

  try {
    const today = new Date().toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Legal document preparation assistant. Create two documents.

Case: State=${state}, Amount=$${amount}, Defendant=${defendant}, Date=${today}
Description: ${description}

Reply in EXACTLY this format:

DEMAND_LETTER:
[Professional demand letter. Use [YOUR NAME], [YOUR ADDRESS], [DEFENDANT NAME], [DEFENDANT ADDRESS] as placeholders. Date: ${today}. 14-day deadline. Mention intent to file in small claims court. 3-4 paragraphs.]

FILING_GUIDE:
[Step-by-step guide specific to ${state} small claims court: where to file, fees, claim limit, forms needed, how to serve defendant, what to bring, what to expect. Number each step.]`,
        },
      ],
    });

    const text = message.content.map((b) => b.text || "").join("");
    const demandLetter = ((text.match(/DEMAND_LETTER:\n([\s\S]*?)(?=FILING_GUIDE:|$)/) || [])[1] || text).trim();
    const filingGuide = ((text.match(/FILING_GUIDE:\n([\s\S]*)/) || [])[1] || "").trim();

    res.json({ demandLetter, filingGuide });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI request failed" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));