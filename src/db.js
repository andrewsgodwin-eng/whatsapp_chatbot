import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbInstance = null;

/**
 * Initializes and returns the SQLite database connection.
 * @param {string} [customPath] - Optional custom path for database (e.g. ':memory:' for tests)
 * @returns {Database.Database} SQLite database instance
 */
export function getDb(customPath) {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  let dbPath = customPath;
  if (!dbPath) {
    const dataDir = path.resolve(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    dbPath = path.join(dataDir, 'bot.db');
  }

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  initSchema(db);

  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

/**
 * Creates tables and indexes if they do not exist.
 * @param {Database.Database} db
 */
export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT UNIQUE NOT NULL,
      name TEXT,
      state TEXT DEFAULT 'chatting',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      wa_message_id TEXT UNIQUE,
      direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
      body TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      name TEXT,
      requirement TEXT,
      city TEXT,
      preferred_callback_time TEXT,
      status TEXT DEFAULT 'new',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_wa_id ON conversations(wa_id);
    CREATE INDEX IF NOT EXISTS idx_messages_wa_msg_id ON messages(wa_message_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_leads_conv_id ON leads(conversation_id);
  `);
}

/**
 * Retrieves an existing conversation by WhatsApp ID or creates a new one.
 * @param {string} waId
 * @param {string} [name]
 * @param {Database.Database} [db]
 * @returns {object} conversation record
 */
export function getOrCreateConversation(waId, name = null, db = getDb()) {
  const selectStmt = db.prepare('SELECT * FROM conversations WHERE wa_id = ?');
  let conv = selectStmt.get(waId);

  if (!conv) {
    const insertStmt = db.prepare(`
      INSERT INTO conversations (wa_id, name, state, created_at, updated_at)
      VALUES (?, ?, 'chatting', datetime('now'), datetime('now'))
    `);
    const info = insertStmt.run(waId, name);
    conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
  } else if (name && !conv.name) {
    db.prepare('UPDATE conversations SET name = ?, updated_at = datetime(\'now\') WHERE id = ?').run(name, conv.id);
    conv.name = name;
  }

  return conv;
}

/**
 * Checks if an inbound WhatsApp message ID has already been recorded.
 * @param {string} waMessageId
 * @param {Database.Database} [db]
 * @returns {boolean}
 */
export function isMessageProcessed(waMessageId, db = getDb()) {
  if (!waMessageId) return false;
  const row = db.prepare('SELECT id FROM messages WHERE wa_message_id = ?').get(waMessageId);
  return Boolean(row);
}

/**
 * Saves an inbound WhatsApp message.
 * @param {object} params
 * @param {number} params.conversationId
 * @param {string} params.waMessageId
 * @param {string} params.body
 * @param {Database.Database} [db]
 * @returns {object} created message record
 */
export function saveInboundMessage({ conversationId, waMessageId, body }, db = getDb()) {
  const stmt = db.prepare(`
    INSERT INTO messages (conversation_id, wa_message_id, direction, body, created_at)
    VALUES (?, ?, 'inbound', ?, datetime('now'))
  `);
  const info = stmt.run(conversationId, waMessageId, body);
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
}

/**
 * Saves an outbound WhatsApp reply message.
 * @param {object} params
 * @param {number} params.conversationId
 * @param {string} params.body
 * @param {Database.Database} [db]
 * @returns {object} created message record
 */
export function saveOutboundMessage({ conversationId, body }, db = getDb()) {
  const stmt = db.prepare(`
    INSERT INTO messages (conversation_id, direction, body, created_at)
    VALUES (?, 'outbound', ?, datetime('now'))
  `);
  const info = stmt.run(conversationId, body);
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
}

/**
 * Updates conversation state (e.g. 'chatting', 'NEEDS_HUMAN').
 * @param {number} conversationId
 * @param {string} state
 * @param {Database.Database} [db]
 */
export function updateConversationState(conversationId, state, db = getDb()) {
  db.prepare(`
    UPDATE conversations
    SET state = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(state, conversationId);
}

/**
 * Retrieves the recent messages for conversation context (up to limit).
 * Returned in ascending chronological order.
 * @param {number} conversationId
 * @param {number} [limit=10]
 * @param {Database.Database} [db]
 * @returns {Array<object>}
 */
export function getRecentMessages(conversationId, limit = 10, db = getDb()) {
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY id DESC
      LIMIT ?
    ) ORDER BY id ASC
  `).all(conversationId, limit);
  return rows;
}

/**
 * Upserts lead details associated with a conversation.
 * @param {number} conversationId
 * @param {object} leadData
 * @param {string|null} [leadData.name]
 * @param {string|null} [leadData.requirement]
 * @param {string|null} [leadData.city]
 * @param {string|null} [leadData.preferred_callback_time]
 * @param {Database.Database} [db]
 * @returns {object|null} lead record
 */
export function upsertLead(conversationId, leadData, db = getDb()) {
  if (!leadData) return null;

  const { name, requirement, city, preferred_callback_time } = leadData;
  const hasValues = name || requirement || city || preferred_callback_time;
  if (!hasValues) return null;

  const existingLead = db.prepare('SELECT * FROM leads WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conversationId);

  if (existingLead) {
    const updatedName = name ?? existingLead.name;
    const updatedReq = requirement ?? existingLead.requirement;
    const updatedCity = city ?? existingLead.city;
    const updatedTime = preferred_callback_time ?? existingLead.preferred_callback_time;

    db.prepare(`
      UPDATE leads
      SET name = ?, requirement = ?, city = ?, preferred_callback_time = ?
      WHERE id = ?
    `).run(updatedName, updatedReq, updatedCity, updatedTime, existingLead.id);

    return db.prepare('SELECT * FROM leads WHERE id = ?').get(existingLead.id);
  }

  const insertStmt = db.prepare(`
    INSERT INTO leads (conversation_id, name, requirement, city, preferred_callback_time, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'new', datetime('now'))
  `);
  const info = insertStmt.run(
    conversationId,
    name || null,
    requirement || null,
    city || null,
    preferred_callback_time || null
  );

  return db.prepare('SELECT * FROM leads WHERE id = ?').get(info.lastInsertRowid);
}

/**
 * Gets the latest lead for a conversation.
 * @param {number} conversationId
 * @param {Database.Database} [db]
 * @returns {object|null}
 */
export function getLead(conversationId, db = getDb()) {
  return db.prepare('SELECT * FROM leads WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conversationId) || null;
}
