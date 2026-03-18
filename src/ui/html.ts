export function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>⚡ SamaraCode</title>
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#1e1e2e">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --bg: #1e1e2e;
    --bg2: #181825;
    --bg3: #11111b;
    --surface: #313244;
    --text: #cdd6f4;
    --subtext: #6c7086;
    --yellow: #f9e2af;
    --green: #a6e3a1;
    --red: #f38ba8;
    --blue: #89b4fa;
    --purple: #cba6f7;
    --cyan: #94e2d5;
    --orange: #fab387;
    --border: #45475a;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 13px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Header */
  #header {
    background: var(--bg3);
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  #header .brand { color: var(--yellow); font-weight: bold; font-size: 15px; }
  #header .info { color: var(--subtext); font-size: 12px; }
  #header .badge {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
  }
  .badge-on { background: #a6e3a133; color: var(--green); }
  .badge-off { background: #f38ba833; color: var(--red); }

  /* Main layout */
  #main {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* Log panel */
  #logs-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  #logs {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    scroll-behavior: smooth;
  }

  .log-entry {
    padding: 3px 0;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
  /* Tabs */
  #tabs {
    display: flex;
    background: var(--bg3);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .tab {
    padding: 8px 20px;
    cursor: pointer;
    color: var(--subtext);
    font-size: 12px;
    border-bottom: 2px solid transparent;
    transition: all 0.15s;
  }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--yellow); border-bottom-color: var(--yellow); }
  .tab-content { display: none; flex: 1; overflow-y: auto; padding: 12px 16px; }
  .tab-content.active { display: block; }

  .log-user { color: var(--blue); }
  .log-user::before { content: "you → "; font-weight: bold; }
  .log-agent { color: var(--text); border-left: 3px solid var(--purple); padding-left: 10px; margin: 6px 0; line-height: 1.45; }
  .log-agent p { margin: 1px 0; }
  .log-agent br { display: none; }
  .log-agent .agent-label { color: var(--yellow); font-weight: bold; }
  .log-agent h1, .log-agent h2, .log-agent h3 { color: var(--yellow); margin: 6px 0 2px 0; }
  .log-agent h1 { font-size: 16px; }
  .log-agent h2 { font-size: 14px; }
  .log-agent h3 { font-size: 13px; }
  .log-agent code { background: var(--surface); padding: 1px 5px; border-radius: 3px; font-size: 12px; color: var(--cyan); }
  .log-agent pre { background: var(--bg3); padding: 8px; border-radius: 6px; margin: 4px 0; overflow-x: auto; font-size: 12px; }
  .log-agent pre code { background: none; padding: 0; color: var(--text); }
  .log-agent strong { color: var(--yellow); }
  .log-agent em { color: var(--subtext); font-style: italic; }
  .log-agent ul, .log-agent ol { padding-left: 20px; margin: 2px 0; }
  .log-agent li { margin: 1px 0; }
  .log-agent hr { border: none; border-top: 1px solid var(--border); margin: 4px 0; }
  .log-agent a { color: var(--blue); text-decoration: underline; cursor: pointer; }
  .log-tool { color: var(--orange); padding-left: 16px; font-size: 12px; }
  .log-thinking { color: var(--subtext); padding-left: 16px; font-style: italic; }
  .log-error { color: var(--red); padding-left: 16px; }
  .log-system { color: var(--subtext); padding-left: 16px; font-size: 12px; }

  /* Preview tabs */
  .tab-preview { position: relative; padding-right: 24px !important; }
  .tab-preview .tab-close {
    position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
    cursor: pointer; opacity: 0.5; font-size: 14px; line-height: 1;
  }
  .tab-preview .tab-close:hover { opacity: 1; color: var(--red); }
  #previews-container { display: none; flex: 1; overflow: hidden; flex-direction: column; }
  #previews-container.has-active { display: flex; }
  #preview-url-bar {
    display: flex; align-items: center; gap: 6px;
    background: var(--bg3); padding: 4px 8px; border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  #preview-url-bar input {
    flex: 1; background: var(--surface); border: 1px solid var(--border); color: var(--text);
    padding: 4px 8px; border-radius: 4px; font-family: inherit; font-size: 12px; outline: none;
  }
  #preview-url-bar input:focus { border-color: var(--purple); }
  #preview-url-bar button {
    background: var(--surface); border: 1px solid var(--border); color: var(--subtext);
    padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;
  }
  #preview-url-bar button:hover { color: var(--text); border-color: var(--purple); }
  .preview-frame { display: none; border: none; width: 100%; flex: 1; background: #fff; }
  .preview-frame.active { display: block; }

  /* Raw logs tab */
  .raw-log { font-size: 11px; padding: 2px 0; font-family: monospace; white-space: pre-wrap; word-break: break-all; }
  .raw-log-tool { color: var(--orange); }
  .raw-log-system { color: var(--subtext); }
  .raw-log-thinking { color: var(--cyan); }
  .raw-log-error { color: var(--red); }
  .raw-log-user { color: var(--blue); }
  .raw-log-agent { color: var(--purple); }
  .raw-log-time { color: var(--subtext); margin-right: 8px; }

  /* Sidebar */
  #sidebar {
    width: 240px;
    background: var(--bg2);
    border-left: 1px solid var(--border);
    padding: 12px;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .sidebar-title {
    color: var(--yellow);
    font-weight: bold;
    font-size: 12px;
    text-transform: uppercase;
    margin-bottom: 8px;
    margin-top: 16px;
  }
  .sidebar-title:first-child { margin-top: 0; }

  .task-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    font-size: 12px;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.15s;
  }
  .task-item:hover { background: var(--surface); }
  .task-kill {
    margin-left: auto;
    color: var(--subtext);
    cursor: pointer;
    font-size: 14px;
    padding: 0 4px;
    border-radius: 3px;
    display: none;
  }
  .task-item:hover .task-kill { display: inline; }
  .task-kill:hover { color: var(--red); background: #f38ba822; }
  .task-running { color: var(--cyan); }
  .task-pending { color: var(--subtext); }
  .task-completed { color: var(--green); }
  .task-failed { color: var(--red); }
  .task-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .task-running .task-dot { background: var(--cyan); animation: pulse 1s infinite; }
  .task-pending .task-dot { background: var(--subtext); }
  .task-completed .task-dot { background: var(--green); }
  .task-failed .task-dot { background: var(--red); }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

  .tool-item { color: var(--subtext); font-size: 11px; padding: 1px 0; }
  .tool-item.dynamic { color: var(--yellow); }

  /* Agent detail panel */
  #agent-detail {
    display: none;
    position: absolute;
    top: 0; bottom: 0; right: 0;
    width: 400px;
    background: var(--bg2);
    border-left: 2px solid var(--purple);
    z-index: 50;
    flex-direction: column;
  }
  #agent-detail.show { display: flex; }
  #agent-detail-header {
    padding: 10px 14px;
    background: var(--bg3);
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  #agent-detail-header .name { color: var(--purple); font-weight: bold; }
  #agent-detail-header .close {
    color: var(--subtext);
    cursor: pointer;
    font-size: 18px;
    padding: 0 4px;
  }
  #agent-detail-header .close:hover { color: var(--text); }
  #agent-detail-logs {
    flex: 1;
    overflow-y: auto;
    padding: 10px 14px;
  }
  .agent-log-entry { padding: 3px 0; font-size: 12px; }
  .agent-log-thinking { color: var(--subtext); }
  .agent-log-tool { color: var(--orange); }
  .agent-log-result { color: var(--green); }
  .agent-log-error { color: var(--red); }

  .empty-state { color: var(--subtext); font-size: 12px; font-style: italic; }

  /* Input */
  #input-area {
    background: var(--bg3);
    border-top: 1px solid var(--border);
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  #input-area .prompt { color: var(--cyan); font-weight: bold; font-size: 16px; }
  #input-area input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text);
    font-family: inherit;
    font-size: 14px;
    outline: none;
  }
  #input-area input::placeholder { color: var(--subtext); }

  #processing {
    color: var(--cyan);
    font-size: 12px;
    animation: pulse 1s infinite;
  }

  /* Thinking indicator in chat */
  #chat-thinking {
    color: var(--subtext);
    font-size: 12px;
    padding: 6px 0;
    font-style: italic;
    display: none;
  }
  #chat-thinking.show { display: block; }
  #chat-thinking .thinking-dot { animation: pulse 1s infinite; }

  .model-item { color: var(--subtext); font-size: 11px; padding: 2px 0; }
  .model-item .model-provider { color: var(--cyan); font-weight: bold; }
  .model-item .model-name { color: var(--text); }

  /* Confirm dialog */
  #confirm-overlay {
    display: none;
    position: fixed;
    bottom: 50px;
    left: 16px;
    right: 256px;
    background: var(--surface);
    border: 1px solid var(--yellow);
    border-radius: 8px;
    padding: 12px 16px;
    z-index: 100;
  }
  #confirm-overlay.show { display: block; }
  #confirm-msg { color: var(--yellow); margin-bottom: 10px; font-size: 13px; }
  #confirm-buttons { display: flex; gap: 8px; }
  #confirm-buttons button {
    padding: 6px 16px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
  }
  #confirm-buttons button:hover { background: var(--surface); }
  #confirm-buttons .btn-yes { border-color: var(--green); color: var(--green); }
  #confirm-buttons .btn-no { border-color: var(--red); color: var(--red); }
  #confirm-buttons .btn-all { border-color: var(--yellow); color: var(--yellow); }
