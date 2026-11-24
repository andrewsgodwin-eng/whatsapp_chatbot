/**
 * End-to-end HTTP Server Tests
 */

import assert from 'node:assert/strict';
import app from '../src/server.js';
import { getDb } from '../src/db.js';

process.env.VERIFY_TOKEN = 'test_http_verify_token';

async function runHttpTests() {
  console.log('--- STARTING HTTP SERVER ENDPOINT TESTS ---');

  const server = app.listen(0); // random available port
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /health
    console.log('[HTTP Test 1] Testing GET /health...');
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.deepEqual(healthData, { status: 'ok' });
    console.log('✓ GET /health returns 200 { status: "ok" }');

    // 2. GET /webhook verify failure
    console.log('[HTTP Test 2] Testing GET /webhook unauthorized...');
    const invalidGetRes = await fetch(`${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123`);
    assert.equal(invalidGetRes.status, 403);
    console.log('✓ GET /webhook returns 403 for wrong token');

    // 3. GET /webhook verify success
    console.log('[HTTP Test 3] Testing GET /webhook success...');
    const validGetRes = await fetch(`${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=test_http_verify_token&hub.challenge=test_challenge_12345`);
    assert.equal(validGetRes.status, 200);
    const challengeText = await validGetRes.text();
    assert.equal(challengeText, 'test_challenge_12345');
    console.log('✓ GET /webhook returns 200 with challenge text');

    // 4. POST /webhook immediate 200 response
    console.log('[HTTP Test 4] Testing POST /webhook immediate response...');
    const postPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123456',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                contacts: [{ profile: { name: 'Priya' }, wa_id: '919123456789' }],
                messages: [
                  {
                    from: '919123456789',
                    id: `wamid.HTTP_TEST_${Date.now()}`,
                    timestamp: `${Math.floor(Date.now() / 1000)}`,
                    type: 'text',
                    text: { body: 'What are your bridal makeover charges?' }
                  }
                ]
              },
              field: 'messages'
            }
          ]
        }
      ]
    };

    const postRes = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postPayload)
    });
    assert.equal(postRes.status, 200);
    const postResText = await postRes.text();
    assert.equal(postResText, 'EVENT_RECEIVED');
    console.log('✓ POST /webhook immediately returns 200 EVENT_RECEIVED');

    // 5. 404 endpoint test
    console.log('[HTTP Test 5] Testing 404 handler...');
    const notFoundRes = await fetch(`${baseUrl}/unknown-route`);
    assert.equal(notFoundRes.status, 404);
    console.log('✓ Non-existent route returns 404');

    console.log('\n=========================================');
    console.log('ALL HTTP SERVER TESTS PASSED SUCCESSFULLY!');
    console.log('=========================================');
  } finally {
    server.close();
  }
}

runHttpTests().catch((err) => {
  console.error('HTTP tests failed:', err);
  process.exit(1);
});
