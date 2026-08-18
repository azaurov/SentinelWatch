// Standalone HTML demo page served on GET / by index.js. Lets you try the
// Groq proxy from a browser without the SentinelWatch desktop app. Not used
// by main.js — the app only ever POSTs to this Worker.
export const DEMO_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SentinelWatch Groq Proxy — Demo</title>
<style>
  :root {
    --bg-base:      #0a0e1a;
    --bg-surface:   #0f1526;
    --bg-raised:    #161d32;
    --bg-hover:     #1c2540;
    --border:       #1e2d4a;
    --border-light: #263550;
    --text-primary:  #e2e8f8;
    --text-secondary:#7a90b8;
    --text-muted:    #4a5e80;
    --accent:       #4f8ef7;
    --accent-glow:  rgba(79,142,247,0.18);
    --ok:           #22c55e;
    --warn:         #f59e0b;
    --danger:       #ef4444;
    --danger-glow:  rgba(239,68,68,0.18);
    --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    --font-mono: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: var(--font);
    background: var(--bg-base);
    color: var(--text-primary);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    padding: 40px 20px;
  }
  .wrap { width: 100%; max-width: 640px; }
  header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .logo {
    width: 28px; height: 28px; border-radius: 7px;
    background: var(--accent-glow); color: var(--accent);
    display: flex; align-items: center; justify-content: center; font-size: 16px;
  }
  h1 { font-size: 18px; margin: 0; font-weight: 600; }
  .subtitle { color: var(--text-secondary); font-size: 13px; margin: 4px 0 28px; }
  .card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
  }
  .card h2 {
    font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-secondary); margin: 0 0 14px;
  }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  label {
    display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;
  }
  input {
    width: 100%; background: var(--bg-raised); border: 1px solid var(--border-light);
    border-radius: 8px; color: var(--text-primary); font-family: var(--font-mono);
    font-size: 13px; padding: 9px 10px; margin-bottom: 12px;
  }
  input:focus { outline: none; border-color: var(--accent); }
  .full { grid-column: 1 / -1; }
  button {
    width: 100%; background: var(--accent-glow); border: 1px solid var(--accent);
    color: var(--accent); font-weight: 600; font-size: 14px; border-radius: 8px;
    padding: 12px; cursor: pointer; transition: background 0.15s;
  }
  button:hover:not(:disabled) { background: rgba(79,142,247,0.28); }
  button:disabled { opacity: 0.6; cursor: default; }
  .result-wrap { display: none; }
  .result-wrap.show { display: block; }
  .badge {
    display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
    padding: 3px 8px; border-radius: 5px; margin-bottom: 12px;
  }
  .badge.ok { background: rgba(34,197,94,0.15); color: var(--ok); }
  .badge.err { background: var(--danger-glow); color: var(--danger); }
  .diag-line-bold { display: block; font-weight: 600; margin: 10px 0 2px; }
  .diag-bullet { display: block; padding-left: 14px; position: relative; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
  .diag-bullet::before { content: '–'; position: absolute; left: 0; }
  .diag-plain { display: block; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
  .hint { color: var(--text-muted); font-size: 12px; margin-top: 24px; line-height: 1.6; }
  .hint code { color: var(--text-secondary); background: var(--bg-raised); padding: 1px 5px; border-radius: 4px; }
  a { color: var(--accent); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="logo">&#9670;</div>
    <h1>SentinelWatch — Groq Proxy Demo</h1>
  </header>
  <p class="subtitle">
    Try the AI diagnosis endpoint the desktop app calls. This Worker holds
    <code>GROQ_API_KEY</code> as a Cloudflare secret — nothing here touches
    your key.
  </p>

  <form class="card" id="f">
    <h2>Process snapshot</h2>
    <div class="grid">
      <div>
        <label for="pid">PID</label>
        <input id="pid" value="1234" required>
      </div>
      <div>
        <label for="cpu">CPU %</label>
        <input id="cpu" value="87.3" required>
      </div>
      <div class="full">
        <label for="command">Command</label>
        <input id="command" value="node server.js" required>
      </div>
      <div>
        <label for="rss">RSS (KB)</label>
        <input id="rss" value="512000" required>
      </div>
      <div>
        <label for="cpuTime">CPU time (s)</label>
        <input id="cpuTime" value="934" required>
      </div>
      <div>
        <label for="hangDurationMs">Hang duration (ms)</label>
        <input id="hangDurationMs" value="660000" required>
      </div>
      <div>
        <label for="platform">Platform</label>
        <input id="platform" value="linux (x64, 8 cores)" required>
      </div>
    </div>
    <button type="submit" id="btn">Diagnose with AI</button>
  </form>

  <div class="card result-wrap" id="resultWrap">
    <h2>Result</h2>
    <div id="result"></div>
  </div>

  <p class="hint">
    This page only calls this Worker's own <code>POST /</code> endpoint —
    same contract <code>main.js</code> in the
    <a href="https://github.com/azaurov/SentinelWatch" target="_blank" rel="noopener">SentinelWatch</a>
    desktop app uses.
  </p>
</div>
<script>
function formatDiagnosis(text) {
  return text
    .split('\\n')
    .map(function (line) {
      line = line
        .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
        .replace(/^[-•]\\s+/, '');
      if (/^\\*\\*/.test(line.trim()) || line.trim().indexOf('<strong>') === 0) {
        return '<span class="diag-line-bold">' + line + '</span>';
      }
      if (line.trim().indexOf('-') === 0 || line.trim().indexOf('•') === 0) {
        return '<span class="diag-bullet">' + line.replace(/^[-•]\\s*/, '') + '</span>';
      }
      return '<span class="diag-plain">' + line + '</span>';
    })
    .join('');
}

document.getElementById('f').addEventListener('submit', async function (e) {
  e.preventDefault();
  var btn = document.getElementById('btn');
  var resultWrap = document.getElementById('resultWrap');
  var result = document.getElementById('result');

  btn.disabled = true;
  btn.textContent = 'Diagnosing…';
  resultWrap.classList.remove('show');

  var body = {
    pid: Number(document.getElementById('pid').value),
    command: document.getElementById('command').value,
    cpu: Number(document.getElementById('cpu').value),
    rss: Number(document.getElementById('rss').value),
    cpuTime: Number(document.getElementById('cpuTime').value),
    hangDurationMs: Number(document.getElementById('hangDurationMs').value),
    platform: document.getElementById('platform').value,
  };

  try {
    var resp = await fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var data = await resp.json();
    if (data.success) {
      result.innerHTML = '<span class="badge ok">SUCCESS</span><div>' + formatDiagnosis(data.diagnosis) + '</div>';
    } else {
      result.innerHTML = '<span class="badge err">ERROR</span><div class="diag-plain">' + data.error + '</div>';
    }
  } catch (err) {
    result.innerHTML = '<span class="badge err">ERROR</span><div class="diag-plain">' + err.message + '</div>';
  }

  resultWrap.classList.add('show');
  btn.disabled = false;
  btn.textContent = 'Diagnose with AI';
});
</script>
</body>
</html>
`;
