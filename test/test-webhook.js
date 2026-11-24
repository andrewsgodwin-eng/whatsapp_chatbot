/**
 * Automated Verification & Integration Test Suite
 * Tests WhatsApp Webhook, Deduplication, Database Persistence, AI Prompting, and Mocked Outbound API.
 */

import assert from 'node:assert/strict';
import { getDb } from '../src/db.js';
import { loadKnowledgeBase } from '../src/kb.js';
import {
  extractIncomingMessages,
  processIncomingMessage,
  verifyWebhook
} from '../src/webhook.js';

// Setup in-memory test database and environment
process.env.VERIFY_TOKEN = 'test_verify_token_123';
process.env.WHATSAPP_TOKEN = 'test_wa_token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '987654321';

console.log('--- STARTING WHATSAPP CHATBOT VERIFICATION TESTS ---');

async function runTests() {
  const db = getDb(':memory:');
  const kb = loadKnowledgeBase();
  assert.ok(kb.includes('HairDo'), 'Knowledge base should load HairDo business content');

  // TEST 1: GET /webhook verification
  console.log('\n[Test 1] Testing Webhook GET verification...');
  {
    let statusCode = null;
    let responseBody = null;

    // 1a. Invalid verify token
    const invalidReq = {
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong_token',
        'hub.challenge': 'challenge_code_123'
      }
    };
    const invalidRes = {
      sendStatus: (code) => { statusCode = code; },
      status: (code) => ({ send: (body) => { statusCode = code; responseBody = body; } })
    };
    verifyWebhook(invalidReq, invalidRes);
    assert.equal(statusCode, 403, 'Invalid token should return HTTP 403');

    // 1b. Valid verify token
    const validReq = {
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'test_verify_token_123',
        'hub.challenge': 'meta_challenge_success_999'
      }
    };
    const validRes = {
      status: (code) => ({
        send: (body) => {
          statusCode = code;
          responseBody = body;
        }
      })
    };
    verifyWebhook(validReq, validRes);
    assert.equal(statusCode, 200, 'Valid token should return HTTP 200');
    assert.equal(responseBody, 'meta_challenge_success_999', 'Should return challenge as plain text');
    console.log('✓ Webhook GET verification passed (both valid and invalid cases).');
  }

  // TEST 2: Extracting messages from Meta payload
  console.log('\n[Test 2] Testing Meta Webhook Payload Extraction...');
  const sampleMetaPayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550255555',
                phone_number_id: '987654321'
              },
              contacts: [
                {
                  profile: { name: 'Karthik Raja' },
                  wa_id: '919876543210'
                }
              ],
              messages: [
                {
                  from: '919876543210',
                  id: 'wamid.HBgLMTIzNDU2Nzg5MA==',
                  timestamp: '1732450000',
                  text: { body: 'Hi, what is the price for a haircut and massage in Chennai?' },
                  type: 'text'
                }
              ]
            },
            field: 'messages'
          }
        ]
      }
    ]
  };

  const extracted = extractIncomingMessages(sampleMetaPayload);
  assert.equal(extracted.length, 1, 'Should extract exactly 1 incoming message');
  assert.equal(extracted[0].message.from, '919876543210');
  assert.equal(extracted[0].contactName, 'Karthik Raja');
  assert.equal(extracted[0].message.id, 'wamid.HBgLMTIzNDU2Nzg5MA==');
  console.log('✓ Payload extraction passed.');

  // TEST 3: Full async processing flow with Mocks
  console.log('\n[Test 3] Testing Full Inbound Message Processing Flow...');
  const calls = {
    aiCalledWith: null,
    waSentTo: null,
    waSentText: null,
    waMarkedReadId: null
  };

  const mockAi = {
    generateReply: async ({ incomingText, history }) => {
      calls.aiCalledWith = { incomingText, history };
      return {
        reply: 'Hello Karthik! For haircut it is ₹149 and for full massage it is ₹799 in Chennai. Would you like to book an appointment?',
        lead: {
          name: 'Karthik Raja',
          requirement: 'Haircut and full massage',
          city: 'Chennai',
          preferred_callback_time: 'Tomorrow 5 PM'
        },
        needs_human: false
      };
    }
  };

  const mockWa = {
    sendText: async (to, text) => {
      calls.waSentTo = to;
      calls.waSentText = text;
      return { messaging_product: 'whatsapp', contacts: [{ input: to, wa_id: to }], messages: [{ id: 'wamid.OUTBOUND1' }] };
    },
    markMessageAsRead: async (msgId) => {
      calls.waMarkedReadId = msgId;
      return { success: true };
    }
  };

  const result1 = await processIncomingMessage(extracted[0], {
    db,
    ai: mockAi,
    wa: mockWa
  });

  assert.equal(result1.status, 'success', 'Processing should succeed');
  assert.equal(calls.waSentTo, '919876543210', 'Should send outbound WhatsApp message to sender');
  assert.ok(calls.waSentText.includes('₹149'), 'Outbound reply should contain expected text');
  assert.equal(calls.waMarkedReadId, 'wamid.HBgLMTIzNDU2Nzg5MA==', 'Inbound message should be marked as read');

  // Verify Database State
  const conversation = db.prepare('SELECT * FROM conversations WHERE wa_id = ?').get('919876543210');
  assert.ok(conversation, 'Conversation record should exist');
  assert.equal(conversation.name, 'Karthik Raja', 'Contact name should be saved');
  assert.equal(conversation.state, 'chatting', 'State should be chatting');

  const inboundMsg = db.prepare('SELECT * FROM messages WHERE wa_message_id = ?').get('wamid.HBgLMTIzNDU2Nzg5MA==');
  assert.ok(inboundMsg, 'Inbound message should be saved');
  assert.equal(inboundMsg.direction, 'inbound');
  assert.equal(inboundMsg.body, 'Hi, what is the price for a haircut and massage in Chennai?');

  const outboundMsg = db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND direction = 'outbound'").get(conversation.id);
  assert.ok(outboundMsg, 'Outbound message should be stored');
  assert.equal(outboundMsg.body, calls.waSentText);

  const lead = db.prepare('SELECT * FROM leads WHERE conversation_id = ?').get(conversation.id);
  assert.ok(lead, 'Lead record should be saved');
  assert.equal(lead.name, 'Karthik Raja');
  assert.equal(lead.city, 'Chennai');
  assert.equal(lead.preferred_callback_time, 'Tomorrow 5 PM');
  console.log('✓ Inbound message stored, AI invoked with context, outbound message sent and stored, and lead created.');

  // TEST 4: Deduplication test
  console.log('\n[Test 4] Testing Webhook Retries & Deduplication...');
  calls.waSentText = null;
  const duplicateResult = await processIncomingMessage(extracted[0], {
    db,
    ai: mockAi,
    wa: mockWa
  });

  assert.equal(duplicateResult.status, 'skipped_duplicate', 'Duplicate message ID must be skipped');
  assert.equal(calls.waSentText, null, 'No new outbound reply should be sent for duplicate message');

  const totalInboundCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE wa_message_id = ?').get('wamid.HBgLMTIzNDU2Nzg5MA==').count;
  assert.equal(totalInboundCount, 1, 'Only one inbound message record should exist for wa_message_id');
  console.log('✓ Duplicate webhook delivery prevented duplicate processing and replies.');

  // TEST 5: Human escalation (NEEDS_HUMAN)
  console.log('\n[Test 5] Testing Human Escalation (NEEDS_HUMAN)...');
  const escalationMessage = {
    message: {
      from: '919876543210',
      id: 'wamid.ESCALATE_001',
      timestamp: '1732450100',
      text: { body: 'I am very angry and I want a full refund immediately!' },
      type: 'text'
    },
    contactName: 'Karthik Raja'
  };

  const mockEscalationAi = {
    generateReply: async () => ({
      reply: 'I understand your concern and sincerely apologize. I am escalating your request to our manager immediately.',
      lead: null,
      needs_human: true
    })
  };

  const escalationResult = await processIncomingMessage(escalationMessage, {
    db,
    ai: mockEscalationAi,
    wa: mockWa
  });

  assert.equal(escalationResult.needsHuman, true);
  const updatedConv = db.prepare('SELECT state FROM conversations WHERE wa_id = ?').get('919876543210');
  assert.equal(updatedConv.state, 'NEEDS_HUMAN', 'Conversation state should be updated to NEEDS_HUMAN');
  console.log('✓ Conversation successfully marked as NEEDS_HUMAN on sensitive / frustrated request.');

  // TEST 6: Non-text message ignoring
  console.log('\n[Test 6] Testing Non-text Message Handling...');
  const imageMessage = {
    message: {
      from: '919876543210',
      id: 'wamid.IMAGE_002',
      timestamp: '1732450200',
      type: 'image'
    },
    contactName: 'Karthik Raja'
  };

  const nonTextResult = await processIncomingMessage(imageMessage, { db, ai: mockAi, wa: mockWa });
  assert.equal(nonTextResult.status, 'ignored');
  assert.equal(nonTextResult.reason, 'non_text');
  console.log('✓ Non-text messages are safely ignored without errors.');

  console.log('\n=========================================');
  console.log('ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log('=========================================');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
