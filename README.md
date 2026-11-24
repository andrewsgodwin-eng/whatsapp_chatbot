# HairDo - Production-Ready WhatsApp Chatbot Backend

A minimal, production-ready WhatsApp chatbot backend for small businesses built with **Node.js (ESM)**, **Express**, **SQLite (better-sqlite3)**, and **OpenAI**. It interfaces directly with Meta's official WhatsApp Cloud API.

---

## 🌟 Features

1. **Meta WhatsApp Cloud API Webhook**:
   - `GET /webhook`: Subscribes and verifies Meta's verification challenge (`hub.challenge` and `hub.verify_token`).
   - `POST /webhook`: Safely parses WhatsApp messages, deduplicates incoming messages via `wa_message_id`, immediately responds with `200 OK`, and processes replies asynchronously.
2. **Local Knowledge Base**:
   - Loaded from `data/kb.md` into memory.
   - Enforces grounding so the LLM does not hallucinate business policies, pricing, timings, or location.
3. **Conversational AI & Lead Capture**:
   - System prompt tailored for simple, polite Indian English.
   - Extracts structured lead information: `name`, `requirement`, `city`, and `preferred_callback_time`.
   - Persists leads and conversation state in SQLite.
4. **Human Escalation (`NEEDS_HUMAN`)**:
   - Automatically detects complaints, refund requests, medical/legal advice, or frustrated customers and flags the conversation as `NEEDS_HUMAN`.
5. **Production Hardening**:
   - Outbound WhatsApp API client with exponential backoff on transient errors (`429`, `5xx`).
   - Idempotent message deduplication preventing infinite loops or duplicate customer replies.
   - Non-sensitive logging (phone numbers are masked as `***XXXX`, tokens are redacted).
   - Inbound messages marked as `read` automatically after processing.
   - Health check endpoint at `GET /health`.

---

## 📁 Project Structure

```
whatsapp-bot/
├── data/
│   ├── kb.md                 # Local business knowledge base & FAQs
│   └── bot.db                # SQLite database (auto-created at runtime)
├── src/
│   ├── server.js             # Express application & lifecycle management
│   ├── webhook.js            # Webhook GET/POST handlers & message processor
│   ├── whatsapp.js           # WhatsApp Cloud API client (sendText, markMessageAsRead)
│   ├── ai.js                 # OpenAI chat completions & JSON parsing
│   ├── db.js                 # SQLite schema, queries, indexes & lead persistence
│   └── kb.js                 # Knowledge base file reader & parser
├── test/
│   ├── test-webhook.js       # Integration test suite (mocked WA & AI)
│   └── test-http-server.js   # Live Express HTTP endpoint test
├── .env.example              # Template for environment variables
├── .gitignore                # Protects secrets, node_modules, and databases
├── package.json              # Project configuration and dependencies
└── README.md                 # Setup and operational guide
```

---

## 🛠️ Prerequisites

- **Node.js**: `v20.0.0` or higher (verified on Node 20, 22, and 24).
- **npm**: `v10.0.0` or higher.
- A **Meta for Developers** account with a WhatsApp Business App configured.
- An **OpenAI API Key** (or OpenAI-compatible API).

---

## 🔑 How to Obtain Meta WhatsApp Cloud API Credentials

