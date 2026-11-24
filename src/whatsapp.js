/**
 * WhatsApp Cloud API Client
 */

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

/**
 * Mask sensitive string (e.g. phone number) for logs.
 * @param {string} str
 * @returns {string}
 */
export function maskIdentifier(str) {
  if (!str || typeof str !== 'string') return '***';
  if (str.length <= 4) return '***';
  return `***${str.slice(-4)}`;
}

/**
 * Helper to execute fetch with retry on transient/idempotent errors.
 * @param {string} url
 * @param {object} options
 * @param {number} [maxRetries=2]
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options, maxRetries = 2) {
  let attempt = 0;
  let delay = 500;

  while (attempt <= maxRetries) {
    try {
      const response = await fetch(url, options);

      // Safe, transient HTTP status codes to retry
      const isTransient = response.status === 429 || (response.status >= 500 && response.status <= 504);

      if (!isTransient || attempt === maxRetries) {
        return response;
      }

      console.warn(`[WhatsApp API] Transient HTTP ${response.status}. Retrying attempt ${attempt + 1}/${maxRetries}...`);
    } catch (err) {
      if (attempt === maxRetries) {
        throw err;
      }
      console.warn(`[WhatsApp API] Network error (${err.message}). Retrying attempt ${attempt + 1}/${maxRetries}...`);
    }

    attempt++;
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay *= 2;
  }
}

/**
 * Sends a text message to a WhatsApp user.
 * @param {string} to - Recipient phone number / WhatsApp ID
 * @param {string} text - Message text body
 * @param {object} [config] - Optional overrides for testing
 * @returns {Promise<object>} Parsed API response
 */
export async function sendText(to, text, config = {}) {
  const token = config.token || process.env.WHATSAPP_TOKEN;
  const phoneNumberId = config.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const baseUrl = config.baseUrl || GRAPH_API_BASE;

  if (!token || !phoneNumberId) {
    throw new Error('WhatsApp API configuration missing: WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not set.');
  }

  const endpoint = `${baseUrl}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text }
  };

  const response = await fetchWithRetry(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorDetails = data?.error?.message || response.statusText;
    const errorCode = data?.error?.code || response.status;
    console.error(`[WhatsApp API Error] Status ${response.status}, Code: ${errorCode}, Details: ${errorDetails}`);
    throw new Error(`WhatsApp API error (${errorCode}): ${errorDetails}`);
  }

  console.log(`[WhatsApp API] Message sent successfully to ${maskIdentifier(to)}`);
  return data;
}

/**
 * Marks an inbound message as read.
 * @param {string} messageId - Inbound WhatsApp message ID
 * @param {object} [config] - Optional overrides for testing
 * @returns {Promise<object>} Parsed API response
 */
export async function markMessageAsRead(messageId, config = {}) {
  const token = config.token || process.env.WHATSAPP_TOKEN;
  const phoneNumberId = config.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const baseUrl = config.baseUrl || GRAPH_API_BASE;

  if (!token || !phoneNumberId || !messageId) {
    return { success: false };
  }

  const endpoint = `${baseUrl}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId
  };

  try {
    const response = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn(`[WhatsApp API] Failed to mark message read. HTTP ${response.status}`);
      return { success: false, status: response.status };
    }
    return data;
  } catch (error) {
    console.warn(`[WhatsApp API] Non-critical error marking message read: ${error.message}`);
    return { success: false, error: error.message };
  }
}
