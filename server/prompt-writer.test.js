import assert from 'node:assert/strict';
import test from 'node:test';
import { createPromptWriter, parseWrittenPrompts, promptWriterSettings, writerGuide } from './prompt-writer.js';

const settings = (url) => ({ STUDIO_PROMPT_WRITER_URL: url, STUDIO_PROMPT_WRITER_KEY: 'fixture-key', STUDIO_PROMPT_WRITER_MODEL: 'ai/text-quick' });

test('prompt writer settings are all or nothing and name an OpenAI-compatible endpoint', () => {
  assert.equal(promptWriterSettings({}), null);
  assert.throws(() => promptWriterSettings({ STUDIO_PROMPT_WRITER_KEY: 'fixture-key' }), /needs STUDIO_PROMPT_WRITER_URL, STUDIO_PROMPT_WRITER_MODEL/);
  assert.throws(() => promptWriterSettings(settings('ftp://writer.invalid')), /absolute HTTP\(S\) URL/);
  assert.throws(() => promptWriterSettings(settings('http://user:secret@writer.invalid')), /without credentials/);
  for (const [url, endpoint] of [
    ['http://litellm.invalid:4000', 'http://litellm.invalid:4000/v1/chat/completions'],
    ['http://litellm.invalid:4000/v1/', 'http://litellm.invalid:4000/v1/chat/completions'],
    ['https://writer.invalid/api/v1/chat/completions', 'https://writer.invalid/api/v1/chat/completions']
  ]) assert.equal(promptWriterSettings(settings(url)).endpoint, endpoint);
});

test('written prompts parse from JSON, fenced JSON or plain text, without thinking', () => {
  assert.deepEqual(parseWrittenPrompts('{"prompts": ["A", " B  c "]}', 2), ['A', 'B c']);
  assert.deepEqual(parseWrittenPrompts('<think>hmm</think>\n```json\n["A"]\n```', 1), ['A']);
  assert.deepEqual(parseWrittenPrompts('A cabin at dusk.', 1), ['A cabin at dusk.']);
  assert.deepEqual(parseWrittenPrompts('{"prompts": ["A"]}', 3), ['A', 'A', 'A']);
  assert.equal(parseWrittenPrompts('A cabin.', 2), null, 'plain text is one prompt only');
  assert.equal(parseWrittenPrompts('{"prompts": []}', 1), null);
  assert.equal(parseWrittenPrompts('', 1), null);
});

test('the writer guide drops sources, review dates and sampling at every level', () => {
  const guide = JSON.parse(writerGuide({ summary: 'S', sources: ['x'], reviewed_on: 'd', sampling: { steps: 8 }, mode: { id: 'm', rules: ['R'], sources: ['y'] } }));
  assert.deepEqual(guide, { summary: 'S', mode: { id: 'm', rules: ['R'] } });
});

test('the writer logs timings without prompt text and falls back on failure', async () => {
  const lines = [];
  const log = { info: line => lines.push(line), warn: line => lines.push(line) };
  const profile = { id: 'fixture', label: 'Fixture', kind: 'image' };
  const ok = createPromptWriter(settings('http://writer.invalid'), { log, fetchImpl: async () => Response.json({ choices: [{ message: { content: '{"prompts":["secret scene"]}' } }] }) });
  assert.deepEqual((await ok.write({ profile, request: 'secret request', fallback: ['secret request'] })).prompts, ['secret scene']);
  const down = createPromptWriter(settings('http://writer.invalid'), { log, fetchImpl: async () => new Response('', { status: 401 }) });
  assert.deepEqual(await down.write({ profile, request: 'secret request', fallback: ['secret request'] }).then(({ prompts, source }) => [prompts, source]), [['secret request'], 'request']);
  assert.match(lines[0], /^MCP prompt writer: 1 prompt for fixture in \d+ ms$/);
  assert.match(lines[1], /fell back to the request for fixture after \d+ ms: HTTP 401$/);
  assert.doesNotMatch(lines.join('\n'), /secret/);
});
