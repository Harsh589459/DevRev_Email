const express = require("express");
const cors = require("cors");
const axios = require("axios");
const sgMail = require("@sendgrid/mail");
require("dotenv").config();

const app = express();
const PORT = 3001;

app.use(express.json());

app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:5173"
  ],
  credentials: true
}));

/* =========================
   INIT SENDGRID
========================= */
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/* =========================
   STORE CONNECTED SSE CLIENTS
========================= */
let clients = [];

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.send("✅ DevRev Local Server Running");
});

/* =========================
   SSE STREAM ENDPOINT
========================= */
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Confirm connection
  res.write(`data: ${JSON.stringify({ connected: true })}\n\n`);

  clients.push(res);
  console.log("🟢 Frontend connected. Total clients:", clients.length);

  req.on("close", () => {
    clients = clients.filter(c => c !== res);
    console.log("🔴 Frontend disconnected. Total clients:", clients.length);
  });
});

/* =========================
   TRIGGER DEVREV AI AGENT
========================= */
app.post("/analyze", async (req, res) => {
  const { email, ticketId } = req.body;

  if (!email || !ticketId) {
    return res.status(400).json({
      error: "Email and ticketId are required"
    });
  }

  try {
    const response = await axios.post(
      "https://api.devrev.ai/ai-agents.events.execute-async",
      {
        agent: process.env.DEVREV_AGENT,
        event: {
          input_message: {
            message: `Please check ticket ${ticketId}. 
              Did the customer agree to remove the ${email} from any list? write the answer in following json format YES or NO example like. Also give the line where user have mentioned to remove the emailiDs from the list. Return JSON like:
{"consent":"YES or NO","TKT":"${ticketId}","Email_to_remove":"${email},"customer mentioned":"customer message"}. Please ensure that only a single response is sent to the webhook endpoint for each request. Multiple responses should not be triggered after a few seconds for the same webhook call.
`
          }
        },
        session_object: `${process.env.DEVREV_TICKET_PREFIX}/${ticketId}`,
        webhook_target: {
          webhook: process.env.DEVREV_WEBHOOK
        },
        target: "webhook_target"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.DEVREV_PAT}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({
      status: "AI Processing Started",
      session: response.data.session?.id || null
    });

  } catch (err) {
    console.error("❌ DevRev Error:", err.response?.data || err.message);
    res.status(500).json({ error: "DevRev API call failed" });
  }
});

/* =========================
   DEVREV WEBHOOK ENDPOINT
========================= */
app.post("/webhook", async (req, res) => {
  const body = req.body;

  // Webhook verification
  if (body.type === "verify" && body.verify) {
    console.log("✅ Webhook Verified");
    return res.status(200).json({
      challenge: body.verify.challenge
    });
  }

  console.log("📩 Webhook Received");
  // console.log(JSON.stringify(body));

  try {
    if (body.ai_agent_response?.message) {

      console.log("cleanMessage",body.ai_agent_response.message)
      console.log("helllllooo")
      const cleanMessage = body.ai_agent_response.message
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

        console.log("cleanMessage",cleanMessage)


      const fullMessage = body.ai_agent_response.message;

// Extract JSON between ```json and ```
const jsonMatch = fullMessage.match(/```json\s*([\s\S]*?)\s*```/);

let parsedData = null;

if (jsonMatch && jsonMatch[1]) {
  try {
    parsedData = JSON.parse(jsonMatch[1]);
    console.log("Parsed JSON:", parsedData);
  } catch (err) {
    console.error("JSON Parse Error:", err.message);
  }
}

      // Broadcast to frontend
      clients.forEach(client => {
        client.write(`data: ${JSON.stringify({
          type: "ai_response",
          data: parsedData
        })}\n\n`);
      });
    }

  } catch (err) {
     clients.forEach(client => {
        client.write(`data: ${JSON.stringify({
          type: "ai_response",
          data: "Something went wrong"
        })}\n\n`);
      });
    console.error("❌ Webhook Processing Error:", err.message);
  }

  res.status(200).send("OK");
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
