// Cloudflare Worker proxy for SentinelWatch's Groq diagnosis calls.
//
// Mirrors the request/response shape of the `diagnose-process` IPC handler in
// main.js (see ../../main.js) so wiring the app to this Worker later is a
// drop-in change: POST the same `info` object here instead of calling Groq
// directly, and keep GROQ_API_KEY out of the client entirely.
//
// Secrets:
//   wrangler secret put GROQ_API_KEY
//
// Vars (wrangler.toml [vars]):
//   GROQ_MODEL     default model, e.g. "llama-3.3-70b-versatile"
//   ALLOWED_ORIGIN optional CORS allowlist ("*" or a comma-separated list)

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

function corsHeaders(env, origin) {
  const allowed = env.ALLOWED_ORIGIN || '*';
  const allowOrigin =
    allowed === '*'
      ? '*'
      : allowed.split(',').map((o) => o.trim()).includes(origin)
        ? origin
        : allowed.split(',')[0].trim();

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(env, origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'POST') {
      return json({ success: false, error: 'Method not allowed' }, 405, cors);
    }

    if (!env.GROQ_API_KEY) {
      return json({ success: false, error: 'GROQ_API_KEY not configured' }, 500, cors);
    }

    let info;
    try {
      info = await request.json();
    } catch {
      return json({ success: false, error: 'Invalid JSON body' }, 400, cors);
    }

    if (!info || typeof info !== 'object' || !info.pid || !info.command) {
      return json({ success: false, error: 'Missing required fields: pid, command' }, 400, cors);
    }

    const model = env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    const hangMins = info.hangDurationMs ? Math.round(info.hangDurationMs / 60000) : '?';

    const systemPrompt =
      'You are a senior systems engineer diagnosing a potentially hanging process. ' +
      'Answer in this exact structure (keep it under 220 words):\n' +
      '**What it is:** one sentence.\n' +
      '**Why it may be hanging:** 2–3 bullet points.\n' +
      '**Risk of killing:** Low / Medium / High — one sentence reason.\n' +
      '**Recommended action:** one clear sentence.';

    const userPrompt =
      `Process snapshot:\n` +
      `- PID: ${info.pid}\n` +
      `- Command: ${info.command}\n` +
      `- CPU%: ${Number(info.cpu).toFixed(1)}%\n` +
      `- Resident memory: ${info.rss} KB\n` +
      `- Accumulated CPU time: ${info.cpuTime}s\n` +
      `- Continuously high CPU for: ${hangMins} minutes\n` +
      `- Platform: ${info.platform || 'unknown'}`;

    try {
      const resp = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 512,
          stream: false,
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        return json({ success: false, error: `Groq ${resp.status}: ${errBody.slice(0, 200)}` }, 502, cors);
      }

      const data = await resp.json();
      const diagnosis = data?.choices?.[0]?.message?.content;
      if (!diagnosis) {
        return json({ success: false, error: 'Groq returned no content' }, 502, cors);
      }
      return json({ success: true, diagnosis }, 200, cors);
    } catch (err) {
      return json({ success: false, error: err.message }, 500, cors);
    }
  },
};
