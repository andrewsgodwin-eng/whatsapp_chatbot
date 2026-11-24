/**
 * WhatsApp Chatbot Backend Server
 */

import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { loadKnowledgeBase } from './kb.js';
import { verifyWebhook, handleWebhookPost } from './webhook.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Body parser
app.use(express.json());

// 1. Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// 2. Meta WhatsApp Webhook endpoints
app.get('/webhook', verifyWebhook);
app.post('/webhook', handleWebhookPost);

// Fallback 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start server if executed directly
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  try {
    // Initialize DB and Knowledge Base
    getDb();
    loadKnowledgeBase();
    console.log('[Init] Database and Knowledge Base initialized.');

    const server = app.listen(PORT, () => {
      console.log(`[Server] WhatsApp Chatbot backend listening on port ${PORT}`);
    });

    const shutdown = () => {
      console.log('\n[Server] Gracefully shutting down...');
      server.close(() => {
        try {
          const db = getDb();
          db.close();
          console.log('[DB] Connection closed.');
        } catch {
          // ignore
        }
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('[Startup Error] Failed to start server:', error);
    process.exit(1);
  }
}

export default app;
