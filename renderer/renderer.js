'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let allProcesses = [];
let selectedPid  = null;
let currentFilter = 'all';
let searchQuery   = '';
let sortKey       = 'cpu';

// ── DOM refs ───────────────────────────────────────────────────────────────
const tbody        = document.getElementById('process-tbody');
const searchInput  = document.getElementById('search-input');
const clearBtn     = document.getElementById('clear-search');
const sortSelect   = document.getElementById('sort-select');
const filterBtns   = document.querySelectorAll('.filter-btn');
const detailPanel  = document.getElementById('detail-panel');
const killOverlay  = document.getElementById('kill-overlay');

// Stats
const totalCountEl  = document.getElementById('total-count');
const hangingCountEl= document.getElementById('hanging-count');
const avgCpuEl      = document.getElementById('avg-cpu');
const topRssEl      = document.getElementById('top-rss');
const updateTimeEl  = document.getElementById('update-time');

// Detail panel
const dBadge    = document.getElementById('d-badge');
const dTitle    = document.getElementById('d-title');
const dPid      = document.getElementById('d-pid');
const dCpu      = document.getElementById('d-cpu');
const dRss      = document.getElementById('d-rss');
const dCpuTime  = document.getElementById('d-cputime');
const dUser     = document.getElementById('d-user');
const dHang     = document.getElementById('d-hang');
const dHangItem = document.getElementById('hang-item');
const dCommand  = document.getElementById('d-command');
const diagWrap  = document.getElementById('diagnosis-wrap');
const diagBody  = document.getElementById('diagnosis-body');
const diagError = document.getElementById('diagnosis-error');
const btnDiag   = document.getElementById('btn-diagnose');
const btnKill   = document.getElementById('btn-kill');

// Confirm overlay
const confirmDesc   = document.getElementById('confirm-desc');
const confirmKill   = document.getElementById('confirm-kill');
const confirmCancel = document.getElementById('confirm-cancel');

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtCpuTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtRss(kb) {
  if (kb >= 1024 * 1024) return (kb / 1024 / 1024).toFixed(1) + ' GB';
  if (kb >= 1024)        return (kb / 1024).toFixed(0) + ' MB';
  return kb + ' KB';
}

function fmtHang(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function statusOf(p) {
  if (p.hanging)       return 'hanging';
  if (p.cpu >= 10)     return 'high';
  return 'ok';
}

function cpuColorClass(pct) {
  if (pct >= 70) return 'cpu-danger';
  if (pct >= 20) return 'cpu-warn';
  return 'cpu-ok';
}

// ── Filtering & sorting ────────────────────────────────────────────────────
function filteredSorted() {
  let list = allProcesses;

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(p =>
      p.command.toLowerCase().includes(q) ||
      String(p.pid).includes(q)
    );
  }

  if (currentFilter === 'hanging') list = list.filter(p => p.hanging);
  if (currentFilter === 'high')    list = list.filter(p => p.cpu >= 10);

  list = [...list].sort((a, b) => {
    switch (sortKey) {
      case 'cpu':     return b.cpu     - a.cpu;
      case 'rss':     return b.rss     - a.rss;
      case 'pid':     return a.pid     - b.pid;
      case 'cpuTime': return b.cpuTime - a.cpuTime;
      case 'command': return a.command.localeCompare(b.command);
      default:        return 0;
    }
  });

  return list;
}

// ── Render table ───────────────────────────────────────────────────────────
function renderTable() {
  const list = filteredSorted();

  if (!list.length) {
    tbody.innerHTML = '<tr class="placeholder-row"><td colspan="7">No matching processes.</td></tr>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const p of list) {
    const status = statusOf(p);
    const cpuPct = Math.min(100, p.cpu).toFixed(1);
    const barPct = Math.min(100, p.cpu);

    const tr = document.createElement('tr');
    if (p.pid === selectedPid) tr.classList.add('selected');

    tr.innerHTML = `
      <td class="col-status">
        <span class="row-badge badge-${status}">
          <span class="dot dot-${status}"></span>
          ${status === 'hanging' ? 'HANGING' : status === 'high' ? 'HIGH' : 'OK'}
        </span>
      </td>
      <td class="col-pid">${p.pid}</td>
      <td class="col-name" title="${escHtml(p.command)}">${escHtml(truncate(p.command, 48))}</td>
      <td class="col-cpu">
        <div class="cpu-bar-wrap">
          <span>${cpuPct}%</span>
          <div class="cpu-bar">
            <div class="cpu-bar-fill ${cpuColorClass(p.cpu)}" style="width:${barPct}%"></div>
          </div>
        </div>
      </td>
      <td class="col-mem">${fmtRss(p.rss)}</td>
      <td class="col-time">${fmtCpuTime(p.cpuTime)}</td>
      <td class="col-user">${escHtml(p.user || '—')}</td>
    `;

    tr.addEventListener('click', () => selectProcess(p));
    fragment.appendChild(tr);
  }

  tbody.innerHTML = '';
  tbody.appendChild(fragment);
}

// ── Stats bar ──────────────────────────────────────────────────────────────
function updateStats() {
  const hanging = allProcesses.filter(p => p.hanging).length;
  const avgCpu  = allProcesses.length
    ? (allProcesses.reduce((s, p) => s + p.cpu, 0) / allProcesses.length).toFixed(1)
    : 0;
  const topRss  = allProcesses.length
    ? Math.max(...allProcesses.map(p => p.rss))
    : 0;

  totalCountEl.textContent  = allProcesses.length;
  hangingCountEl.textContent = hanging;
  avgCpuEl.textContent      = avgCpu + '%';
  topRssEl.textContent      = fmtRss(topRss);

  const now = new Date();
  updateTimeEl.textContent = now.toLocaleTimeString();
}

