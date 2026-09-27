"use strict";
/**
 * src/core/dashboard-template.ts
 *
 * Self-contained HTML template for the Bobtention session dashboard.
 *
 * The string __SESSION_DATA__ is replaced at generation time with the JSON
 * array of all SessionState objects in the workspace's .bobtention/sessions/
 * directory.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DASHBOARD_HTML = void 0;
exports.DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Bobtention Dashboard</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,"Segoe UI",system-ui,sans-serif;font-size:14px;line-height:1.6;background:#0d1117;color:#e6edf3;min-height:100vh}
a{color:#58a6ff;text-decoration:none}

/* ── Layout ─────────────────────────────────────────────────────── */
.app{display:grid;grid-template-columns:260px 1fr;min-height:100vh}

/* ── Sidebar ─────────────────────────────────────────────────────── */
.sidebar{background:#161b22;border-right:1px solid #30363d;padding:0;display:flex;flex-direction:column;overflow:hidden}
.sidebar-head{padding:14px 16px;border-bottom:1px solid #30363d;font-weight:700;font-size:13px;letter-spacing:.04em;color:#8b949e;text-transform:uppercase}
.sidebar-sessions{flex:1;overflow-y:auto}
.session-item{padding:10px 16px;cursor:pointer;border-bottom:1px solid #21262d;transition:background .1s}
.session-item:hover{background:#1f2937}
.session-item.active{background:#1f2937;border-left:3px solid #58a6ff}
.session-item .sid{font-size:11px;color:#8b949e;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.session-item .intent{font-size:13px;color:#e6edf3;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.session-item .smeta{font-size:11px;color:#6e7681;margin-top:3px;display:flex;gap:8px;flex-wrap:wrap}
.sbadge{padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700}
.sbadge.active{background:#1a4030;color:#3fb950}
.sbadge.completed{background:#1e2b3a;color:#58a6ff}
.sbadge.blocked{background:#3d1f1f;color:#f85149}
.sbadge.error{background:#3d1f1f;color:#ffa657}

/* ── Main ─────────────────────────────────────────────────────────── */
.main{overflow-y:auto;padding:24px 28px;background:#0d1117}
.empty-state{display:flex;align-items:center;justify-content:center;height:60vh;color:#6e7681;font-size:15px;flex-direction:column;gap:8px}
.empty-state .big{font-size:36px}

/* ── Session Header ─────────────────────────────────────────────── */
.session-header{margin-bottom:20px}
.session-header h1{font-size:18px;font-weight:700;color:#e6edf3}
.session-header .sub{font-size:12px;color:#8b949e;margin-top:4px;font-family:monospace}

/* ── Stat chips ─────────────────────────────────────────────────── */
.stats-row{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:24px}
.stat{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 16px;min-width:100px;text-align:center}
.stat .num{font-size:26px;font-weight:700}
.stat .lbl{font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:.05em;margin-top:2px}
.stat.allow .num{color:#3fb950}
.stat.watch .num{color:#d29922}
.stat.block .num{color:#f85149}
.stat.neutral .num{color:#58a6ff}
.stat.override .num{color:#bc8cff}

/* ── Sections ───────────────────────────────────────────────────── */
.section{margin-bottom:28px}
.section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8b949e;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.section-title::after{content:'';flex:1;height:1px;background:#21262d}

/* ── Intent card ────────────────────────────────────────────────── */
.intent-card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px 16px;font-size:14px;color:#e6edf3;line-height:1.5}
.intent-card .label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#8b949e;margin-bottom:4px}

/* ── Decision Trail ─────────────────────────────────────────────── */
.trail{position:relative}
.trail-item{display:flex;gap:0;margin-bottom:10px;position:relative}

.tl-spine{width:44px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;padding-top:10px}
.tl-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0;margin-top:2px}
.tl-dot.ALLOW{background:#3fb950}
.tl-dot.WATCH{background:#d29922}
.tl-dot.BLOCK{background:#f85149}
.tl-dot.override{background:#bc8cff}
.tl-connector{width:2px;flex:1;background:#21262d;margin-top:4px;min-height:20px}

.tl-card{flex:1;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 14px;margin-left:6px}
.tl-card.BLOCK{border-left:3px solid #f85149}
.tl-card.WATCH{border-left:3px solid #d29922}
.tl-card.ALLOW{border-left:3px solid #3fb950}
.tl-card.override{border-left:3px solid #bc8cff}

.tl-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap}
.tl-decision-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;letter-spacing:.05em;white-space:nowrap;flex-shrink:0}
.tl-decision-badge.ALLOW{background:#1a4030;color:#3fb950}
.tl-decision-badge.WATCH{background:#2d2008;color:#d29922}
.tl-decision-badge.BLOCK{background:#3d1f1f;color:#f85149}
.tl-decision-badge.override{background:#2a1f3a;color:#bc8cff}
.tl-engine-badge{font-size:9px;padding:2px 6px;border-radius:4px;background:#21262d;color:#8b949e;font-family:monospace}

.tl-reason{font-size:13px;color:#e6edf3;flex:1;line-height:1.4}
.tl-time{font-size:11px;color:#6e7681;white-space:nowrap}

.tl-trigger{font-size:11px;color:#8b949e;margin-top:5px;font-family:monospace;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.tl-trigger .tool-tag{background:#161b22;border:1px solid #30363d;padding:1px 7px;border-radius:4px;color:#58a6ff}
.tl-trigger .file-tag{background:#0d1117;border:1px solid #21262d;padding:1px 7px;border-radius:4px;color:#e6edf3;font-size:10px}

.tl-conf{font-size:11px;color:#6e7681;margin-top:4px}
.conf-bar-wrap{display:inline-block;width:80px;height:4px;background:#21262d;border-radius:2px;vertical-align:middle;margin:0 6px}
.conf-bar{height:100%;border-radius:2px}

.signal-pills{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.signal-pill{font-size:10px;padding:2px 7px;border-radius:100px;font-weight:600;letter-spacing:.02em}
.signal-pill.TASK_DRIFT{background:#2d2008;color:#d29922}
.signal-pill.REPEATED_FAILURE{background:#3d1f1f;color:#f85149}
.signal-pill.SCOPE_EXPANSION{background:#1a2d3a;color:#58a6ff}
.signal-pill.HIGH_IMPACT_CHANGE{background:#3d1f00;color:#ffa657}
.signal-pill.UNCERTAINTY{background:#2a1f3a;color:#bc8cff}

/* ── Laya Q&A panel ─────────────────────────────────────────────── */
.laya-panel{margin-top:10px;border:1px solid #21262d;border-radius:6px;overflow:hidden}
.laya-panel-head{background:#0d1117;padding:6px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8b949e;display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none}
.laya-panel-head .toggle{font-size:12px;transition:transform .15s;display:inline-block}
.laya-panel-head.open .toggle{transform:rotate(90deg)}
.laya-qa{display:none;padding:8px 12px;background:#0d1117;border-top:1px solid #21262d}
.laya-qa.open{display:block}
.laya-qa-row{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #161b22;font-size:12px}
.laya-qa-row:last-child{border-bottom:none}
.laya-qa-row .q{color:#8b949e;font-family:monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis}
.laya-qa-row .choice{font-family:monospace;font-size:11px;color:#e6edf3}
.laya-qa-row .dec{font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px}

/* ── Signals section ─────────────────────────────────────────────── */
.signal-row{display:flex;align-items:center;gap:10px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px 14px;margin-bottom:8px;flex-wrap:wrap}
.signal-type{font-size:11px;font-weight:700;min-width:170px;color:#e6edf3;letter-spacing:.02em}
.signal-bar-wrap{flex:1;min-width:80px;background:#21262d;border-radius:3px;height:6px;overflow:hidden}
.signal-bar{height:100%;border-radius:3px}
.signal-bar.high{background:#f85149}
.signal-bar.med{background:#d29922}
.signal-bar.low{background:#3fb950}
.signal-sev{font-size:11px;color:#8b949e;min-width:34px;text-align:right}
.signal-detail{font-size:11px;color:#6e7681;flex-basis:100%;margin-top:2px}

/* ── Actions log ─────────────────────────────────────────────────── */
.actions-table{width:100%;border-collapse:collapse;font-size:12px}
.actions-table th{text-align:left;padding:6px 10px;border-bottom:1px solid #30363d;color:#8b949e;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
.actions-table td{padding:7px 10px;border-bottom:1px solid #21262d;vertical-align:top}
.actions-table tr:last-child td{border-bottom:none}
.actions-table .tool-cell{color:#58a6ff;font-family:monospace;white-space:nowrap}
.actions-table .files-cell{color:#8b949e;font-size:11px;word-break:break-all}
.actions-table .time-cell{color:#6e7681;white-space:nowrap;font-family:monospace}
.no-actions{color:#6e7681;font-size:13px;padding:12px 0}

/* ── Failures section ────────────────────────────────────────────── */
.failure-row{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.failure-sig{font-size:12px;font-family:monospace;color:#e6edf3;flex:1;min-width:200px}
.failure-count{font-size:18px;font-weight:700;color:#f85149;min-width:36px;text-align:right}
.failure-prog{font-size:10px;padding:2px 7px;border-radius:4px}
.failure-prog.yes{background:#1a4030;color:#3fb950}
.failure-prog.no{background:#3d1f1f;color:#f85149}

/* ── Scrollbars ───────────────────────────────────────────────────── */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:#0d1117}
::-webkit-scrollbar-thumb{background:#30363d;border-radius:3px}

/* ── Responsive ───────────────────────────────────────────────────── */
@media(max-width:640px){
  .app{grid-template-columns:1fr}
  .sidebar{max-height:220px}
}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="sidebar-head">Sessions</div>
    <div class="sidebar-sessions" id="sidebar-sessions"></div>
  </aside>
  <main class="main" id="main">
    <div class="empty-state" id="empty-state">
      <div class="big">🤖</div>
      <div>Select a session to inspect its decision trail</div>
    </div>
    <div id="session-view" style="display:none"></div>
  </main>
</div>

<script>
const SESSIONS = __SESSION_DATA__;

// ── Helpers ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function fmt(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
}

function elapsed(startTs) {
  if (!startTs) return '—';
  const s = Math.floor((Date.now() - startTs) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm ' + (s%60) + 's';
  return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
}

function confColor(c) {
  if (c >= 0.8) return '#f85149';
  if (c >= 0.5) return '#d29922';
  return '#3fb950';
}

function decClass(d) {
  if (d === 'BLOCK') return 'BLOCK';
  if (d === 'WATCH') return 'WATCH';
  if (d === 'override') return 'override';
  return 'ALLOW';
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function buildSidebar() {
  const el = document.getElementById('sidebar-sessions');
  if (!SESSIONS.length) {
    el.innerHTML = '<div style="padding:16px;color:#6e7681;font-size:12px">No sessions yet</div>';
    return;
  }
  el.innerHTML = SESSIONS.map((s, i) => {
    const counts = countDecisions(s);
    const statusCls = {active:'active',completed:'completed',blocked:'blocked',error:'error'}[s.status] ?? 'active';
    return \`<div class="session-item\${i===0?' active':''}" onclick="selectSession(\${i})" id="si\${i}">
      <div class="sid">\${esc(s.sessionId)}</div>
      <div class="intent">\${esc(s.originalIntent || '(no intent)')}</div>
      <div class="smeta">
        <span class="sbadge \${statusCls}">\${esc(s.status)}</span>
        <span style="color:#f85149">\${counts.block}✗</span>
        <span style="color:#d29922">\${counts.watch}◉</span>
        <span style="color:#3fb950">\${counts.allow}✓</span>
      </div>
    </div>\`;
  }).join('');
}

// ── Session view ─────────────────────────────────────────────────────────────

let currentIdx = -1;

function selectSession(idx) {
  currentIdx = idx;
  // update active sidebar item
  document.querySelectorAll('.session-item').forEach((el,i) => {
    el.classList.toggle('active', i === idx);
  });
  document.getElementById('empty-state').style.display = 'none';
  const view = document.getElementById('session-view');
  view.style.display = 'block';
  view.innerHTML = renderSession(SESSIONS[idx]);
}

function countDecisions(s) {
  const d = s.decisions ?? [];
  return {
    allow: d.filter(x => x.decision === 'ALLOW').length,
    watch: d.filter(x => x.decision === 'WATCH').length,
    block: d.filter(x => x.decision === 'BLOCK').length,
    override: d.filter(x => x.engine === 'override').length,
  };
}

function renderSession(s) {
  const counts = countDecisions(s);
  const decisions = s.decisions ?? [];
  const signals = s.signals ?? [];
  const actions = s.actions ?? [];
  const failures = s.failures ?? [];

  return \`
    \${renderHeader(s)}
    \${renderStats(counts, actions, signals)}
    \${renderIntent(s)}
    \${renderBlockedAlert(s)}
    \${renderDecisionTrail(decisions)}
    \${renderSignals(signals)}
    \${renderActions(actions)}
    \${renderFailures(failures)}
  \`;
}

// ── Header ──────────────────────────────────────────────────────────────────

function renderHeader(s) {
  const statusCls = {active:'active',completed:'completed',blocked:'blocked',error:'error'}[s.status] ?? 'active';
  return \`
    <div class="session-header">
      <h1>\${esc(s.originalIntent || 'Untitled Session')}</h1>
      <div class="sub">
        \${esc(s.sessionId)}
        &nbsp;·&nbsp; Started \${fmtDate(s.startTime)}
        &nbsp;·&nbsp; Duration \${elapsed(s.startTime)}
        &nbsp;·&nbsp; <span class="sbadge \${statusCls}">\${esc(s.status)}</span>
      </div>
    </div>
  \`;
}

// ── Stats ────────────────────────────────────────────────────────────────────

function renderStats(counts, actions, signals) {
  return \`
    <div class="stats-row">
      <div class="stat allow"><div class="num">\${counts.allow}</div><div class="lbl">Allow</div></div>
      <div class="stat watch"><div class="num">\${counts.watch}</div><div class="lbl">Watch</div></div>
      <div class="stat block"><div class="num">\${counts.block}</div><div class="lbl">Block</div></div>
      <div class="stat override"><div class="num">\${counts.override}</div><div class="lbl">Override</div></div>
      <div class="stat neutral"><div class="num">\${actions.length}</div><div class="lbl">Actions</div></div>
      <div class="stat neutral"><div class="num">\${signals.length}</div><div class="lbl">Signals</div></div>
    </div>
  \`;
}

// ── Intent ───────────────────────────────────────────────────────────────────

function renderIntent(s) {
  if (!s.originalIntent) return '';
  return \`
    <div class="section">
      <div class="section-title">Original Intent</div>
      <div class="intent-card">
        <div class="label">What the agent was asked to do</div>
        \${esc(s.originalIntent)}
      </div>
    </div>
  \`;
}

// ── Blocked alert ─────────────────────────────────────────────────────────────

function renderBlockedAlert(s) {
  if (!s.blockedAction) return '';
  const b = s.blockedAction;
  return \`
    <div style="background:#3d1f1f;border:1px solid #f85149;border-radius:8px;padding:12px 16px;margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:#f85149;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">⛔ Last Blocked Action</div>
      <div style="font-size:13px;color:#e6edf3">\${esc(b.reason)}</div>
      <div style="margin-top:6px;font-size:11px;color:#8b949e;font-family:monospace">
        <span style="color:#58a6ff">\${esc(b.tool)}</span>
        \${(b.files??[]).map(f=>\`<span style="margin-left:6px">\${esc(f)}</span>\`).join('')}
        &nbsp;·&nbsp; \${fmt(b.timestamp)}
      </div>
    </div>
  \`;
}

// ── Decision Trail ───────────────────────────────────────────────────────────

function renderDecisionTrail(decisions) {
  if (!decisions.length) {
    return \`<div class="section"><div class="section-title">Decision Trail</div><div class="no-actions">No decisions recorded yet.</div></div>\`;
  }
  const items = decisions.map((d, i) => {
    const dec = d.decision ?? 'ALLOW';
    const eng = d.engine ?? 'deterministic';
    const decCls = eng === 'override' ? 'override' : dec;
    const conf = typeof d.confidence === 'number' ? d.confidence : 0;
    const confPct = Math.round(conf * 100);
    const confBar = \`<span class="conf-bar-wrap"><span class="conf-bar" style="width:\${confPct}%;background:\${confColor(conf)}"></span></span>\`;
    const isLast = i === decisions.length - 1;

    // Trigger row
    const trigger = d.trigger
      ? \`<div class="tl-trigger">
          <span class="tool-tag">\${esc(d.trigger.tool)}</span>
          \${(d.trigger.files??[]).slice(0,4).map(f=>\`<span class="file-tag">\${esc(f)}</span>\`).join('')}
          \${(d.trigger.files??[]).length > 4 ? \`<span style="color:#6e7681;font-size:10px">+\${d.trigger.files.length-4} more</span>\` : ''}
        </div>\`
      : '';

    // Signal pills
    const pills = (d.signals??[]).length
      ? \`<div class="signal-pills">\${(d.signals).map(sig=>\`<span class="signal-pill \${esc(sig)}">\${esc(sig)}</span>\`).join('')}</div>\`
      : '';

    // Laya Q&A panel
    const layaPanel = (d.layaDetail && d.layaDetail.length)
      ? renderLayaPanel(d.layaDetail, i)
      : '';

    return \`<div class="trail-item">
      <div class="tl-spine">
        <div class="tl-dot \${decCls}"></div>
        \${!isLast ? '<div class="tl-connector"></div>' : ''}
      </div>
      <div class="tl-card \${decCls}">
        <div class="tl-top">
          <span class="tl-decision-badge \${decCls}">\${eng === 'override' ? 'OVERRIDE' : esc(dec)}</span>
          <span class="tl-engine-badge">\${esc(eng)}</span>
          <span class="tl-reason" style="flex:1;margin:0 8px">\${esc(d.reason ?? '')}</span>
          <span class="tl-time">\${fmt(d.timestamp)}</span>
        </div>
        <div class="tl-conf">Confidence: <strong>\${confPct}%</strong>\${confBar}</div>
        \${trigger}
        \${pills}
        \${layaPanel}
      </div>
    </div>\`;
  });

  return \`
    <div class="section">
      <div class="section-title">Decision Trail (\${decisions.length})</div>
      <div class="trail">\${items.join('')}</div>
    </div>
  \`;
}

function renderLayaPanel(detail, idx) {
  const id = 'laya-' + idx;
  const rows = detail.map(q => {
    const decCls = q.decision === 'BLOCK' ? 'BLOCK' : q.decision === 'WATCH' ? 'WATCH' : 'ALLOW';
    const decColors = {BLOCK:'#f85149',WATCH:'#d29922',ALLOW:'#3fb950'};
    const decBg = {BLOCK:'#3d1f1f',WATCH:'#2d2008',ALLOW:'#1a4030'};
    return \`<div class="laya-qa-row">
      <span class="q">\${esc(q.question)}</span>
      <span class="choice">\${esc(q.choice)}</span>
      <span class="dec" style="background:\${decBg[decCls]??'#21262d'};color:\${decColors[decCls]??'#8b949e'}">\${esc(q.decision)}</span>
    </div>\`;
  }).join('');

  return \`<div class="laya-panel">
    <div class="laya-panel-head" id="\${id}-head" onclick="toggleLaya('\${id}')">
      <span class="toggle">▶</span> Laya Q&amp;A Reasoning (\${detail.length} question\${detail.length!==1?'s':''})
    </div>
    <div class="laya-qa" id="\${id}-body">\${rows}</div>
  </div>\`;
}

function toggleLaya(id) {
  const head = document.getElementById(id + '-head');
  const body = document.getElementById(id + '-body');
  if (!head || !body) return;
  const open = body.classList.toggle('open');
  head.classList.toggle('open', open);
}

// ── Signals ──────────────────────────────────────────────────────────────────

function renderSignals(signals) {
  if (!signals.length) {
    return \`<div class="section"><div class="section-title">Signals</div><div class="no-actions">No signals raised.</div></div>\`;
  }
  const rows = signals.map(sig => {
    const sev = typeof sig.severity === 'number' ? sig.severity : 0;
    const pct = Math.round(sev * 100);
    const cls = sev >= 0.7 ? 'high' : sev >= 0.4 ? 'med' : 'low';
    const detail = sig.detail
      ? \`<span class="signal-detail">\${esc(sig.detail)}</span>\`
      : '';
    return \`<div class="signal-row">
      <span class="signal-type \${esc(sig.type)}">\${esc(sig.type)}</span>
      <div class="signal-bar-wrap"><div class="signal-bar \${cls}" style="width:\${pct}%"></div></div>
      <span class="signal-sev">\${pct}%</span>
      <span style="font-size:11px;color:#6e7681;font-family:monospace">\${fmt(sig.timestamp)}</span>
      \${detail}
    </div>\`;
  }).join('');

  return \`
    <div class="section">
      <div class="section-title">Signals (\${signals.length})</div>
      \${rows}
    </div>
  \`;
}

// ── Actions log ───────────────────────────────────────────────────────────────

function renderActions(actions) {
  if (!actions.length) {
    return \`<div class="section"><div class="section-title">Actions</div><div class="no-actions">No actions recorded.</div></div>\`;
  }
  const rows = [...actions].reverse().map(a => \`
    <tr>
      <td class="tool-cell">\${esc(a.tool)}</td>
      <td class="files-cell">\${(a.files??[]).map(f=>\`<span>\${esc(f)}</span> \`).join('')||'—'}</td>
      <td class="time-cell">\${fmt(a.timestamp)}</td>
    </tr>
  \`).join('');

  return \`
    <div class="section">
      <div class="section-title">Actions Log (\${actions.length})</div>
      <table class="actions-table">
        <thead><tr><th>Tool</th><th>Files</th><th>Time</th></tr></thead>
        <tbody>\${rows}</tbody>
      </table>
    </div>
  \`;
}

// ── Failures ──────────────────────────────────────────────────────────────────

function renderFailures(failures) {
  if (!failures.length) return '';
  const rows = failures.map(f => \`
    <div class="failure-row">
      <div class="failure-sig">\${esc(f.signature)}</div>
      <div style="font-size:12px;color:#6e7681">×\${f.count} failures</div>
      <span class="failure-prog \${f.progressing?'yes':'no'}">\${f.progressing ? 'progressing' : 'stuck'}</span>
      <div style="font-size:11px;color:#6e7681;font-family:monospace">last: \${fmt(f.lastSeen)}</div>
    </div>
  \`).join('');

  return \`
    <div class="section">
      <div class="section-title">Failures (\${failures.length})</div>
      \${rows}
    </div>
  \`;
}

// ── Init ──────────────────────────────────────────────────────────────────────

buildSidebar();
if (SESSIONS.length > 0) selectSession(0);

// Auto-refresh: reload the page every 5 s while a session is active
const hasActive = SESSIONS.some(s => s.status === 'active');
if (hasActive) {
  setTimeout(() => location.reload(), 5000);
}
</script>
</body>
</html>
`;
//# sourceMappingURL=dashboard-template.js.map