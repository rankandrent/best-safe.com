import Anthropic from '@anthropic-ai/sdk';
import { MODEL, log } from './config.mjs';

let _client;
const client = () => (_client ??= new Anthropic({ maxRetries: 4, timeout: 15 * 60 * 1000 }));

const WEB_SEARCH = (maxUses) => ({ type: 'web_search_20260209', name: 'web_search', max_uses: maxUses });

/**
 * One agent turn. Streams (long outputs), optionally with server-side web search,
 * resumes `pause_turn`, and returns the final text. Refusal fallbacks are enabled
 * server-side ("default" routing) so a declined request is retried on another model.
 */
export async function ask({ agent, system, prompt, webSearch = 0, effort = 'medium', maxTokens = 32000 }) {
  const messages = [{ role: 'user', content: prompt }];
  const tools = webSearch > 0 ? [WEB_SEARCH(webSearch)] : undefined;

  for (let turn = 0; turn < 6; turn++) {
    const stream = client().beta.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort },
      system,
      messages,
      ...(tools ? { tools } : {}),
    });
    const msg = await stream.finalMessage();
    log(agent, `stop=${msg.stop_reason} in=${msg.usage.input_tokens} out=${msg.usage.output_tokens}`);

    if (msg.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: msg.content });
      continue;
    }
    if (msg.stop_reason === 'refusal') {
      throw new Error(`${agent}: model declined the request (${msg.stop_details?.category ?? 'unknown'})`);
    }
    if (msg.stop_reason === 'max_tokens') {
      throw new Error(`${agent}: output hit max_tokens (${maxTokens})`);
    }
    return msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
  throw new Error(`${agent}: too many pause_turn continuations`);
}

/** Extract the last ```json fenced block (or bare JSON) from text. */
export function extractJson(text) {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = fences.length ? fences.reverse() : [text];
  for (const c of candidates) {
    const start = c.search(/[[{]/);
    if (start === -1) continue;
    try {
      return JSON.parse(c.slice(start).trim());
    } catch {
      /* try next */
    }
  }
  throw new Error('No parseable JSON found in model output');
}

/** ask() + JSON extraction + zod validation, with one repair attempt. */
export async function askJson({ schema, ...opts }) {
  const text = await ask(opts);
  try {
    return schema.parse(extractJson(text));
  } catch (err) {
    log(opts.agent, `JSON invalid (${err.message.slice(0, 200)}), asking for a repair`);
    const fixed = await ask({
      agent: `${opts.agent}:repair`,
      system: 'You repair JSON so it matches the requested schema. Reply with a single ```json fenced block and nothing else.',
      prompt: `This output should have been valid JSON matching the schema described below, but validation failed with:\n${err.message}\n\nSchema description from the original task:\n${opts.prompt.slice(-4000)}\n\nOriginal output:\n${text}`,
      effort: 'low',
    });
    return schema.parse(extractJson(fixed));
  }
}
