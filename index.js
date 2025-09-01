import express, {json} from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import axios from "axios";

dotenv.config();
const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const inventory = [
  {
    item: "ajedrez",
    synonyms: ["ajedrez", "juego de ajedrez", "chess", "tablero de ajedrez"],
    shop: { name: "Juguetes para Niños", floor: 3, unit: "101" },
  },
  {
    item: "lego",
    synonyms: ["lego", "bloques lego"],
    shop: { name: "Juguetes para Niños", floor: 3, unit: "101" },
  },
  {
    item: "raqueta de tenis",
    synonyms: ["raqueta", "raqueta de tenis", "tenis"],
    shop: { name: "Deportes Max", floor: 2, unit: "220" },
  },
];

function stripMarkdownFences(s = "") {
  return s.replace(/```(?:json)?\s*|\s*```/g, "").trim();
}

export async function extractProduct(queryText) {
  const resp = await openai.responses.create({
    model: OPENAI_MODEL,
    temperature: 0,
    instructions:
        `Necesito que me entregue basado en este json, que opción quiere el usuario, devuelve los json que correspondan a lo que quiera el usuario. este es el JSON ${JSON.stringify(inventory)} son entregame el json, no agregues texto adicional sin no hay coincidencias, solo responde con el null.`,
    input: [
      {
        role: "user",
        content: `Texto del cliente: """${queryText}"""`
      }
    ]
  });

  let raw = resp.output_text ?? "";
  raw = stripMarkdownFences(raw);

  return JSON.parse(raw);
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;


    if (Array.isArray(messages) && messages[0]?.type === "text") {
      const msg = messages[0];
      const from = msg.from;
      const text = msg.text?.body || "";

      let reply;
      try {
        const product = await extractProduct(text);

        const { name, floor, unit } = product[0].shop;

        let data = `Debes dirigirte al piso ${floor}, local ${unit}, llamado "${name}" y preguntar por "${product[0].item}".`;
        reply = data ??
            `No encontré "${text}". ¿Puedes darme otra pista? (ej: 'ajedrez')`;
      } catch (e) {
        console.error("OpenAI error:", e?.response?.data || e.message);
        reply =
            "Tuve un problema entendiendo el producto. ¿Puedes escribirlo de otra forma? (ej: 'ajedrez')";
      }

      await axios.post(
          `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: from,
            text: { body: reply },
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
      );

      return res.json({reply});
    }

  } catch (err) {
    console.log(err);
    console.error("Webhook error:", err?.response?.data || err.message);
  }
  return res.sendStatus(400); // <- una sola respuesta
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Bot listo en http://localhost:${process.env.PORT || 3000}`);
});