</style>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
<script>
if (typeof marked !== 'undefined') {
  var renderer = new marked.Renderer();
  renderer.link = function(href, title, text) {
    var h = typeof href === 'object' ? href.href : href;
    var t = typeof href === 'object' ? href.title : title;
    var tx = typeof href === 'object' ? href.text : text;
    return '<a href="' + h + '" target="_blank" rel="noopener"' + (t ? ' title="' + t + '"' : '') + '>' + tx + '</a>';
  };
  marked.setOptions({ renderer: renderer });
}
<\/script>
</head>
<body>

<div id="header">
  <span class="brand">⚡ SamaraCode</span>
  <span class="info" id="cwd"></span>
  <span class="info" id="tools-count"></span>
  <span class="info" id="providers"></span>
  <span class="badge badge-off" id="auto-badge">confirm</span>
</div>

<div id="main" style="position:relative;">
  <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
    <div id="tabs">
      <div class="tab active" onclick="switchTab('chat')">Chat</div>
      <div class="tab" onclick="switchTab('logs')">Logs</div>
    </div>
    <div id="logs-panel">
      <div id="chat-tab" class="tab-content active">
        <div id="chat-thinking"><span class="thinking-dot">⟳</span> Thinking... <span id="thinking-timer">0s</span></div>
      </div>
      <div id="logs-tab" class="tab-content"></div>
    </div>
    <div id="previews-container">
      <div id="preview-url-bar">
        <button onclick="previewBack()" title="Back">←</button>
        <button onclick="previewForward()" title="Forward">→</button>
        <button onclick="previewReload()" title="Reload">⟳</button>
        <input id="preview-url-input" type="text" placeholder="http://localhost:5173" onkeydown="if(event.key==='Enter')previewNavigate()">
        <button onclick="previewNavigate()">Go</button>
      </div>
    </div>
  </div>

  <div id="sidebar">
    <div class="sidebar-title">Tasks & Agents</div>
    <div id="tasks-list"><span class="empty-state">No active tasks</span></div>

    <div class="sidebar-title">Token Usage</div>
    <div id="token-summary">
      <div style="font-size:11px;color:var(--subtext);padding:4px 0;">
        <div style="display:flex;justify-content:space-between;padding:2px 0">
          <span>Calls:</span><span id="tk-calls" style="color:var(--text)">0</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:2px 0">
          <span>Input:</span><span id="tk-input" style="color:var(--cyan)">0</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:2px 0">
          <span>Output:</span><span id="tk-output" style="color:var(--orange)">0</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:2px 0">
          <span>Total:</span><span id="tk-total" style="color:var(--yellow);font-weight:bold">0</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-top:1px solid var(--border);margin-top:4px">
          <span>Cost:</span><span id="tk-cost" style="color:var(--green);font-weight:bold">$0.000000</span>
        </div>
      </div>
    </div>
    <div id="token-log" style="max-height:200px;overflow-y:auto;margin-top:4px"></div>

    <div class="sidebar-title">Providers</div>
    <div id="models-list"></div>

    <div class="sidebar-title">Tools (<span id="tools-count-sidebar">0</span>)</div>
    <div id="tools-list"></div>
  </div>
