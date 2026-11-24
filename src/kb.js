import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KB_PATH = path.resolve(__dirname, '../data/kb.md');

let cachedKb = null;

/**
 * Loads the local knowledge base markdown file into memory.
 * @returns {string} Knowledge base text content
 */
export function loadKnowledgeBase() {
  try {
    cachedKb = fs.readFileSync(KB_PATH, 'utf-8');
    return cachedKb;
  } catch (error) {
    console.error('Failed to read knowledge base from:', KB_PATH, error.message);
    return '';
  }
}

/**
 * Retrieves the cached knowledge base or loads it if not already cached.
 * @returns {string} Knowledge base text content
 */
export function getKnowledgeBase() {
  if (cachedKb === null) {
    return loadKnowledgeBase();
  }
  return cachedKb;
}
