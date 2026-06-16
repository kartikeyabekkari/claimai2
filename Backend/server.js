require("dotenv").config();
console.log("API KEY LOADED:", process.env.ANTHROPIC_API_KEY ? "YES" : "NO - KEY IS MISSING");

const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const multer = require("multer");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/analyze — case strength + analysis + evidence checklist
app.post("/api/analyze", upload.array("images", 10), async (req, res) => {
  const { state, amount, defendant, evidence, description } = req.body;
  if (!state || !amount || !defendant || !description) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // Build message content — text + any uploaded images
    const userContent = [];

    // Add images if uploaded
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const base64 = file.buffer.toString("base64");
        const mediaType = file.mimetype;
        userContent.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64 },
        });
      }
      userContent.push({
        type: "text",
        text: `The above image(s) are evidence photos uploaded by the user. Analyze them carefully and reference specific visual details you observe when giving your analysis and evidence checklist. Note exactly what the images show (dates, damage, documents, text visible, etc).`,
      });
    }

    const evidenceList = Array.isArray(evidence)
      ? evidence.join(", ")
      : evidence || "none specified";

    userContent.push({
      type: "text",
      text: `You are a small claims court expert helping someone prepare their case (document preparation service, not legal advice).

Case details:
- State: ${state}
- Amount disputed: $${amount}
- Defendant type: ${defendant}
- Evidence available: ${evidenceList}
- Description: ${description}

IMPORTANT INSTRUCTIONS:
1. Use specific facts from the description (dates, amounts, names, events) throughout your response. Never use generic placeholders like "the incident" or vague phrases. Quote specific details the user mentioned.
2. For case strength, use ONLY these three labels: Strong Case, Moderate Case, or Weak Case. Do NOT use numbers or scores.
3. For legal analysis, use careful hedging language like "The facts described may support...", "This could potentially...", "Based on what you've described, it appears..." — never make definitive legal conclusions like "You have a valid claim."
4. Reference any uploaded images specifically if present.

Respond in this EXACT format:

STRENGTH_LABEL: [Strong Case / Moderate Case / Weak Case]

ANALYSIS:
[3-4 paragraphs using specific facts from the description. Use hedged legal language. Reference exact amounts, dates, and events the user mentioned. Mention the small claims limit for ${state}.]

EVIDENCE_CHECKLIST:
[Bullet list referencing specific evidence relevant to their exact situation. Use ✓ for what they have, ◻ for what they need. Be specific — e.g. "✓ Written contract dated [date user mentioned]" not just "✓ Written contract"]`,
    });

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: userContent }],
    });

    const text = message.content.map((b) => b.text || "").join("");
    const labelMatch = text.match(/STRENGTH_LABEL:\s*(.+)/);
    const label = labelMatch ? labelMatch[1].trim() : "Moderate Case";
    const analysis = ((text.match(/ANALYSIS:\n([\s\S]*?)(?=EVIDENCE_CHECKLIST:|$)/) || [])[1] || text).trim();
    const evidenceOut = ((text.match(/EVIDENCE_CHECKLIST:\n([\s\S]*)/) || [])[1] || "").trim();

    res.json({ label, analysis, evidenceList: evidenceOut });
  } catch (err) {
    console.error("FULL ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents — demand letter + filing guide
app.post("/api/documents", upload.array("images", 10), async (req, res) => {
  const { state, amount, defendant, description } = req.body;

  try {
    const today = new Date().toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });

    const userContent = [];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const base64 = file.buffer.toString("base64");
        userContent.push({
          type: "image",
          source: { type: "base64", media_type: file.mimetype, data: base64 },
        });
      }
      userContent.push({
        type: "text",
        text: "The above images are evidence. Reference specific details visible in them when drafting the demand letter.",
      });
    }

    userContent.push({
      type: "text",
      text: `Legal document preparation assistant. Create two documents.

Case: State=${state}, Amount=$${amount}, Defendant=${defendant}, Date=${today}
Description: ${description}

IMPORTANT INSTRUCTIONS:
1. Use SPECIFIC facts from the description throughout — exact dates, amounts, what was delivered, what was said. Never use vague phrases like "completed the work" or "as agreed." Instead say things like "delivered the completed website on [date mentioned]" or "provided login credentials via email on [date]."
2. The demand letter must sound like it was written by the actual person — personal, specific, factual.
3. Use hedged language in the legal analysis portions: "The facts described may support...", "This could constitute...", not "You breached the contract."
4. Reference any image evidence specifically if uploaded.

Reply in EXACTLY this format:

DEMAND_LETTER:
[Professional demand letter. Use [YOUR NAME], [YOUR ADDRESS], [DEFENDANT NAME], [DEFENDANT ADDRESS] as placeholders. Date: ${today}. Reference SPECIFIC facts, dates, amounts, and events from the description. 14-day deadline. Mention intent to file in small claims court. 3-4 paragraphs.]

FILING_GUIDE:
[Step-by-step guide for ${state} small claims court: where to file, fees, claim limit, forms needed, how to serve defendant, what to bring, what to expect. Number each step.]`,
    });

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: userContent }],
    });

    const text = message.content.map((b) => b.text || "").join("");
    const demandLetter = ((text.match(/DEMAND_LETTER:\n([\s\S]*?)(?=FILING_GUIDE:|$)/) || [])[1] || text).trim();
    const filingGuide = ((text.match(/FILING_GUIDE:\n([\s\S]*)/) || [])[1] || "").trim();

    res.json({ demandLetter, filingGuide });
  } catch (err) {
    console.error("FULL ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));