// ── Process selection / detail panel ──────────────────────────────────────
function updateDetailStats(p) {
  const status = statusOf(p);
  dBadge.className   = `detail-status-badge badge-${status}`;
  dBadge.textContent = status === 'hanging' ? '⚠ HANGING' : status === 'high' ? '▲ HIGH CPU' : '● OK';

  dTitle.textContent   = p.command || '—';
  dPid.textContent     = `PID ${p.pid}`;
  dCpu.textContent     = p.cpu.toFixed(1) + '%';
  dRss.textContent     = fmtRss(p.rss);
  dCpuTime.textContent = fmtCpuTime(p.cpuTime);
  dUser.textContent    = p.user || '—';
  dCommand.textContent = p.command;

  if (p.hangDurationMs > 0) {
    dHangItem.style.display = '';
    dHang.textContent = fmtHang(p.hangDurationMs);
  } else {
    dHangItem.style.display = 'none';
  }
}

function selectProcess(p) {
  const isNewProcess = p.pid !== selectedPid;
  selectedPid = p.pid;
  renderTable(); // re-highlight

  updateDetailStats(p);

  // Only reset the diagnosis panel when switching to a different process
  if (isNewProcess) {
    diagWrap.style.display  = 'none';
    diagError.style.display = 'none';
    diagBody.innerHTML      = '';
    detailPanel.classList.remove('diagnosing');
    btnDiag.disabled  = false;
    btnDiag.innerHTML = '<span class="btn-icon">◈</span> Diagnose with AI';
  }

  detailPanel.classList.add('open');
}

function closeDetail() {
  selectedPid = null;
  detailPanel.classList.remove('open');
  detailPanel.classList.remove('stale');
  renderTable();
}

// ── AI Diagnosis ───────────────────────────────────────────────────────────
function formatDiagnosis(text) {
  // Convert **bold** to styled spans and bullets
  return text
    .split('\n')
    .map(line => {
      line = line
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/^[-•]\s+/, '');
      if (/^\*\*/.test(line.trim()) || line.trim().startsWith('<strong>')) {
        return `<span class="diag-line-bold">${line}</span>`;
      }
      if (line.trim().startsWith('-') || line.trim().startsWith('•')) {
        return `<span class="diag-bullet">${line.replace(/^[-•]\s*/, '')}</span>`;
      }
      return `<span>${line}</span>`;
    })
    .join('');
}

btnDiag.addEventListener('click', async () => {
  const p = allProcesses.find(x => x.pid === selectedPid);
  if (!p) return;

  btnDiag.disabled = true;
  btnDiag.innerHTML = '<span class="btn-icon">◈</span> Diagnosing…';
  detailPanel.classList.add('diagnosing');
  diagWrap.style.display  = 'none';
  diagError.style.display = 'none';

  const result = await window.sentinel.diagnoseProcess(p);

  detailPanel.classList.remove('diagnosing');
  btnDiag.disabled = false;
  btnDiag.innerHTML = '<span class="btn-icon">◈</span> Diagnose with AI';

  if (result.success) {
    diagBody.innerHTML = formatDiagnosis(result.diagnosis);
    diagWrap.style.display = '';
  } else {
    diagError.textContent  = '⚠ ' + result.error;
    diagError.style.display = '';
  }
});

// ── Kill process ───────────────────────────────────────────────────────────
let killPid = null;

btnKill.addEventListener('click', () => {
  const p = allProcesses.find(x => x.pid === selectedPid);
  if (!p) return;
  killPid = p.pid;
  confirmDesc.innerHTML = `You are about to kill <strong>${escHtml(truncate(p.command, 40))}</strong> (PID ${p.pid}).<br>This action cannot be undone.`;
  killOverlay.style.display = 'flex';
});

confirmCancel.addEventListener('click', () => {
  killOverlay.style.display = 'none';
  killPid = null;
});

confirmKill.addEventListener('click', async () => {
  if (!killPid) return;
  killOverlay.style.display = 'none';
  const result = await window.sentinel.killProcess(killPid);
  if (!result.success) {
    diagError.textContent  = '⚠ Kill failed: ' + result.error;
    diagError.style.display = '';
  } else {
    closeDetail();
  }
  killPid = null;
});

// ── Event listeners ────────────────────────────────────────────────────────
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim();
  clearBtn.style.display = searchQuery ? '' : 'none';
  renderTable();
});

clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  clearBtn.style.display = 'none';
  renderTable();
});

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderTable();
  });
});

sortSelect.addEventListener('change', () => {
  sortKey = sortSelect.value;
  renderTable();
});

document.getElementById('close-detail').addEventListener('click', closeDetail);

// ── IPC: receive process updates ───────────────────────────────────────────
window.sentinel.onProcessUpdate(processes => {
  allProcesses = processes;
  updateStats();

  // Keep detail panel in sync if a process is selected.
  // If the selected process is gone (died, or PID got reused — unlikely on Linux
  // but possible), FREEZE the panel instead of closing it. The user should be
  // able to keep reading the diagnosis after the process exits.
  if (selectedPid !== null) {
    const updated = processes.find(p => p.pid === selectedPid);
    if (updated) {
      detailPanel.classList.remove('stale');
      selectProcess(updated);
    } else if (!detailPanel.classList.contains('stale')) {
      // First poll that no longer contains the selected PID: mark stale once.
      detailPanel.classList.add('stale');
      renderTable();
    }
  } else {
    renderTable();
  }
});

// ── Utilities ──────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}
