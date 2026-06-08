// AI Assistant — Cornell's Floor
// Construieste system prompt din datele live ale aplicatiei, trimite la /api/ai-chat

const STRAJA_CANAL = window.__STRAJA_CANAL__;
const STRAJA_REFULARE = window.__STRAJA_REFULARE__;
const STRAJA_APA = window.__STRAJA_APA__;

let conversationHistory = [];
let isOpen = false;
let isListening = false;
let recognition = null;
let synth = window.speechSynthesis;

// ── Sistem prompt generat din datele live ─────────────────────────────────────

function buildSystemPrompt(state, progressData, canal, refulare, apa) {
  const totalProjCanal = canal.reduce((s, r) => s + r.proj, 0);
  const totalExecCanal = canal.reduce((s, r) => s + r.exec, 0);
  const totalProjRef   = refulare.reduce((s, r) => s + r.proj, 0);
  const totalExecRef   = refulare.reduce((s, r) => s + r.exec, 0);
  const totalProjApa   = apa.reduce((s, r) => s + r.proj, 0);
  const totalExecApa   = apa.reduce((s, r) => s + r.exec, 0);

  const canalLines = canal.map(r =>
    `  ${r.id}: proiectat ${r.proj}m, executat ${r.exec}m, ramas ${r.proj - r.exec}m` +
    (r.cv ? `, CV=${r.cv}` : '') +
    (r.rac ? `, RAC=${r.rac}` : '') +
    (r.per ? `, perioada: ${r.per}` : '') +
    (r.obs ? `, obs: ${r.obs}` : '')
  ).join('\n');

  const refLines = refulare.map(r =>
    `  ${r.id} (${r.dn}): proiectat ${r.proj}m, executat ${r.exec}m, ramas ${r.proj - r.exec}m` +
    (r.per ? `, perioada: ${r.per}` : '')
  ).join('\n');

  const apaLines = apa.map(r =>
    `  ${r.id}: proiectat ${r.proj}m, executat ${r.exec}m, ramas ${r.proj - r.exec}m` +
    (r.brans ? `, bransamente=${r.brans}` : '') +
    (r.per ? `, perioada: ${r.per}` : '')
  ).join('\n');

  const sitesText = (state.sites || []).map(s =>
    `  - ${s.name} (${s.location}): progres ${s.progress}%, status: ${s.status}`
  ).join('\n');

  const workersText = (state.workers || []).filter(w => w.active !== false).map(w =>
    `  - ${w.name} (${w.card})`
  ).join('\n');

  // Merge progressData (valori live din Firebase) peste constantele statice
  const mergeRow = (row, cat) => {
    const live = (progressData || {})[cat]?.[row.id] || {};
    return { ...row, ...Object.fromEntries(Object.entries(live).map(([k, v]) => [k, Number(v) || v])) };
  };
  const canalLive = canal.map(r => mergeRow(r, 'canal'));
  const refLive   = refulare.map(r => mergeRow(r, 'refulare'));
  const apaLive   = apa.map(r => mergeRow(r, 'apa'));

  const totalExecCanalLive = canalLive.reduce((s, r) => s + (r.exec || 0), 0);
  const totalExecRefLive   = refLive.reduce((s, r) => s + (r.exec || 0), 0);
  const totalExecApaLive   = apaLive.reduce((s, r) => s + (r.exec || 0), 0);

  return `Esti asistentul AI al inginerului Vitel Silviu de la firma Cornell's Floor. \
Lucrezi pe santierul STRAJA (sistem apa-canal). Raspunzi DOAR in limba romana, concis si direct. \
Ai acces la toate datele de mai jos si poti raspunde imediat fara sa cauti — le stii deja.

== SANTIER STRAJA — CANAL GRAVITATIONAL ==
Total proiectat: ${totalProjCanal}m | Executat: ${totalExecCanalLive}m | Ramas: ${totalProjCanal - totalExecCanalLive}m
Tronsoana:
${canalLive.map(r =>
  `  ${r.id}: proj=${r.proj}m exec=${r.exec}m ramas=${r.proj-(r.exec||0)}m` +
  (r.cv ? ` CV=${r.cv}` : '') + (r.rac ? ` RAC=${r.rac}` : '') +
  (r.per ? ` [${r.per}]` : '') + (r.obs ? ` (${r.obs})` : '')
).join('\n')}

== REFULARE ==
Total proiectat: ${totalProjRef}m | Executat: ${totalExecRefLive}m | Ramas: ${totalProjRef - totalExecRefLive}m
${refLive.map(r =>
  `  ${r.id}(${r.dn}): proj=${r.proj}m exec=${r.exec||0}m ramas=${r.proj-(r.exec||0)}m` +
  (r.per ? ` [${r.per}]` : '')
).join('\n')}

== APA POTABILA ==
Total proiectat: ${totalProjApa}m | Executat: ${totalExecApaLive}m | Ramas: ${totalProjApa - totalExecApaLive}m
${apaLive.map(r =>
  `  ${r.id}: proj=${r.proj}m exec=${r.exec||0}m ramas=${r.proj-(r.exec||0)}m` +
  (r.brans ? ` brans=${r.brans}` : '') + (r.per ? ` [${r.per}]` : '')
).join('\n')}

== SANTIERE GENERALE ==
${sitesText || '  (niciun santier adaugat)'}

== ECHIPA ==
${workersText || '  (nicio persoana)'}

Raspunde direct la intrebare. Daca se cere un calcul (procent, rest, total), calculeaza si spune rezultatul.`;
}

