/**
 * WhatsApp Webhook Handlers
 * Handles GET verification and POST notification processing.
 */

import {
  getOrCreateConversation,
  isMessageProcessed,
  saveInboundMessage,
  saveOutboundMessage,
  updateConversationState,
  getRecentMessages,
  upsertLead,
  getDb
} from './db.js';
import { generateReply } from './ai.js';
import { sendText, markMessageAsRead, maskIdentifier } from './whatsapp.js';

/**
 * Handles Meta webhook GET verification challenge.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken = process.env.VERIFY_TOKEN;

  if (mode === 'subscribe' && token === expectedToken) {
    console.log('[Webhook] Verification successful');
    return res.status(200).send(challenge);
  }

  console.warn('[Webhook] Verification failed. Invalid or missing verify token.');
  return res.sendStatus(403);
}

/**
 * Parses and extracts messages and contact details from Meta WhatsApp webhook payload.
 * @param {object} body - Request body
 * @returns {Array<{ message: object, contactName: string|null, metadata: object }>}
 */
export function extractIncomingMessages(body) {
  const extracted = [];

  if (body?.object !== 'whatsapp_business_account' || !Array.isArray(body?.entry)) {
    return extracted;
  }

  for (const entry of body.entry) {
    for (const change of entry.changes || []) {
      const value = change?.value;
      if (!value || !Array.isArray(value.messages)) continue;

      const metadata = value.metadata || {};
      const contacts = value.contacts || [];

      for (const message of value.messages) {
        const contact = contacts.find((c) => c.wa_id === message.from);
        const contactName = contact?.profile?.name || null;
        extracted.push({ message, contactName, metadata });
      }
    }
  }

  return extracted;
}

/**
 * Asynchronously processes an incoming WhatsApp message through the AI workflow.
 * @param {object} item
 * @param {object} item.message
 * @param {string|null} item.contactName
 * @param {object} [deps] - Optional dependency injections for testing
 */
export async function processIncomingMessage({ message, contactName }, deps = {}) {
  const db = deps.db || getDb();
  const ai = deps.ai || { generateReply };
  const wa = deps.wa || { sendText, markMessageAsRead };

  const waId = message.from;
  const waMessageId = message.id;
  const msgType = message.type;
  const maskedSender = maskIdentifier(waId);

  // Ignore non-text messages
  if (msgType !== 'text') {
    console.log(`[Webhook] Ignored non-text message type "${msgType}" from sender ${maskedSender}`);
    return { status: 'ignored', reason: 'non_text' };
  }

  const textBody = message.text?.body?.trim();
  if (!textBody) {
    console.warn(`[Webhook] Empty text message from sender ${maskedSender}`);
    return { status: 'ignored', reason: 'empty_body' };
  }

  // Deduplication check
  if (isMessageProcessed(waMessageId, db)) {
    console.log(`[Webhook] Duplicate message ID detected: ${waMessageId}. Skipping.`);
    return { status: 'skipped_duplicate' };
  }

  try {
    // 1. Get or create conversation record
    const conversation = getOrCreateConversation(waId, contactName, db);

    // 2. Save inbound message (ensuring idempotency via wa_message_id)
    saveInboundMessage({
      conversationId: conversation.id,
      waMessageId,
      body: textBody
    }, db);

    // 3. Retrieve recent message history (last 10 messages)
    const history = getRecentMessages(conversation.id, 10, db);

    // 4. Generate AI reply with knowledge base context
    const aiResult = await ai.generateReply({
      incomingText: textBody,
      history
    });

    // 5. Check escalation
    if (aiResult.needs_human) {
      console.log(`[Webhook] Conversation ${conversation.id} flagged as NEEDS_HUMAN`);
      updateConversationState(conversation.id, 'NEEDS_HUMAN', db);
    }

    // 6. Update lead details if extracted
    if (aiResult.lead) {
      upsertLead(conversation.id, aiResult.lead, db);
    }

    // 7. Save outbound reply
    saveOutboundMessage({
      conversationId: conversation.id,
      body: aiResult.reply
    }, db);

    // 8. Send reply via WhatsApp API
    await wa.sendText(waId, aiResult.reply);

    // 9. Mark message as read
    await wa.markMessageAsRead(waMessageId);

    console.log(`[Webhook] Processed message ${waMessageId} successfully for ${maskedSender}`);
    return {
      status: 'success',
      reply: aiResult.reply,
      needsHuman: aiResult.needs_human,
      lead: aiResult.lead
    };
  } catch (error) {
    console.error(`[Webhook Error] Processing failed for message ${waMessageId}:`, error.message);
    return { status: 'error', error: error.message };
  }
}

/**
 * Express POST /webhook handler.
 * Immediately returns HTTP 200 and processes messages asynchronously.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function handleWebhookPost(req, res) {
  // Always immediately return 200 OK to Meta
  res.status(200).send('EVENT_RECEIVED');

  try {
    const incomingItems = extractIncomingMessages(req.body);

    for (const item of incomingItems) {
      // Process each message asynchronously
      processIncomingMessage(item).catch((err) => {
        console.error('[Webhook Uncaught Async Error]', err?.message || err);
      });
    }
  } catch (err) {
    console.error('[Webhook Payload Error] Failed to parse webhook payload:', err.message);
  }
}