</div>

<div id="agent-detail">
  <div id="agent-detail-header">
    <span class="name" id="agent-detail-name">Agent</span>
    <span class="close" onclick="closeAgentDetail()">&times;</span>
  </div>
  <div id="agent-detail-logs"></div>
</div>

<div id="confirm-overlay">
  <div id="confirm-msg"></div>
  <div id="confirm-buttons">
    <button class="btn-yes" onclick="confirmAction(true)">Yes (y)</button>
    <button class="btn-no" onclick="confirmAction(false)">No (n)</button>
    <button class="btn-all" onclick="confirmAction('all')">Accept All (a)</button>
  </div>
</div>

<div id="input-area">
  <span class="prompt">❯</span>
  <input type="text" id="input" placeholder="type a task or /help" autofocus />
  <span id="processing" style="display:none">⟳ thinking...</span>
</div>

<script>
var chatEl = document.getElementById('chat-tab');
var rawLogsEl = document.getElementById('logs-tab');
var inputEl = document.getElementById('input');
var confirmOverlay = document.getElementById('confirm-overlay');
var confirmMsg = document.getElementById('confirm-msg');
var processingEl = document.getElementById('processing');
var currentTab = 'chat';
var logCounter = 0;

var ws;
function connectWS() {
  ws = new WebSocket('ws://' + location.host);
  ws.onclose = function() { setTimeout(connectWS, 1000); };
  ws.onerror = function() {};

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);

  switch (msg.type) {
    case 'init':
      try {
        document.getElementById('cwd').textContent = msg.cwd || '';
        document.getElementById('tools-count').textContent = (msg.tools || []).length + ' tools';
        var provEl = document.getElementById('providers');
        if (provEl) provEl.textContent = (msg.providers || []).map(function(p) { return p.name; }).join(', ');
        updateAutoBadge(msg.autoAccept);
        renderTools(msg.tools || []);
        renderModels(msg.providers || []);
      } catch(err) { console.error('init error:', err); }
      break;

    case 'log':
      addLog(msg.entry.type, msg.entry.text);
      break;

    case 'processing':
      processingEl.style.display = msg.value ? 'inline' : 'none';
      inputEl.disabled = msg.value;
      if (!msg.value) { inputEl.focus(); stopThinking(); }
      else { startThinking(); }
      break;

    case 'confirm':
      confirmMsg.textContent = '⚠ ' + msg.message;
      confirmOverlay.classList.add('show');
      inputEl.disabled = true;
      break;

    case 'tasks':
      renderTasks(msg.tasks);
      break;

    case 'autoAccept':
      updateAutoBadge(msg.value);
      break;

    case 'model_active':
      var thinkEl = document.getElementById('chat-thinking');
      if (thinkEl) thinkEl.innerHTML = '<span class="thinking-dot">⟳</span> Thinking... <span id="thinking-timer">0s</span> <span style="color:#89b4fa;font-size:11px">(' + msg.model + ')</span>';
      break;

    case 'open_preview':
      addPreviewTab(msg.url, msg.name);
      break;

    case 'agent_logs':
      renderAgentLogs(msg.logs);
      break;

    case 'agent_log':
      if (activeAgentId === msg.taskId) {
        var logEl = document.getElementById('agent-detail-logs');
        var d = document.createElement('div');
        d.className = 'agent-log-entry agent-log-tool';
        d.textContent = msg.text;
        logEl.appendChild(d);
        logEl.scrollTop = logEl.scrollHeight;
      }
      break;

    case 'token_update':
      updateTokenReport(msg.entry, msg.summary);
      break;
  }
};
} // end connectWS
connectWS();

