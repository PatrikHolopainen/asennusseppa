#!/usr/bin/env node
/**
 * caption-images.js
 * Reads a folder of photos, sends each to OpenAI vision, and outputs
 * captions + placement suggestions for the AsennusSeppä website.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node caption-images.js ./photos
 *
 * Output:
 *   captions.json   – machine-readable results
 *   captions.txt    – human-readable summary
 *
 * Requirements:
 *   npm install openai
 */

const fs   = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const SYSTEM_PROMPT = `You are helping caption images for a Finnish small business website.
The company is AsennusSeppä – they install, sell and service heat pumps (lämpöpumput),
and also do renovation work, cottage handyman jobs and maintenance painting.
Brands they represent: Mitsubishi Electric, Gree, Toshiba, Wilfa.
Location: Forssa, Finland.

For each image you receive, respond with a JSON object (no markdown, just raw JSON):
{
  "caption_fi": "<short Finnish caption for use on the website, max 10 words>",
  "caption_en": "<same caption in English>",
  "description": "<1-2 sentence description of what is in the image>",
  "section": "<which website section best fits this image: hero | services | gallery | yritys | contact | other>",
  "confidence": "<high | medium | low>"
}`;

async function captionImage(client, filePath) {
  const ext  = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png'
             : ext === '.webp' ? 'image/webp'
             : ext === '.gif'  ? 'image/gif'
             : 'image/jpeg';

  const data   = fs.readFileSync(filePath);
  const base64 = data.toString('base64');

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 300,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Caption this image for the AsennusSeppä website.' },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}`, detail: 'low' } }
        ]
      }
    ]
  });

  const text = response.choices[0].message.content.trim();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, parse_error: true };
  }
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Error: OPENAI_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node caption-images.js <path-to-photos-folder>');
    process.exit(1);
  }

  const absDir = path.resolve(dir);
  if (!fs.existsSync(absDir)) {
    console.error(`Folder not found: ${absDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(absDir)
    .filter(f => SUPPORTED_EXTS.has(path.extname(f).toLowerCase()))
    .map(f => path.join(absDir, f));

  if (files.length === 0) {
    console.error('No supported image files found (jpg, jpeg, png, webp, gif).');
    process.exit(1);
  }

  const client = new OpenAI({ apiKey });
  const results = [];

  console.log(`Found ${files.length} image(s). Processing...\n`);

  for (const filePath of files) {
    const filename = path.basename(filePath);
    process.stdout.write(`  ${filename} ... `);
    try {
      const caption = await captionImage(client, filePath);
      results.push({ filename, ...caption });
      console.log(caption.caption_en || '(see captions.json)');
    } catch (err) {
      results.push({ filename, error: err.message });
      console.log(`ERROR: ${err.message}`);
    }
  }

  // Write JSON
  const jsonOut = path.join(absDir, 'captions.json');
  fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2), 'utf8');

  // Write human-readable text
  const lines = results.map(r => {
    if (r.error) return `${r.filename}\n  ERROR: ${r.error}`;
    if (r.parse_error) return `${r.filename}\n  RAW: ${r.raw}`;
    return [
      r.filename,
      `  FI:          ${r.caption_fi}`,
      `  EN:          ${r.caption_en}`,
      `  Description: ${r.description}`,
      `  Section:     ${r.section}`,
      `  Confidence:  ${r.confidence}`,
    ].join('\n');
  });
  const txtOut = path.join(absDir, 'captions.txt');
  fs.writeFileSync(txtOut, lines.join('\n\n'), 'utf8');

  console.log(`\nDone! Results saved to:\n  ${jsonOut}\n  ${txtOut}`);
}

main();
