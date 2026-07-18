require("dotenv").config();
console.log("API KEY LOADED:", process.env.ANTHROPIC_API_KEY ? "YES" : "NO");

const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Supabase admin client (uses service role key — never exposed to frontend)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── MIDDLEWARE: verify Supabase JWT token ──
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Invalid token" });
  req.user = user;
  next();
}

// ── POST /api/analyze ──
app.post("/api/analyze", upload.array("images", 10), async (req, res) => {
  const { state, amount, defendant, evidence, description } = req.body;
  if (!state || !amount || !defendant || !description) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
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
        text: `The above image(s) are evidence photos. Analyze them carefully and reference specific visual details in your analysis.`,
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
1. Use specific facts from the description (dates, amounts, names, events). Never use generic placeholders.
2. For case strength, use ONLY: Strong Case, Moderate Case, or Weak Case.
3. Use hedged legal language: "The facts described may support...", "This could potentially...", "Based on what you've described..."
4. Reference any uploaded images specifically if present.

Respond in this EXACT format:

STRENGTH_LABEL: [Strong Case / Moderate Case / Weak Case]

ANALYSIS:
[3-4 paragraphs using specific facts. Use hedged language. Reference exact amounts, dates, events. Mention the small claims limit for ${state}.]

EVIDENCE_CHECKLIST:
[Bullets referencing specific evidence. Use ✓ for what they have, ◻ for what they need.]`,
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
    console.error("ANALYZE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/documents ──
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
        text: "The above images are evidence. Reference specific details visible in them in the demand letter.",
      });
    }

    userContent.push({
      type: "text",
      text: `Legal document preparation assistant. Create two documents.

Case: State=${state}, Amount=$${amount}, Defendant=${defendant}, Date=${today}
Description: ${description}

IMPORTANT:
1. Use SPECIFIC facts — exact dates, amounts, what was delivered, what was said.
2. The demand letter must sound personal and factual, not generic.
3. Use hedged language: "The facts described may support...", not "You breached the contract."

Reply in EXACTLY this format:

DEMAND_LETTER:
[Professional demand letter. Use [YOUR NAME], [YOUR ADDRESS], [DEFENDANT NAME], [DEFENDANT ADDRESS] as placeholders. Date: ${today}. Reference SPECIFIC facts. 14-day deadline. Mention intent to file in small claims court. 3-4 paragraphs.]

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
    console.error("DOCS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cases/save ── (requires auth)
app.post("/api/cases/save", requireAuth, async (req, res) => {
  const { state, amount, defendant, description, strength_label, analysis, evidence_list, demand_letter, filing_guide } = req.body;

  try {
    const { data, error } = await supabase.from("cases").insert([{
      user_id: req.user.id,
      state, amount, defendant, description,
      strength_label, analysis, evidence_list,
      demand_letter, filing_guide,
    }]).select().single();

    if (error) throw error;
    res.json({ success: true, case: data });
  } catch (err) {
    console.error("SAVE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/cases ── (requires auth)
app.get("/api/cases", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("cases")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json({ cases: data });
  } catch (err) {
    console.error("FETCH ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/cases/:id ── (requires auth)
app.delete("/api/cases/:id", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("cases")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));