// Listen for errors from preview iframes (via proxy error capture script)
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'preview-errors' && e.data.errors) {
    e.data.errors.forEach(function(err) {
      // Send to server so the orchestrator can see them
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'preview_error', error: err }));
      }
    });
  }
});

var streamQueue = [];
var isStreaming = false;

function streamText(div, fullHtml, callback) {
  // Parse the full HTML once, then reveal it progressively by characters
  div.innerHTML = '<span class="agent-label">⚡ </span><span class="stream-target"></span>';
  var target = div.querySelector('.stream-target');
  var parsed = typeof marked !== 'undefined' ? marked.parse(fullHtml) : fullHtml;

  // Split into chunks (by words for speed, not single chars)
  var words = parsed.split(/(?<=\\s)|(?=<)/);
  var buffer = '';
  var i = 0;
  var chunkSize = 3; // words per tick

  function tick() {
    if (i >= words.length) {
      target.innerHTML = parsed;
      chatEl.scrollTop = chatEl.scrollHeight;
      if (callback) callback();
      return;
    }
    // Add a few words per tick for natural speed
    var end = Math.min(i + chunkSize, words.length);
    for (var j = i; j < end; j++) {
      buffer += words[j];
    }
    i = end;
    target.innerHTML = buffer;
    chatEl.scrollTop = chatEl.scrollHeight;
    requestAnimationFrame(tick);
  }
  tick();
}