1. Go to the [Meta for Developers Portal](https://developers.facebook.com/).
2. Create an App:
   - Select **Other** > **Business**.
   - Fill in your App Name and Contact Email.
3. Add **WhatsApp** to your app:
   - On the App Dashboard, find "WhatsApp" and click **Set Up**.
4. In the left sidebar under **WhatsApp**, click **API Setup**:
   - **Temporary Access Token**: Copy this token (or generate a permanent System User Token under Meta Business Settings). Set it as `WHATSAPP_TOKEN`.
   - **Phone Number ID**: Copy the ID displayed beneath the test phone number. Set it as `WHATSAPP_PHONE_NUMBER_ID`.
   - **Recipient Test Number**: Add your personal WhatsApp phone number to the "To" field and send a test message to verify Meta connectivity.

---

## 🚀 Local Setup

### 1. Clone & Install Dependencies

```bash
cd whatsapp-bot
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```ini
WHATSAPP_TOKEN=your_meta_system_user_or_temporary_token
WHATSAPP_PHONE_NUMBER_ID=your_whatsapp_phone_number_id
VERIFY_TOKEN=create_a_strong_random_secret_here
OPENAI_API_KEY=sk-proj-your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
PORT=3000
```

### 3. Customize Knowledge Base

Edit `data/kb.md` to configure your business name, pricing, operational timings, and FAQs.

### 4. Run Locally

```bash
# Production mode
npm start

# Development mode (with live reload)
npm run dev
```

Check the health endpoint:
```bash
curl http://localhost:3000/health
# Response: {"status":"ok"}
```

---

## 🌐 Exposing Local Server to Meta via Tunnel

Meta requires a public HTTPS URL for webhooks.

### Option A: Using Cloudflare Tunnel (Recommended - No account required)
```bash
npx cloudflared tunnel --url http://localhost:3000
```
Copy the generated `https://<random-subdomain>.trycloudflare.com` URL.

### Option B: Using ngrok
```bash
ngrok http 3000
```
Copy the generated `https://<random-id>.ngrok-free.app` URL.

---

## ⚙️ Configuring Webhook in Meta App Dashboard

1. In the Meta Developers App Dashboard, navigate to **WhatsApp** > **Configuration**.
2. Under **Webhook**, click **Edit**:
   - **Callback URL**: Enter `https://<your-tunnel-url>/webhook`
   - **Verify Token**: Enter the exact string you configured in `VERIFY_TOKEN` in your `.env`.
3. Click **Verify and Save**. Meta will send a `GET` request to your server. Once verified, it will display a green checkmark.
4. Click **Manage Webhook Fields** and click **Subscribe** to the `messages` field.

---

## 🧪 Testing with Meta Test Number

1. In the WhatsApp **API Setup** page, ensure your personal WhatsApp number is added as a verified recipient.
2. Send a WhatsApp message to the test phone number provided by Meta (e.g. `Hi, how much is a haircut?`).
3. Observe your terminal logs:
   - Inbound webhook is received and returns `200 EVENT_RECEIVED` immediately.
   - Message is deduplicated and saved to SQLite.
   - LLM analyzes message against `data/kb.md`.
   - Reply is sent back to your WhatsApp chat.
   - Message status is marked as `read`.

### Running Automated Verification Tests

The project includes an end-to-end test suite that verifies webhook authentication, deduplication, message persistence, lead capture, and escalation without consuming Meta or OpenAI credits:

```bash
npm test
```

---

## 🗄️ Database Schema

The database file is created automatically at `data/bot.db` using SQLite with WAL mode enabled:

### `conversations`
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | Unique conversation ID |
| `wa_id` | TEXT UNIQUE | Customer's WhatsApp phone number / ID |
| `name` | TEXT | Customer profile name from WhatsApp |
| `state` | TEXT | `chatting` or `NEEDS_HUMAN` |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

### `messages`
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | Unique message ID |
| `conversation_id` | INTEGER | Foreign key to `conversations(id)` |
| `wa_message_id` | TEXT UNIQUE | WhatsApp Message ID (`wamid.xxx`) |
| `direction` | TEXT | `inbound` or `outbound` |
| `body` | TEXT | Message body text |
| `created_at` | TEXT | ISO timestamp |

### `leads`
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | Unique lead ID |
| `conversation_id` | INTEGER | Foreign key to `conversations(id)` |
| `name` | TEXT | Captured customer name |
| `requirement` | TEXT | Required service |
| `city` | TEXT | Customer city |
| `preferred_callback_time`| TEXT | Preferred callback time |
| `status` | TEXT | `new` |
| `created_at` | TEXT | ISO timestamp |

---

## 🚢 Deployment Notes

### Deploy to Railway / Render / Fly.io

1. **Environment Variables**:
   Set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `VERIFY_TOKEN`, `OPENAI_API_KEY`, `OPENAI_MODEL`, and `PORT`.
2. **Persistent Volume**:
   Mount a persistent disk to the `/data` directory so that `bot.db` persists across restarts.
3. **Webhook URL**:
   Update your Meta App Webhook Callback URL to `https://your-production-app.up.railway.app/webhook`.

---

## 🔒 Security & Best Practices

- **Never Commit Secrets**: Keep `.env` out of version control (enforced via `.gitignore`).
- **Data Protection**: Sensitive identifiers in logs are masked (`***XXXX`).
- **HTTPS Enforcement**: Meta Webhooks strictly enforce valid HTTPS endpoints.
- **Payload Validation**: Webhook handlers validate payload structure before processing.
