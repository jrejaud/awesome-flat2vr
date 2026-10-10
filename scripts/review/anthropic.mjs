// Minimal Anthropic Messages API client — forces a single structured tool call and returns its
// validated input. No SDK dependency (keeps the repo's devDeps unchanged and the Action fast).

const API = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

export async function runReview({ apiKey, model, prompt, tool, maxTokens = 1024, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const res = await fetchImpl(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  const block = (data.content ?? []).find((b) => b.type === 'tool_use' && b.name === tool.name);
  if (!block) throw new Error('Model did not return the expected tool call');
  return block.input;
}