function processStreamQueue() {
  if (isStreaming || streamQueue.length === 0) return;
  isStreaming = true;
  var item = streamQueue.shift();
  streamText(item.div, item.text, function() {
    isStreaming = false;
    processStreamQueue();
  });
}

function addLog(type, text) {
  // Chat tab: only user messages and agent responses
  if (type === 'user' || type === 'agent') {
    var div = document.createElement('div');
    div.className = 'log-entry log-' + type;
    if (type === 'agent') {
      chatEl.appendChild(div);
      streamQueue.push({ div: div, text: text });
      processStreamQueue();
    } else {
      div.textContent = text;
      chatEl.appendChild(div);
    }
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  // Logs tab: everything with timestamps
  var now = new Date();
  var time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  var rawDiv = document.createElement('div');
  rawDiv.className = 'raw-log raw-log-' + type;

  var preview = text;
  if (preview.length > 500) preview = preview.slice(0, 500) + '...';
  rawDiv.innerHTML = '<span class="raw-log-time">' + time + '</span>[' + type + '] ' + preview.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  rawLogsEl.appendChild(rawDiv);
  rawLogsEl.scrollTop = rawLogsEl.scrollHeight;

  // Update log count on tab
  logCounter++;
  document.querySelectorAll('.tab')[1].textContent = 'Logs (' + logCounter + ')';
}

var previewTabs = [];

function switchTab(tab) {
  currentTab = tab;
  // Deactivate all tabs and content
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.preview-frame').forEach(function(f) { f.classList.remove('active'); });

  var pc = document.getElementById('previews-container');
  var lp = document.getElementById('logs-panel');

  if (tab === 'chat') {
    document.querySelectorAll('.tab')[0].classList.add('active');
    chatEl.classList.add('active');
    chatEl.scrollTop = chatEl.scrollHeight;
    lp.style.display = 'flex';
    pc.classList.remove('has-active');
  } else if (tab === 'logs') {
    document.querySelectorAll('.tab')[1].classList.add('active');
    rawLogsEl.classList.add('active');
    rawLogsEl.scrollTop = rawLogsEl.scrollHeight;
    lp.style.display = 'flex';
    pc.classList.remove('has-active');
  } else if (tab.startsWith('preview-')) {
    var idx = previewTabs.findIndex(function(p) { return p.id === tab; });
    if (idx >= 0) {
      document.querySelectorAll('.tab')[idx + 2].classList.add('active');
      document.getElementById(tab + '-frame').classList.add('active');
      lp.style.display = 'none';
      pc.classList.add('has-active');
      activePreviewId = tab;
      var ptab = previewTabs[idx];
      document.getElementById('preview-url-input').value = ptab.url;
    }
  }
}

var activePreviewId = null;

function addPreviewTab(url, name) {
  var id = 'preview-' + Date.now();
  var existing = previewTabs.find(function(p) { return p.url === url; });
  if (existing) {
    switchTab(existing.id);
    var frame = document.getElementById(existing.id + '-frame');
    if (frame) frame.src = url;
    return;
  }

  previewTabs.push({ id: id, url: url, name: name });

  var tabEl = document.createElement('div');
  tabEl.className = 'tab tab-preview';
  tabEl.innerHTML = name + '<span class="tab-close" onclick="event.stopPropagation(); closePreview(\\'' + id + '\\')">&times;</span>';
  tabEl.onclick = function() { switchTab(id); };
  document.getElementById('tabs').appendChild(tabEl);

  var iframe = document.createElement('iframe');
  iframe.id = id + '-frame';
  iframe.className = 'preview-frame';
  iframe.src = url;
  document.getElementById('previews-container').appendChild(iframe);

  switchTab(id);
}

function getActiveFrame() {
  if (!activePreviewId) return null;
  return document.getElementById(activePreviewId + '-frame');
}

function syncUrlBar() {
  var input = document.getElementById('preview-url-input');
  var frame = getActiveFrame();
  if (frame && input) {
    try { input.value = frame.contentWindow.location.href; } catch(e) {
      var tab = previewTabs.find(function(p) { return p.id === activePreviewId; });
      if (tab) input.value = tab.url;
    }
  }
}

function previewNavigate() {
  var input = document.getElementById('preview-url-input');
  var frame = getActiveFrame();
  if (frame && input.value) {
    var url = input.value;
    if (url.indexOf('http') !== 0) url = 'http://' + url;
    frame.src = url;
    var ptab = previewTabs.find(function(p) { return p.id === activePreviewId; });
    if (ptab) ptab.url = url;
  }
}

function previewReload() {
  var frame = getActiveFrame();
  if (frame) {
    var current = frame.src;
    frame.src = 'about:blank';
    setTimeout(function() { frame.src = current; }, 50);
  }
}

function previewBack() {
  var input = document.getElementById('preview-url-input');
  if (input) { input.focus(); }
}

function previewForward() {
  var input = document.getElementById('preview-url-input');
  if (input) { input.focus(); }
}

function closePreview(id) {
  var idx = previewTabs.findIndex(function(p) { return p.id === id; });
  if (idx < 0) return;
  previewTabs.splice(idx, 1);
  // Remove tab (idx+2 because chat=0, logs=1)
  var tabs = document.querySelectorAll('.tab');
  if (tabs[idx + 2]) tabs[idx + 2].remove();
  // Remove iframe
  var frame = document.getElementById(id + '-frame');
  if (frame) frame.remove();
  // Switch back to chat
  switchTab('chat');
}



var currentTasks = [];

function renderTasks(tasks) {
  currentTasks = tasks.map(function(t) {
    var existing = currentTasks.find(function(e) { return e.id === t.id; });
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      type: t.type || 'agent',
      provider: t.provider || '',
      model: t.model || '',
      startedAt: existing ? existing.startedAt : (t.status === 'running' ? Date.now() - (t.elapsed || 0) * 1000 : null),
      elapsed: t.elapsed || 0
    };
  });
  drawTasks();
}

