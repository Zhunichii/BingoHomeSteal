// =====================================================================
// /api/var-vote.js — Vercel Serverless Function
// เรียก AI 3 ตัว (Gemini, ChatGPT, Qwen) มาโหวตตัดสินข้อพิพาทของเกม Bingo Home Steal
// =====================================================================
// ทำไมต้องเป็น serverless function แทนที่จะเรียกจาก browser ตรงๆ:
// API key ของ Gemini/OpenAI/Qwen ต้องเก็บเป็นความลับ ถ้าเรียกจาก JS ฝั่ง client
// โดยตรง ใครก็เปิด view-source เห็น key แล้วเอาไปใช้ฟรีได้ทันที ฟังก์ชันนี้ทำหน้าที่
// เป็น "ตัวกลาง" ที่ปลอดภัย — key อยู่บนเซิร์ฟเวอร์ (Vercel) เท่านั้น ไม่หลุดไปที่ browser
//
// วิธีตั้งค่า (Vercel Dashboard > โปรเจกต์ > Settings > Environment Variables):
//   GEMINI_API_KEY      = API key จาก https://aistudio.google.com/apikey
//   OPENAI_API_KEY      = API key จาก https://platform.openai.com/api-keys
//   GROQ_API_KEY        = API key จาก https://console.groq.com (สมัครแค่อีเมล ไม่ต้อง credit card)
//
// ตั้งค่าเสริม (ไม่ตั้งก็ได้ มีค่า default ให้แล้ว):
//   GEMINI_MODEL    (default: gemini-2.5-flash)
//   OPENAI_MODEL    (default: gpt-4o-mini)
//   GROQ_MODEL      (default: openai/gpt-oss-20b)
//
// หมายเหตุ: ชื่อโมเดลของแต่ละเจ้าเปลี่ยนได้เรื่อยๆ ตามเวลา ถ้าเจอ error ว่าโมเดล
// ไม่มีอยู่ ให้เข้าไปเช็ครุ่นล่าสุดจากเอกสารของแต่ละเจ้า แล้วตั้งผ่าน environment
// variable ด้านบนแทนการแก้โค้ด
// =====================================================================

function buildPrompt(questionText, proposedName) {
  return [
    'คุณเป็นกรรมการ VAR ในเกมบิงโก ตัดสินว่าชื่อที่ผู้เล่นเสนอมาตรงกับโจทย์หรือไม่',
    `โจทย์: "${questionText}"`,
    `ชื่อที่ผู้เล่นเสนอ: "${proposedName}"`,
    '',
    'พิจารณาอย่างเป็นกลางและตรงไปตรงมา ถ้าไม่แน่ใจให้ใช้ดุลยพินิจตามข้อเท็จจริงทั่วไปที่คุณทราบ',
    'ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอกเหนือจาก JSON รูปแบบนี้:',
    '{"verdict": true หรือ false, "reasoning": "เหตุผลสั้นๆ ไม่เกิน 2 ประโยค เป็นภาษาไทย"}',
  ].join('\n');
}

function parseVerdictText(text) {
  try {
    const cleaned = text.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```$/, '');
    const parsed = JSON.parse(cleaned);
    return { verdict: !!parsed.verdict, reasoning: String(parsed.reasoning || '').slice(0, 300) };
  } catch (e) {
    // เผื่อ AI ไม่ตอบเป็น JSON ตามที่สั่ง ให้เดาจากคำสำคัญในข้อความแทน
    const head = text.slice(0, 80).toLowerCase();
    const positive = /true|ใช่|ถูกต้อง|ผ่าน(?!.*ไม่)/i.test(head);
    const negative = /false|ไม่ใช่|ไม่ถูก|ไม่ผ่าน/i.test(head);
    return { verdict: positive && !negative, reasoning: text.slice(0, 300) };
  }
}

async function askGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { name: 'gemini', error: 'ไม่ได้ตั้งค่า GEMINI_API_KEY' };
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error((data.error && data.error.message) || `Gemini HTTP ${r.status}`);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { name: 'gemini', ...parseVerdictText(text) };
  } catch (err) {
    return { name: 'gemini', error: err.message };
  }
}

async function askOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { name: 'chatgpt', error: 'ไม่ได้ตั้งค่า OPENAI_API_KEY' };
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error((data.error && data.error.message) || `OpenAI HTTP ${r.status}`);
    const text = data.choices?.[0]?.message?.content || '';
    return { name: 'chatgpt', ...parseVerdictText(text) };
  } catch (err) {
    return { name: 'chatgpt', error: err.message };
  }
}

async function askGroq(prompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { name: 'groq', error: 'ไม่ได้ตั้งค่า GROQ_API_KEY' };
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error((data.error && data.error.message) || `Groq HTTP ${r.status}`);
    const text = data.choices?.[0]?.message?.content || '';
    return { name: 'groq', ...parseVerdictText(text) };
  } catch (err) {
    return { name: 'groq', error: err.message };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { questionText, proposedName } = req.body || {};
  if (!questionText || !proposedName) {
    res.status(400).json({ error: 'ต้องส่ง questionText และ proposedName มาด้วย' });
    return;
  }

  const prompt = buildPrompt(questionText, proposedName);

  const [gemini, chatgpt, groq] = await Promise.all([
    askGemini(prompt),
    askOpenAI(prompt),
    askGroq(prompt),
  ]);

  const votes = [gemini, chatgpt, groq];
  const validVotes = votes.filter(v => typeof v.verdict === 'boolean');
  const yesCount = validVotes.filter(v => v.verdict).length;
  const noCount = validVotes.length - yesCount;
  const finalVerdict = yesCount > noCount; // เสียงข้างมากจาก AI ที่ตอบสำเร็จจริงเท่านั้น

  res.status(200).json({
    votes,
    yesCount,
    noCount,
    totalResponded: validVotes.length,
    finalVerdict,
  });
};