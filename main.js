const { app, BrowserWindow, ipcMain } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const os = require('os');

require('dotenv').config({ path: path.join(__dirname, '.env') });

let mainWindow;
let pollInterval;

// pid -> { lastCpuTime, highCpuSince, lastPollTime, name }
const processHistory = new Map();

const POLL_MS = 5000;
const HIGH_CPU_THRESHOLD = 10;      // % CPU to be considered "high"
const HANG_DURATION_MS = 10 * 60 * 1000; // 10 minutes continuous high CPU
const NUM_CORES = os.cpus().length;

// ── Process collection ─────────────────────────────────────────────────────

function parsePsAux(stdout) {
  const lines = stdout.trim().split('\n').slice(1); // skip header
  return lines.flatMap(line => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 11) return [];
    const [user, pid, cpu, mem, vsz, rss, , stat, start, time, ...cmd] = parts;

    // TIME format: MM:SS or HH:MM:SS
    const timeParts = time.split(':').map(Number);
    const cpuTimeSec = timeParts.length === 3
      ? timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2]
      : timeParts[0] * 60 + (timeParts[1] || 0);

    return [{
      pid: parseInt(pid),
      user,
      cpu: parseFloat(cpu),
      mem: parseFloat(mem),
      rss: parseInt(rss),
      stat,
      start,
      cpuTime: cpuTimeSec,
      command: cmd.join(' ').substring(0, 100),
    }];
  });
}

function parsePowerShell(stdout) {
  let data;
  try {
    data = JSON.parse(stdout);
    if (!Array.isArray(data)) data = [data];
  } catch {
    return [];
  }
  return data.flatMap(p => {
    if (!p || !p.Id) return [];
    return [{
      pid: p.Id,
      user: '',
      cpu: 0,                                 // computed via delta below
      mem: 0,
      rss: Math.round((p.WorkingSet || 0) / 1024),
      stat: 'R',
      start: p.StartTime || '',
      cpuTime: typeof p.CPU === 'number' ? p.CPU : 0,
      command: p.ProcessName || '',
    }];
  });
}

function getProcesses() {
  return new Promise((resolve, reject) => {
    if (os.platform() === 'win32') {
      const cmd = [
        'powershell', '-NoProfile', '-NonInteractive', '-Command',
        '"Get-Process | Select-Object Id,ProcessName,',
        '@{N=\'CPU\';E={[math]::Round($_.CPU,3)}},WorkingSet,StartTime',
        '| ConvertTo-Json -Compress -Depth 2"',
      ].join(' ');
      exec(cmd, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(parsePowerShell(stdout));
      });
    } else {
      exec('ps aux', { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(parsePsAux(stdout));
      });
    }
  });
}

// ── Hang detection ─────────────────────────────────────────────────────────

function detectHanging(processes) {
  const now = Date.now();
  const currentPids = new Set();

  const annotated = processes.map(proc => {
    currentPids.add(proc.pid);

    let hist = processHistory.get(proc.pid);
    if (!hist) {
      hist = { lastCpuTime: proc.cpuTime, highCpuSince: null, lastPollTime: now, name: proc.command };
      processHistory.set(proc.pid, hist);
    }

    // On Windows, derive CPU% from delta
    if (os.platform() === 'win32') {
      const elapsed = (now - hist.lastPollTime) / 1000 || POLL_MS / 1000;
      const delta = Math.max(0, proc.cpuTime - hist.lastCpuTime);
      proc.cpu = Math.min(100 * NUM_CORES, (delta / elapsed / NUM_CORES) * 100);
    }

    hist.lastCpuTime = proc.cpuTime;
    hist.lastPollTime = now;
    hist.name = proc.command;

    // Track continuous high-CPU window
    if (proc.cpu >= HIGH_CPU_THRESHOLD) {
      if (!hist.highCpuSince) hist.highCpuSince = now;
    } else {
      hist.highCpuSince = null;
    }

    const hanging = hist.highCpuSince !== null && (now - hist.highCpuSince) >= HANG_DURATION_MS;
    const hangDurationMs = hanging ? (now - hist.highCpuSince) : 0;

    return { ...proc, hanging, hangDurationMs };
  });

  // Remove stale pids from history
  for (const pid of processHistory.keys()) {
    if (!currentPids.has(pid)) processHistory.delete(pid);
  }

  return annotated;
}

// ── Polling loop ───────────────────────────────────────────────────────────

async function poll() {
  try {
    const raw = await getProcesses();
    const processes = detectHanging(raw);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('process-update', processes);
    }
  } catch (err) {
    console.error('[poll]', err.message);
  }
}

// ── Window ─────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0e1a',
    title: 'SentinelWatch',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ── IPC handlers ──────────────────────────────────────────────────────────

ipcMain.handle('kill-process', async (_evt, pid) => {
  return new Promise(resolve => {
    const cmd = os.platform() === 'win32' ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`;
    exec(cmd, err => resolve({ success: !err, error: err?.message }));
  });
});

// Diagnose via Groq (OpenAI-compatible chat-completions). Built-in fetch on Node 18+;
// no extra deps needed.
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

ipcMain.handle('diagnose-process', async (_evt, info) => {
  if (!process.env.GROQ_API_KEY) {
    return { success: false, error: 'GROQ_API_KEY not set in .env' };
  }
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

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
    `- Platform: ${os.platform()} (${os.arch()}, ${NUM_CORES} cores)`;

  try {
    const resp = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
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
      return { success: false, error: `Groq ${resp.status}: ${errBody.slice(0, 200)}` };
    }

    const data = await resp.json();
    const diagnosis = data?.choices?.[0]?.message?.content;
    if (!diagnosis) {
      return { success: false, error: 'Groq returned no content' };
    }
    return { success: true, diagnosis };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── App lifecycle ─────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  poll();
  pollInterval = setInterval(poll, POLL_MS);
});

app.on('window-all-closed', () => {
  clearInterval(pollInterval);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