function drawTasks() {
  var el = document.getElementById('tasks-list');
  if (currentTasks.length === 0) {
    el.innerHTML = '<span class="empty-state">No active tasks</span>';
    return;
  }
  el.innerHTML = currentTasks.map(function(t) {
    var cls = 'task-' + t.status;
    var elapsed = '';
    if (t.status === 'running' && t.startedAt) {
      elapsed = ' ' + Math.floor((Date.now() - t.startedAt) / 1000) + 's';
    }
    var safeName = t.name.replace(/'/g, '');
    var typeIcon = { agent: '◆', process: '▶', background: '⟳' }[t.type || 'agent'] || '○';
    var typeLabel = { agent: 'Agent', process: 'Process', background: 'Task' }[t.type || 'agent'] || '';
    var killBtn = t.status === 'running'
      ? '<span class="task-kill" onclick="event.stopPropagation(); killTask(\\'' + t.id + '\\',\\'' + safeName + '\\')" title="Kill">✕</span>'
      : '';
    var modelTag = t.provider ? '<span style="color:#6c7086;font-size:9px;margin-left:4px">' + (t.model || t.provider) + '</span>' : '';
    return '<div class="task-item ' + cls + '" onclick="openAgentDetail(\\'' + t.id + '\\',\\'' + safeName + '\\')">'
      + '<span class="task-dot"></span>'
      + '<span style="opacity:0.5;font-size:10px;margin-right:4px">' + typeIcon + '</span>'
      + t.name + elapsed + modelTag + killBtn
      + '</div>';
  }).join('');
}

// Update task timers every second
setInterval(function() {
  if (currentTasks.some(function(t) { return t.status === 'running'; })) {
    drawTasks();
  }
}, 1000);

var activeAgentId = null;

function openAgentDetail(taskId, name) {
  activeAgentId = taskId;
  document.getElementById('agent-detail-name').textContent = '◆ ' + name;
  document.getElementById('agent-detail').classList.add('show');
  document.getElementById('agent-detail-logs').innerHTML = '<span class="empty-state">Loading...</span>';
  ws.send(JSON.stringify({ type: 'get_agent_logs', taskId: taskId }));
}

function killTask(taskId, name) {
  if (confirm('Kill process "' + name + '"?')) {
    ws.send(JSON.stringify({ type: 'kill_task', taskId: taskId }));
  }
}

function closeAgentDetail() {
  activeAgentId = null;
  document.getElementById('agent-detail').classList.remove('show');
}

function renderAgentLogs(logs) {
  const el = document.getElementById('agent-detail-logs');
  if (!logs || logs.length === 0) {
    el.innerHTML = '<span class="empty-state">No logs yet...</span>';
    return;
  }
  el.innerHTML = logs.map(l => {
    return '<div class="agent-log-entry agent-log-' + l.type + '">' + l.text + '</div>';
  }).join('');
  el.scrollTop = el.scrollHeight;
}

function renderTools(tools) {
  var el = document.getElementById('tools-list');
  var custom = tools.filter(function(t) { return !t.builtin; });
  document.getElementById('tools-count-sidebar').textContent = custom.length;
  if (custom.length === 0) {
    el.innerHTML = '<span class="empty-state">No custom tools yet</span>';
    return;
  }
  el.innerHTML = custom.map(function(t) {
    return '<div class="tool-item dynamic">⚡ ' + t.name + '</div>';
  }).join('');
}

function renderModels(providers) {
  var el = document.getElementById('models-list');
  if (!providers || providers.length === 0) {
    el.innerHTML = '<span class="empty-state">No providers</span>';
    return;
  }
  el.innerHTML = providers.map(function(p) {
    var icon = '☁️';
    var label = ' (API)';
    var models = (p.models || []).slice(0, 4).join(', ');
    if ((p.models || []).length > 4) models += ' +' + (p.models.length - 4);
    return '<div class="model-item">' + icon + ' <span class="model-provider">' + p.name + '</span>' + label + '<br><span class="model-name" style="padding-left:18px">' + (models || 'default') + '</span></div>';
  }).join('');
}

function fmtTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function updateTokenReport(entry, summary) {
  // Update summary counters
  document.getElementById('tk-calls').textContent = summary.entries;
  document.getElementById('tk-input').textContent = fmtTokens(summary.total_input);
  document.getElementById('tk-output').textContent = fmtTokens(summary.total_output);
  document.getElementById('tk-total').textContent = fmtTokens(summary.total_tokens);
  document.getElementById('tk-cost').textContent = '$' + summary.total_cost.toFixed(6);

  // Add entry to log
  var logEl = document.getElementById('token-log');
  var div = document.createElement('div');
  div.style.cssText = 'font-size:10px;padding:3px 4px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:4px';
  var time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  div.innerHTML = '<span style="color:var(--subtext)">' + time + '</span>'
    + '<span style="color:var(--cyan)">' + entry.source.slice(0, 10) + '</span>'
    + '<span style="color:var(--text)">' + fmtTokens(entry.total_tokens) + '</span>'
    + '<span style="color:var(--green)">$' + entry.cost_usd.toFixed(6) + '</span>';
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

var thinkingInterval = null;
var thinkingStart = 0;

function startThinking() {
  thinkingStart = Date.now();
  var el = document.getElementById('chat-thinking');
  el.classList.add('show');
  // Move to bottom of chat
  chatEl.appendChild(el);
  chatEl.scrollTop = chatEl.scrollHeight;

  if (thinkingInterval) clearInterval(thinkingInterval);
  thinkingInterval = setInterval(function() {
    var secs = Math.floor((Date.now() - thinkingStart) / 1000);
    document.getElementById('thinking-timer').textContent = secs + 's';
    chatEl.scrollTop = chatEl.scrollHeight;
  }, 1000);
}

function stopThinking() {
  var el = document.getElementById('chat-thinking');
  el.classList.remove('show');
  if (thinkingInterval) { clearInterval(thinkingInterval); thinkingInterval = null; }
}

function updateAutoBadge(on) {
  var badge = document.getElementById('auto-badge');
  badge.textContent = on ? 'auto-accept' : 'confirm';
  badge.className = 'badge ' + (on ? 'badge-on' : 'badge-off');
}

function confirmAction(action) {
  confirmOverlay.classList.remove('show');
  inputEl.disabled = false;
  inputEl.focus();

  if (action === 'all') {
    ws.send(JSON.stringify({ type: 'confirm_response', accepted: true, action: 'accept_all' }));
  } else {
    ws.send(JSON.stringify({ type: 'confirm_response', accepted: action }));
  }
}

// Keyboard shortcuts for confirm
document.addEventListener('keydown', (e) => {
  if (confirmOverlay.classList.contains('show')) {
    if (e.key === 'y' || e.key === 'Y') confirmAction(true);
    else if (e.key === 'n' || e.key === 'N') confirmAction(false);
    else if (e.key === 'a' || e.key === 'A') confirmAction('all');
    e.preventDefault();
    return;
  }
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';

    if (text.startsWith('/')) {
      ws.send(JSON.stringify({ type: 'command', cmd: text }));
    } else {
      ws.send(JSON.stringify({ type: 'chat', text }));
    }
  }
});
<\/script>
</body>
</html>`;
}
