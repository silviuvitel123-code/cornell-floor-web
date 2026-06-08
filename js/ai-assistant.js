// AI Assistant — Cornell's Floor
// Construieste system prompt din datele live ale aplicatiei, trimite la /api/ai-chat
// Datele (canal/refulare/apa) si actiunile vin prin initAIAssistant() din app.js.

let conversationHistory = [];
let isOpen = false;
let isListening = false;
let recognition = null;
let synth = window.speechSynthesis;

// Date reale extrase din proiectul tehnic (Liste cantitati + Excel Santier Straja)
const STRAJA_PROJECT_INFO = `== INFORMATII PROIECT TEHNIC STRAJA ==
Obiectiv: Extinderea retelei de distributie a apei si extinderea retelei de canalizare in comuna Straja, judetul Suceava.
Beneficiar: Comuna Straja
Proiectant: S.C. CONALID S.R.L. (Iasi)
Faza proiectare: P.TH. + C.S. + D.D.E.
Contract: 6690 / 18.09.2024

RETEA CANALIZARE menajera (gravitationala):
- Material: PP Multistrat Corugat SN8, Dn 250 mm
- Total proiectat: 15.835 m | Executat (la ultima actualizare): 5.686 m
- 41 tronsoane (Cm1 - Cm41)
- Camine de vizitare (CV) si camine de racord
- Include subtraversari drumuri si vai, refacere drumuri (balastate, asfaltate, beton)

RETEA REFULARE (canalizare sub presiune):
- Material: PEHD-RC cu protectie PP, PE100, Pn10
- Dn 90 mm: 2.409 m + Dn 110 mm: 795 m = 3.204 m total proiectat
- 9 tronsoane (CR1 - CR9)

RETEA APA POTABILA (distributie):
- Material: PEHD-RC cu protectie PP, PE100, Pn10
- 34 tronsoane (CD1 - CD20, CD22 - CD35)
- Camine de vane si bransamente

STATII DE POMPARE APA UZATA (SPAU):
- 9 statii de pompare: SPAU 1 ... SPAU 9, fiecare cu racord electric propriu

Tipuri camine: vizitare (canal), racord (canal), vane (apa si refulare), bransament (apa).

NOTA: Datele sunt la nivel de TRONSON. Lungimile individuale intre doua camine (ex: de la CV21.30 la CV21.56) NU exista in baza de date - se gasesc doar pe profilele longitudinale din plansele de proiect. Daca esti intrebat despre un segment intre doua camine, spune onest ca acea valoare e pe plansa (profil longitudinal), nu in datele disponibile. NU inventa cifre.`;

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

${STRAJA_PROJECT_INFO}

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

Raspunde direct la intrebare. Daca se cere un calcul (procent, rest, total), calculeaza si spune rezultatul.