// ── Trimitere mesaj la API ────────────────────────────────────────────────────

async function sendMessage(userText, state, progressData, canal, refulare, apa) {
  conversationHistory.push({ role: 'user', content: userText });

  const systemPrompt = buildSystemPrompt(state, progressData, canal, refulare, apa);

  const res = await fetch('/api/ai-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: conversationHistory, systemPrompt }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Eroare server.');

  conversationHistory.push({ role: 'assistant', content: data.reply });
  return data.reply;
}

// ── Voice ────────────────────────────────────────────────────────────────────

function startListening(onResult, onError) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { onError('Browserul nu suporta recunoastere vocala.'); return; }

  recognition = new SpeechRecognition();
  recognition.lang = 'ro-RO';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    onResult(text);
  };
  recognition.onerror = (e) => onError(e.error);
  recognition.onend = () => { isListening = false; updateMicBtn(); };
  recognition.start();
  isListening = true;
  updateMicBtn();
}

function stopListening() {
  if (recognition) { recognition.stop(); recognition = null; }
  isListening = false;
  updateMicBtn();
}

function speak(text) {
  if (!synth) return;
  synth.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'ro-RO';
  utt.rate = 1.05;
  synth.speak(utt);
}

// ── UI ────────────────────────────────────────────────────────────────────────

function updateMicBtn() {
  const btn = document.getElementById('aiMicBtn');
  if (!btn) return;
  btn.classList.toggle('ai-mic-active', isListening);
  btn.title = isListening ? 'Opreste ascultarea' : 'Vorbeste cu asistentul';
}

function appendMessage(role, text) {
  const log = document.getElementById('aiChatLog');
  if (!log) return;
  const div = document.createElement('div');
  div.className = `ai-msg ai-msg-${role}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function setThinking(show) {
  const el = document.getElementById('aiThinking');
  if (el) el.hidden = !show;
}

function initUI(getState, getProgress, canal, refulare, apa) {
  const fab      = document.getElementById('aiFab');
  const panel    = document.getElementById('aiPanel');
  const closeBtn = document.getElementById('aiCloseBtn');
  const form     = document.getElementById('aiForm');
  const input    = document.getElementById('aiInput');
  const micBtn   = document.getElementById('aiMicBtn');

  if (!fab || !panel) return;

  fab.addEventListener('click', () => {
    isOpen = !isOpen;
    panel.hidden = !isOpen;
    fab.classList.toggle('ai-fab-open', isOpen);
    if (isOpen && document.getElementById('aiChatLog').children.length === 0) {
      appendMessage('assistant', 'Salut! Sunt asistentul tau pentru santierul Straja. Ce vrei sa stii?');
    }
    if (isOpen) input?.focus();
  });

  closeBtn?.addEventListener('click', () => {
    isOpen = false;
    panel.hidden = true;
    fab.classList.remove('ai-fab-open');
    stopListening();
    synth?.cancel();
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await handleUserMessage(text, getState, getProgress, canal, refulare, apa);
  });

  micBtn?.addEventListener('click', () => {
    if (isListening) {
      stopListening();
    } else {
      startListening(
        async (text) => {
          input.value = text;
          await handleUserMessage(text, getState, getProgress, canal, refulare, apa);
          input.value = '';
        },
        (err) => appendMessage('assistant', `Eroare microfon: ${err}`)
      );
    }
  });
}

async function handleUserMessage(text, getState, getProgress, canal, refulare, apa) {
  appendMessage('user', text);
  setThinking(true);
  try {
    const reply = await sendMessage(text, getState(), getProgress(), canal, refulare, apa);
    setThinking(false);
    appendMessage('assistant', reply);
    speak(reply);
  } catch (err) {
    setThinking(false);
    appendMessage('assistant', `Eroare: ${err.message}`);
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

export function initAIAssistant(getState, getProgress, canal, refulare, apa) {
  initUI(getState, getProgress, canal, refulare, apa);
}