POTI EFECTUA ACTIUNI prin uneltele disponibile:
- actualizeaza_progres: cand utilizatorul spune cati metri a executat pe un tronson, sau modifica camine/racorduri/bransamente/perioada/observatii. Ex: "am facut 800 de metri pe Cm13" -> actualizeaza_progres(canal, Cm13, exec, 800).
- pontaj: cand cere sa ponteze pe cineva, concediu sau zi libera.
- genereaza_raport: cand cere un raport/situatie/rezumat al stadiului.
Dupa ce o unealta ruleaza, confirma pe scurt in limba romana ce ai facut, folosind rezultatul primit. Nu inventa valori — daca o unealta da eroare, spune exact ce eroare.`;
}

// ── Unelte (tool use) ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "actualizeaza_progres",
    description: "Actualizeaza progresul pentru un tronson din santierul Straja. Foloseste cand utilizatorul spune cati metri a executat sau vrea sa modifice executat/camine/racorduri/bransamente/perioada/observatii pentru un tronson.",
    input_schema: {
      type: "object",
      properties: {
        categorie: { type: "string", enum: ["canal", "refulare", "apa"], description: "canal=tronsoane Cm, refulare=tronsoane CR, apa=tronsoane CD" },
        tronson: { type: "string", description: "ID-ul tronsonului, ex: Cm13, CR3, CD5" },
        camp: { type: "string", enum: ["exec", "cv", "rac", "brans", "per", "obs"], description: "exec=metri executati, cv=camine vizitare/vane, rac=racorduri, brans=bransamente, per=perioada executiei, obs=observatii" },
        valoare: { type: "string", description: "Valoarea noua. Numar pentru exec/cv/rac/brans; text pentru per/obs." },
      },
      required: ["categorie", "tronson", "camp", "valoare"],
    },
  },
  {
    name: "pontaj",
    description: "Ponteaza o persoana (muncitor sau inginer) pentru o zi. Foloseste cand utilizatorul cere sa ponteze pe cineva, sa marcheze concediu (CO) sau zi libera.",
    input_schema: {
      type: "object",
      properties: {
        persoana: { type: "string", description: "Numele sau parte din numele persoanei. Pentru inginer: 'inginer' sau 'Vitel'." },
        data: { type: "string", description: "Data in format YYYY-MM-DD. Daca lipseste = ziua de azi." },
        tip: { type: "string", enum: ["8h", "10h", "CO", "liber"], description: "8h=08:00-17:00, 10h=07:00-17:30, CO=concediu, liber=0 ore" },
      },
      required: ["persoana", "tip"],
    },
  },
  {
    name: "genereaza_raport",
    description: "Genereaza un raport cu stadiul executiei pe retele. Foloseste cand utilizatorul cere un raport, o situatie sau un rezumat al progresului.",
    input_schema: {
      type: "object",
      properties: {
        sectiune: { type: "string", enum: ["canal", "refulare", "apa", "tot"], description: "Ce retea sa includa. 'tot' = canal + refulare + apa." },
      },
      required: ["sectiune"],
    },
  },
];

async function executeTool(name, input, actions) {
  try {
    if (name === "actualizeaza_progres") return await actions.updateProgress(input);
    if (name === "pontaj")               return await actions.setPontaj(input);
    if (name === "genereaza_raport")     return await actions.generateReport(input);
    return `Unealta necunoscuta: ${name}`;
  } catch (e) {
    return `Eroare la executie: ${e.message}`;
  }
}

// ── Trimitere mesaj la API (cu bucla de tool use) ─────────────────────────────

async function sendMessage(userText, ctx) {
  conversationHistory.push({ role: 'user', content: userText });

  let guard = 0;
  while (guard++ < 6) {
    // Reconstruim system prompt-ul la fiecare pas — reflecta datele actualizate de unelte
    const systemPrompt = buildSystemPrompt(ctx.getState(), ctx.getProgress(), ctx.canal, ctx.refulare, ctx.apa);

    const res = await fetch('/api/ai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversationHistory, systemPrompt, tools: TOOLS }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Eroare server.');

    conversationHistory.push({ role: 'assistant', content: data.content });

    if (data.stop_reason === 'tool_use') {
      const toolResults = [];
      for (const block of data.content) {
        if (block.type === 'tool_use') {
          const result = await executeTool(block.name, block.input, ctx.actions);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: String(result) });
        }
      }
      conversationHistory.push({ role: 'user', content: toolResults });
      continue; // mai cerem un raspuns ca sa confirme in cuvinte
    }

    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();
    return text || '(gata)';
  }
  return 'Am oprit dupa prea multe operatii consecutive.';
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

function initUI(ctx) {
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
      appendMessage('assistant', 'Salut! Sunt asistentul tau pentru santierul Straja. Pot raspunde la intrebari, pot completa progresul, pot ponta si pot scoate rapoarte. Ce facem?');
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
    await handleUserMessage(text, ctx);
  });

  micBtn?.addEventListener('click', () => {
    if (isListening) {
      stopListening();
    } else {
      startListening(
        async (text) => {
          input.value = text;
          await handleUserMessage(text, ctx);
          input.value = '';
        },
        (err) => appendMessage('assistant', `Eroare microfon: ${err}`)
      );
    }
  });
}

async function handleUserMessage(text, ctx) {
  appendMessage('user', text);
  setThinking(true);
  try {
    const reply = await sendMessage(text, ctx);
    setThinking(false);
    appendMessage('assistant', reply);
    speak(reply);
  } catch (err) {
    setThinking(false);
    appendMessage('assistant', `Eroare: ${err.message}`);
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

export function initAIAssistant(getState, getProgress, canal, refulare, apa, actions) {
  const ctx = { getState, getProgress, canal, refulare, apa, actions: actions || {} };
  initUI(ctx);
}
