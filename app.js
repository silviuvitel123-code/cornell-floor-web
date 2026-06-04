import {
  initFirebase,
  isFirebaseConfigured,
  watchAuth,
  login,
  register,
  logout,
  subscribeToState,
  saveStateToCloud,
  subscribeToFiles,
  uploadFile,
  deleteFile,
  getDriveToken,
  subscribeToProgress,
  saveProgress,
} from "./js/db.js";

const storageKey = "cf-cornells-floor-v1";
const monthNames = ["Ianuarie", "Februarie", "Martie", "Aprilie", "Mai", "Iunie", "Iulie", "August", "Septembrie", "Octombrie", "Noiembrie", "Decembrie"];
const dayNames = ["Duminica", "Luni", "Marti", "Miercuri", "Joi", "Vineri", "Sambata"];
const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const $ = (selector) => document.querySelector(selector);

let toastTimer = null;
let saveTimer = null;
let stateUnsubscribe = null;
let currentUser = null;
let cloudReady = false;
let applyingRemote = false;
let selectedDate = "";
let currentSiteId = null;
let currentChapterKey = null;
let filesUnsubscribe = null;
let state = createDefaultState();

function todayIso() {
  return formatIso(new Date());
}

function monthStartIso() {
  const date = new Date();
  return formatIso(new Date(date.getFullYear(), date.getMonth(), 1));
}

function monthEndIso() {
  const date = new Date();
  return formatIso(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthKeyFromIso(iso) {
  if (!iso) return "";
  return iso.slice(0, 7);
}

function setTimesheetRange(from, to) {
  const fromInput = $("#fromDate");
  const toInput = $("#toDate");
  if (fromInput) fromInput.value = from;
  if (toInput) toInput.value = to;
}

function syncTimesheetToCurrentMonth(options = {}) {
  const monthKey = currentMonthKey();
  const from = monthStartIso();
  const to = monthEndIso();
  const fromInput = $("#fromDate")?.value;
  const toInput = $("#toDate")?.value;
  const inputsMatch = fromInput === from && toInput === to;
  const storedMonth = state.lastTimesheetMonth || monthKeyFromIso(fromInput);
  const monthChanged = storedMonth && storedMonth !== monthKey;

  if (!monthChanged && inputsMatch && !options.force) return false;

  setTimesheetRange(from, to);
  state.workers.forEach((worker) => {
    if (worker.active !== false) fillMonth(worker);
  });
  state.lastTimesheetMonth = monthKey;

  if (options.notifyUser && monthChanged) {
    const [, month] = monthKey.split("-");
    notify(`Pontajul a trecut automat la luna ${monthNames[Number(month) - 1]}.`);
  }
  return true;
}

function createDefaultState() {
  const engineer = createWorker("Ing. Vitel Silviu", "CARD", true);
  const gabriel = createWorker("Simonescu Gabriel", "5500\nCARD", false);
  fillMonth(engineer);
  fillMonth(gabriel);
  setDay(gabriel, "2026-05-06", "CO");
  return {
    company: "S.C. CORNELL floor S.R.L.",
    fiscalCode: "24616580",
    workers: [engineer, gabriel],
    sites: [
      { id: uid(), name: "Complex rezidential Nord", location: "Bucuresti", progress: 78, status: "Structura nivel 8" },
      { id: uid(), name: "Hala productie Otopeni", location: "Otopeni", progress: 42, status: "Fundatii si utilitati" },
      { id: uid(), name: "Amenajare birouri Cornell", location: "Pipera", progress: 91, status: "Finisaje finale" },
    ],
    alerts: [
      { id: uid(), type: "Pontaj", text: "Genereaza foaia colectiva pentru intervalul curent.", severity: "warn" },
      { id: uid(), type: "Santier", text: "Hala Otopeni are progres sub plan.", severity: "danger" },
      { id: uid(), type: "Documente", text: "Vor urma notificari din modulele viitoare.", severity: "ok" },
    ],
    lastTimesheetMonth: currentMonthKey(),
  };
}

function loadLocalState() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) return JSON.parse(saved);
  } catch (error) {
    console.warn("Nu pot citi datele locale.", error);
  }
  return createDefaultState();
}

function loadState() {
  return loadLocalState();
}

function saveStateLocal() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch (error) {
    console.warn("Nu pot salva datele locale.", error);
  }
}

function scheduleCloudSave() {
  saveStateLocal();
  if (!cloudReady || !currentUser || applyingRemote) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try {
      setSyncStatus("Se salveaza in cloud...");
      await saveStateToCloud(currentUser.uid, state);
      setSyncStatus(`Sincronizat: ${new Date().toLocaleString("ro-RO")}`);
    } catch (error) {
      setSyncStatus(`Eroare salvare: ${error.message}`);
      notify("Salvarea in cloud a esuat.");
    }
  }, 700);
}

function saveState() {
  scheduleCloudSave();
}

function setSyncStatus(message) {
  const el = $("#syncStatus");
  if (el) el.textContent = message;
}

function renderAccountPanel() {
  const emailEl = $("#accountEmail");
  const modeEl = $("#accountMode");
  const logoutBtn = $("#logoutBtn");
  const sidebarLogout = $("#sidebarLogout");
  const sidebarUser = $("#sidebarUser");
  if (!emailEl || !modeEl) return;

  if (!isFirebaseConfigured()) {
    emailEl.textContent = "Firebase neconfigurat";
    modeEl.textContent = "Datele raman doar in browser (localStorage).";
    if (logoutBtn) logoutBtn.hidden = true;
    if (sidebarLogout) sidebarLogout.hidden = true;
    setSyncStatus("Mod local — fara cloud.");
    return;
  }

  if (logoutBtn) logoutBtn.hidden = !currentUser;
  if (sidebarLogout) sidebarLogout.hidden = !currentUser;
  if (sidebarUser) sidebarUser.textContent = currentUser?.email || "";

  if (currentUser) {
    emailEl.textContent = currentUser.email || "Cont activ";
    modeEl.textContent = cloudReady
      ? "Date sincronizate automat intre laptop si telefon."
      : "Se incarca datele din cloud...";
  } else {
    emailEl.textContent = "Neautentificat";
    modeEl.textContent = "Autentifica-te pentru sync intre dispozitive.";
    if (sidebarUser) sidebarUser.textContent = "";
  }
}

function createWorker(name, card = "CARD", isEngineer = false) {
  return { id: uid(), name, card, isEngineer, active: true, days: {} };
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function eachDate(from, to) {
  const dates = [];
  const cursor = parseDate(from);
  const end = parseDate(to);
  while (cursor <= end) {
    dates.push(formatIso(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function isWeekendIso(iso) {
  const day = parseDate(iso).getDay();
  return day === 0 || day === 6;
}

function weekendLabelIso(iso) {
  return dayNames[parseDate(iso).getDay()];
}

function defaultDay(iso) {
  if (isWeekendIso(iso)) {
    const label = weekendLabelIso(iso);
    return { in: label, pause: label, out: label, hours: label };
  }
  return { in: "08:00", pause: "12:00-13:00", out: "17:00", hours: "8" };
}

function getDay(worker, iso) {
  if (!worker.days[iso]) worker.days[iso] = defaultDay(iso);
  return worker.days[iso];
}

function setDay(worker, iso, mode) {
  if (mode === "CO") worker.days[iso] = { in: "CO", pause: "CO", out: "CO", hours: "CO" };
  if (mode === "8h") worker.days[iso] = { in: "08:00", pause: "12:00-13:00", out: "17:00", hours: "8" };
  if (mode === "10h") worker.days[iso] = { in: "07:00", pause: "12:00-12:30", out: "17:30", hours: "10" };
  if (mode === "0h") worker.days[iso] = { in: "", pause: "", out: "", hours: "" };
}

function formatDateLabel(iso) {
  try {
    return new Intl.DateTimeFormat("ro-RO", { day: "numeric", month: "long" }).format(parseDate(iso));
  } catch {
    return iso;
  }
}

function clearWorkerRange(worker, from, to) {
  eachDate(from, to).forEach((iso) => {
    if (!isWeekendIso(iso)) {
      worker.days[iso] = { in: "", pause: "", out: "", hours: "" };
    }
  });
}

function fillMonth(worker) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  eachDate(formatIso(start), formatIso(end)).forEach((iso) => {
    worker.days[iso] = defaultDay(iso);
  });
}

function render() {
  if (!appReady) return;
  scheduleCloudSave();
  renderSummary();
  renderSites();
  renderWorkers();
  renderSheetPreview();
  renderAccountPanel();
}

let appReady = false;

function renderSummary() {
  const activeSites = state.sites.length;
  const avgProgress = Math.round(state.sites.reduce((sum, site) => sum + Number(site.progress), 0) / Math.max(activeSites, 1));
  const activeWorkers = state.workers.filter((worker) => worker.active).length;
  const alerts = state.alerts.length;
  $("#alertBadge")?.textContent && ($("#alertBadge").textContent = alerts);
  $("#summaryGrid").innerHTML = [
    ["Santiere active", activeSites, `${avgProgress}% progres mediu`, avgProgress],
    ["Oameni in pontaj", activeWorkers, "inclusiv inginerul", Math.min(activeWorkers * 18, 100)],
    ["Alerte", alerts, "notificari program", Math.min(alerts * 25, 100)],
    ["Pontaj luna", `${engineerMonthHours()}h`, "Ing. Vitel Silviu", Math.min(engineerMonthHours(), 100)],
  ].map(([label, value, detail, meter]) => `
    <article class="summary-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <p class="muted">${detail}</p>
      <div class="meter" style="--value:${meter}%"><i></i></div>
    </article>
  `).join("");

  $("#homeSites").innerHTML = state.sites.map((site) => `
    <article class="site-row">
      <div class="site-row-top">
        <h3>${escapeHtml(site.name)}</h3>
        <span class="pill">${site.progress}%</span>
      </div>
      <p class="muted">${escapeHtml(site.location)} | ${escapeHtml(site.status)}</p>
      <div class="meter" style="--value:${site.progress}%"><i></i></div>
    </article>
  `).join("");

  $("#homeAlerts").innerHTML = state.alerts.map((alert) => `
    <article class="alert-row">
      <div class="site-row-top">
        <strong>${escapeHtml(alert.type)}</strong>
        <span class="pill ${alert.severity === "danger" ? "danger" : alert.severity === "ok" ? "ok" : ""}">${alert.severity}</span>
      </div>
      <p>${escapeHtml(alert.text)}</p>
    </article>
  `).join("");
}

function engineerMonthHours() {
  const engineer = state.workers.find((worker) => worker.isEngineer);
  if (!engineer) return 0;
  const now = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return Object.entries(engineer.days)
    .filter(([iso]) => iso.startsWith(prefix))
    .reduce((sum, [, day]) => sum + (Number(day.hours) || 0), 0);
}

function renderSites() {
  $("#siteEditor").innerHTML = state.sites.map((site) => `
    <article class="site-edit-row">
      <label>Nume <input data-site="${site.id}" data-field="name" value="${escapeAttr(site.name)}" /></label>
      <label>Status <input data-site="${site.id}" data-field="status" value="${escapeAttr(site.status)}" /></label>
      <label>Progres <input type="number" min="0" max="100" data-site="${site.id}" data-field="progress" value="${site.progress}" /></label>
      <label>Locatie <input data-site="${site.id}" data-field="location" value="${escapeAttr(site.location)}" /></label>
      <button class="mini-btn" data-delete-site="${site.id}">Sterge</button>
    </article>
  `).join("");
}

function renderWorkers() {
  const engineer = state.workers.find((worker) => worker.isEngineer);
  const today = todayIso();
  const sel = selectedDate || today;
  const engineerDay = getDay(engineer, today);
  $("#selfTodayStatus").textContent = engineerDay.hours === "CO" ? "CO azi" : engineerDay.hours ? `${engineerDay.in} - ${engineerDay.out}, ${engineerDay.hours}h` : "Nepontat azi";
  $("#selfHoursMonth").textContent = `${engineerMonthHours()} ore luna aceasta`;

  const isToday = sel === today;
  const dateLabel = isToday ? "azi" : formatDateLabel(sel);
  const punchBtn = $("#punchEngineerDay");
  const coBtn = $("#markEngineerCo");
  if (punchBtn) punchBtn.textContent = `Ponteaza ${dateLabel} 08:00-17:00`;
  if (coBtn) coBtn.textContent = `CO ${dateLabel}`;

  $("#workerList").innerHTML = state.workers.map((worker) => {
    const day = getDay(worker, sel);
    return `
      <article class="worker-row">
        <div class="worker-top">
          <div>
            <h3>${escapeHtml(worker.name)}</h3>
            <p class="muted">${escapeHtml(worker.card).replaceAll("\n", " / ")}${worker.isEngineer ? " | inginer" : ""}</p>
          </div>
          <span class="pill ${worker.active ? "ok" : "danger"}">${worker.active ? "activ" : "scos"}</span>
        </div>
        <div class="worker-hours">
          <button data-worker-day="${worker.id}" data-mode="8h" class="${day.hours === "8" ? "active" : ""}">8h</button>
          <button data-worker-day="${worker.id}" data-mode="10h" class="${day.hours === "10" ? "active" : ""}">10h</button>
          <button data-worker-day="${worker.id}" data-mode="CO" class="${day.hours === "CO" ? "active" : ""}">CO</button>
          <button data-worker-day="${worker.id}" data-mode="0h" class="${day.hours === "" ? "active" : ""}">Liber</button>
        </div>
        <div class="worker-actions">
          <button class="mini-btn" data-toggle-worker="${worker.id}">${worker.active ? "Scoate din echipa" : "Reactiveaza"}</button>
          <button class="mini-btn" data-clear-worker="${worker.id}">Sterge luna</button>
          ${worker.isEngineer ? "" : `<button class="mini-btn" data-remove-worker="${worker.id}">Sterge persoana</button>`}
        </div>
      </article>
    `;
  }).join("");
}

function renderSheetPreview() {
  const from = $("#fromDate").value;
  const to = $("#toDate").value;
  $("#timesheetPreview").innerHTML = buildTimesheetTable(from, to, true);
}

function buildTimesheetTable(from, to, editable) {
  const dates = eachDate(from, to);
  const first = parseDate(from);
  const monthLabel = monthNames[first.getMonth()];
  const yearLabel = first.getFullYear();
  const dayHeaders = dates.map((iso) => `<th class="small-head">${parseDate(iso).getDate()}</th>`).join("");
  const workers = state.workers.filter((worker) => worker.active);
  const rows = workers.map((worker, index) => renderWorkerRows(worker, index + 1, dates, editable)).join("");
  return `
    <tr class="company-row">
      <td colspan="4">${escapeHtml($("#companyName").value)}</td>
      <td colspan="${Math.max(dates.length - 4, 1)}"></td>
    </tr>
    <tr class="company-row">
      <td colspan="4">Cod fiscal: ${escapeHtml($("#fiscalCode").value)}</td>
      <td colspan="${Math.max(dates.length - 4, 1)}"></td>
    </tr>
    <tr class="title-row">
      <td colspan="4"></td>
      <td colspan="${dates.length}">FOAIE COLECTIVA DE PREZENTA - EVIDENTA NUMARULUI DE ORE LUCRATE</td>
    </tr>
    <tr class="month-row">
      <td colspan="4"></td>
      <td colspan="${Math.floor(dates.length / 2)}">Luna ${monthLabel}</td>
      <td colspan="${dates.length - Math.floor(dates.length / 2)}">Anul ${yearLabel}</td>
    </tr>
    <tr>
      <th class="head-cell" rowspan="2">Nr. Crt</th>
      <th class="head-cell" rowspan="2">Nume si<br />prenume</th>
      <th class="head-cell" rowspan="2"></th>
      <th class="head-cell" rowspan="2">Program<br />de lucru</th>
      <th class="head-cell" colspan="${dates.length}">DATA</th>
    </tr>
    <tr>${dayHeaders}</tr>
    ${rows}
  `;
}

function renderWorkerRows(worker, nr, dates, editable) {
  const dayCells = (field) => dates.map((iso) => {
    const value = getDay(worker, iso)[field] ?? "";
    const weekendClass = isWeekendIso(iso) ? " weekend" : "";
    if (!editable) return `<td class="day-cell${weekendClass}">${escapeHtml(value)}</td>`;
    const readonly = isWeekendIso(iso) ? "readonly" : "";
    return `<td class="day-cell${weekendClass}"><input ${readonly} data-worker="${worker.id}" data-date="${iso}" data-field="${field}" value="${escapeAttr(value)}" /></td>`;
  }).join("");

  return `
    <tr>
      <td class="nr" rowspan="4">${nr}</td>
      <td class="name" rowspan="4">${escapeHtml(worker.name).replaceAll(" ", "<br />")}</td>
      <td class="card" rowspan="4">${escapeHtml(worker.card).replaceAll("\n", "<br />")}</td>
      <td class="row-label">ora de intare</td>
      ${dayCells("in")}
    </tr>
    <tr><td class="row-label">pauza</td>${dayCells("pause")}</tr>
    <tr><td class="row-label">ora de iesire</td>${dayCells("out")}</tr>
    <tr><td class="row-label">ore lucrate</td>${dayCells("hours")}</tr>
  `;
}

function generatePdf() {
  renderSheetPreview();
  const from = $("#fromDate").value;
  const to = $("#toDate").value;
  const dates = eachDate(from, to);
  const tableHtml = buildPrintTable(from, to);
  const dayCount = dates.length;
  const fixedWidth = 83;
  const pageWidth = 283.5;
  const dayWidth = Math.max(4.8, (pageWidth - fixedWidth) / Math.max(dayCount, 1));
  const baseFont = dayCount > 24 ? 5.2 : dayCount > 18 ? 6.2 : 7.2;
  const weekendFont = dayCount > 24 ? 4.9 : dayCount > 18 ? 5.4 : 6.8;
  const squeeze = dayCount > 24 ? 0.46 : dayCount > 18 ? 0.58 : 0.7;
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    notify("Browserul a blocat fereastra PDF.");
    return;
  }
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Pontaj ${from} - ${to}</title>
        <style>
          @page { size: A4 landscape; margin: 6mm; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: #fff;
            font-family: Arial, sans-serif;
            color: #000;
          }
          .page {
            width: 285mm;
            min-height: 198mm;
            margin: 0 auto;
            background: #fff;
            overflow: hidden;
          }
          .top-grid {
            display: grid;
            grid-template-columns: 88mm 1fr 88mm;
            grid-template-rows: 8mm 8mm 9mm 8mm;
            align-items: center;
            height: 33mm;
          }
          .company {
            grid-column: 1 / 2;
            grid-row: 1 / 2;
            align-self: end;
            font-size: 16pt;
            font-weight: 900;
            white-space: nowrap;
          }
          .fiscal {
            grid-column: 1 / 2;
            grid-row: 2 / 3;
            align-self: start;
            font-size: 15pt;
            font-weight: 900;
            white-space: nowrap;
          }
          .doc-title {
            grid-column: 1 / 4;
            grid-row: 3 / 4;
            text-align: center;
            font-size: 14.2pt;
            font-weight: 900;
            white-space: nowrap;
          }
          .month {
            grid-column: 1 / 4;
            grid-row: 4 / 5;
            text-align: center;
            font-size: 14pt;
            font-weight: 900;
            white-space: nowrap;
          }
          .year {
            display: inline-block;
            margin-left: 30mm;
            text-align: center;
          }
          .year-wrap {
            grid-column: 1 / 4;
            grid-row: 4 / 5;
            text-align: center;
            font-size: 14pt;
            font-weight: 900;
            white-space: nowrap;
          }
          table {
            width: calc(100% - 1mm);
            border-collapse: collapse;
            table-layout: fixed;
            background: rgba(255, 255, 255, 0.94);
          }
          th, td {
            border: 0.45mm solid #111;
            padding: 0;
            text-align: center;
            vertical-align: middle;
            overflow: hidden;
            line-height: 1.05;
          }
          .head-cell {
            background: #ffcc99;
            height: 8mm;
            font-size: 11.5pt;
            font-weight: 500;
          }
          .small-head {
            background: #ffcc99;
            height: 6.5mm;
            font-size: 10.5pt;
            font-weight: 700;
          }
          .nr, .name, .card {
            font-size: 10.4pt;
            font-weight: 800;
          }
          .row-label {
            width: 21mm;
            padding-left: 3px;
            text-align: left;
            font-size: 7.2pt;
          }
          .day-cell {
            width: ${dayWidth}mm;
            height: 6.7mm;
            font-size: ${baseFont}pt;
          }
          .weekend {
            background: #6ea6df;
            color: #06192c;
            font-size: ${weekendFont}pt;
            font-weight: 500;
          }
          .weekend .fit {
            transform: scaleX(${dayCount > 24 ? 0.54 : dayCount > 18 ? 0.62 : 0.78});
          }
          .fit {
            display: inline-block;
            max-width: 100%;
            transform: scaleX(${squeeze});
            transform-origin: center;
            white-space: nowrap;
          }
          .name .fit,
          .card .fit {
            transform: none;
            white-space: normal;
          }
          .nr-col { width: 15mm; }
          .name-col { width: 27mm; }
          .card-col { width: 20mm; }
          .label-col { width: 21mm; }
          .day-col { width: ${dayWidth}mm; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="top-grid">
            <div class="company">${escapeHtml($("#companyName").value)}</div>
            <div class="fiscal">Cod fiscal: ${escapeHtml($("#fiscalCode").value)}</div>
            <div class="doc-title">FOAIE COLECTIVA DE PREZENTA - EVIDENTA NUMARULUI DE ORE LUCRATE</div>
            <div class="year-wrap"><span>Luna ${monthNames[parseDate(from).getMonth()]}</span><span class="year">Anul ${parseDate(from).getFullYear()}</span></div>
          </div>
          <table>${tableHtml}</table>
        </div>
        <script>
          window.onload = () => {
            window.focus();
            window.print();
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
  notify("Foaia PDF este pregatita pentru salvare.");
}

function buildPrintTable(from, to) {
  const dates = eachDate(from, to);
  const dayHeaders = dates.map((iso) => `<th class="small-head">${parseDate(iso).getDate()}</th>`).join("");
  const workers = state.workers.filter((worker) => worker.active);
  const rows = workers.map((worker, index) => renderPrintWorkerRows(worker, index + 1, dates)).join("");
  return `
    <colgroup>
      <col class="nr-col" />
      <col class="name-col" />
      <col class="card-col" />
      <col class="label-col" />
      ${dates.map(() => `<col class="day-col" />`).join("")}
    </colgroup>
    <tr>
      <th class="head-cell" rowspan="2">Nr. Crt</th>
      <th class="head-cell" rowspan="2">Nume si<br />prenume</th>
      <th class="head-cell" rowspan="2"></th>
      <th class="head-cell" rowspan="2">Program<br />de lucru</th>
      <th class="head-cell" colspan="${dates.length}">DATA</th>
    </tr>
    <tr>${dayHeaders}</tr>
    ${rows}
  `;
}

function renderPrintWorkerRows(worker, nr, dates) {
  const dayCells = (field) => dates.map((iso) => {
    const value = getDay(worker, iso)[field] ?? "";
    const weekendClass = isWeekendIso(iso) ? " weekend" : "";
    return `<td class="day-cell${weekendClass}"><span class="fit">${escapeHtml(value)}</span></td>`;
  }).join("");

  return `
    <tr>
      <td class="nr" rowspan="4"><span class="fit">${nr}</span></td>
      <td class="name" rowspan="4"><span class="fit">${escapeHtml(worker.name).replaceAll(" ", "<br />")}</span></td>
      <td class="card" rowspan="4"><span class="fit">${escapeHtml(worker.card).replaceAll("\n", "<br />")}</span></td>
      <td class="row-label">ora de intare</td>
      ${dayCells("in")}
    </tr>
    <tr><td class="row-label">pauza</td>${dayCells("pause")}</tr>
    <tr><td class="row-label">ora de iesire</td>${dayCells("out")}</tr>
    <tr><td class="row-label">ore lucrate</td>${dayCells("hours")}</tr>
  `;
}

function renderSitesSubmenu() {
  const sub = $("#sitesSubmenu");
  if (!sub) return;
  if (!state.sites.length) {
    sub.innerHTML = `<span class="nav-sub-item" style="opacity:.4;cursor:default">Niciun santier</span>`;
    return;
  }
  sub.innerHTML = state.sites.map((site) => `
    <button class="nav-sub-item ${currentSiteId === site.id ? "nav-sub-active" : ""}"
            data-site-id="${escapeAttr(site.id)}"
            title="${escapeAttr(site.name)}">
      ${escapeHtml(site.name)}
    </button>
  `).join("");
  sub.querySelectorAll("[data-site-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showSiteDetail(btn.dataset.siteId);
      closeMobileNav(); // inchide sidebar pe mobil
    });
  });
}

function showSiteDetail(siteId) {
  currentSiteId = siteId;
  // Arata view-ul site-detail fara sa inchida dropdown-ul
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach((l) => {
    l.classList.remove("active");
    l.removeAttribute("aria-current");
  });
  $("#site-detail").classList.add("active");
  // Pastreaza Santiere activ vizual + dropdown deschis
  const sitesBtn = $("#sitesNavBtn");
  if (sitesBtn) { sitesBtn.classList.add("active", "sub-open"); }
  // Highlight santier selectat in dropdown
  renderSiteDetailContent();
  renderSitesSubmenu();
  $(".workspace").scrollIntoView({ behavior: "smooth" });
}

const SITE_CHAPTERS = [
  { key: "proiect-tehnic",      icon: "📐", title: "Proiect tehnic",            desc: "Planuri de executie, memorii tehnice, detalii de constructie si toate documentele de proiectare." },
  { key: "liste-cantitati",     icon: "📊", title: "Liste Cantități",           desc: "Devize, antemasuratoare, centralizatoare de cantitati si situatii comparative." },
  { key: "documente-santier",   icon: "📁", title: "Documente santier",         desc: "Contracte, autorizatii de construire, notificari ISC si alte acte administrative." },
  { key: "procese-verbale",     icon: "📋", title: "Procese verbale",           desc: "PV de receptie, lucrari ascunse, faze determinante si predare-primire teren." },
  { key: "condica-betoane",     icon: "🏗️", title: "Condică betoane",           desc: "Registru de turnari beton, retete aprobate, cubaje si certificate de conformitate." },
  { key: "dispozitii-santier",  icon: "📝", title: "Dispoziții de santier",     desc: "Dispozitii emise si primite de la proiectant, beneficiar sau diriginte de santier." },
  { key: "situatii-lucrari",    icon: "📈", title: "Situații de lucrări",       desc: "Situatii de plata lunare, centralizatoare si documente pentru decontare." },
  { key: "progres-santier",     icon: "🎯", title: "Progres santier",           desc: "Grafic de executie, stadiu fizic, rapoarte saptamanale si fotografii de progres." },
  { key: "carte-tehnica",       icon: "📚", title: "Carte tehnică",             desc: "Cartea constructiei, instructiuni de exploatare si intretinere, garantii." },
  { key: "avize-calitate",      icon: "✅", title: "Avize + Documente calitate", desc: "Certificate de calitate, buletine de incercari, agremente tehnice si declaratii de performanta." },
];

let currentChapterIdx = 0;

function renderSiteDetailContent() {
  const el = $("#site-detail");
  if (!el) return;
  const site = state.sites.find((s) => s.id === currentSiteId);
  if (!site) {
    el.innerHTML = `<p class="muted">Santierul nu a fost gasit.</p>`;
    return;
  }
  const ch = SITE_CHAPTERS[currentChapterIdx];
  el.innerHTML = `
    <div class="section-title row" style="margin-bottom:20px">
      <div>
        <p class="eyebrow">Santier</p>
        <h2>${escapeHtml(site.name)}</h2>
        <p class="muted">${escapeHtml(site.location)} &nbsp;|&nbsp; ${escapeHtml(site.status)}</p>
      </div>
      <span class="pill">${site.progress}% progres</span>
    </div>
    <div class="site-d5-layout">
      <nav class="site-chapters-nav">
        ${SITE_CHAPTERS.map((c, i) => `
          <button class="chapter-item ${i === currentChapterIdx ? "active" : ""}" data-ch="${i}">
            <span class="ch-num">${String(i + 1).padStart(2, "0")}</span>
            <span class="ch-text">${escapeHtml(c.title)}</span>
          </button>
        `).join("")}
      </nav>
      <div class="site-chapter-preview" id="chapterContent">
        <!-- file manager se incarca aici -->
      </div>
    </div>
  `;

  // Click pe capitol → incarca file manager in panoul drept
  el.querySelectorAll("[data-ch]").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentChapterIdx = Number(btn.dataset.ch);
      // Actualizeaza selectia vizuala
      el.querySelectorAll(".chapter-item").forEach((b, i) =>
        b.classList.toggle("active", i === currentChapterIdx)
      );
      loadChapterFiles(currentSiteId, SITE_CHAPTERS[currentChapterIdx]);
    });
  });

  // Incarca primul capitol implicit
  loadChapterFiles(currentSiteId, ch);
}

// ══ DATE SANTIER STRAJA - DIN EXCEL ══
const STRAJA_CANAL = [
  { id:'Cm1',  proj:565,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm2',  proj:311,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm3',  proj:250,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm4',  proj:124,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm5',  proj:285,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm6',  proj:480,  exec:480, cv:18, rac:19, obs:'De ridicat CV6.14',  per:'17.10–27.11.2025' },
  { id:'Cm7',  proj:282,  exec:282, cv:7,  rac:9,  obs:'',                   per:'02.10–17.10.2025' },
  { id:'Cm8',  proj:100,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm9',  proj:180,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm10', proj:526,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm11', proj:285,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm12', proj:321,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm13', proj:784,  exec:784, cv:14, rac:0,  obs:'',                   per:'09.03–16.03.2026' },
  { id:'Cm14', proj:486,  exec:486, cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm15', proj:401,  exec:401, cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm16', proj:169,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm17', proj:509,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm18', proj:150,  exec:150, cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm19', proj:225,  exec:225, cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm20', proj:150,  exec:150, cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm21', proj:1605, exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm22', proj:553,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm23', proj:50,   exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm24', proj:163,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm25', proj:515,  exec:515, cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm26', proj:143,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm27', proj:395,  exec:395, cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm28', proj:106,  exec:106, cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm29', proj:1502, exec:400, cv:0,  rac:0,  obs:'Partial',            per:'' },
  { id:'Cm30', proj:300,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm31', proj:222,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm32', proj:249,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm33', proj:167,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm34', proj:742,  exec:588, cv:19, rac:0,  obs:'',                   per:'27.11–16.12.2025' },
  { id:'Cm35', proj:391,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm36', proj:185,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm37', proj:724,  exec:724, cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm38', proj:240,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm39', proj:859,  exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm40', proj:74,   exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
  { id:'Cm41', proj:67,   exec:0,   cv:0,  rac:0,  obs:'',                   per:'' },
];
const STRAJA_REFULARE = [
  { id:'CR1', proj:284,  dn:'Dn90',  exec:0,   cv:0, per:'' },
  { id:'CR2', proj:340,  dn:'Dn90',  exec:0,   cv:0, per:'' },
  { id:'CR3', proj:534,  dn:'Dn90',  exec:534, cv:0, per:'' },
  { id:'CR4', proj:206,  dn:'Dn90',  exec:0,   cv:0, per:'' },
  { id:'CR5', proj:348,  dn:'Dn90',  exec:0,   cv:0, per:'' },
  { id:'CR6', proj:197,  dn:'Dn90',  exec:0,   cv:0, per:'' },
  { id:'CR7', proj:202,  dn:'Dn90',  exec:202, cv:0, per:'' },
  { id:'CR8', proj:298,  dn:'Dn90',  exec:0,   cv:0, per:'' },
  { id:'CR9', proj:795,  dn:'Dn110', exec:0,   cv:0, per:'' },
];
const STRAJA_APA = [
  { id:'CD1',  proj:491,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD2',  proj:295,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD3',  proj:397,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD4',  proj:495,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD5',  proj:820,  exec:820, cv:3, brans:28, per:'02.10-27.11.2025' },
  { id:'CD6',  proj:695,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD7',  proj:114,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD8',  proj:282,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD9',  proj:285,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD10', proj:806,  exec:806, cv:0, brans:0,  per:'' },
  { id:'CD11', proj:1222, exec:552, cv:0, brans:0,  per:'' },
  { id:'CD12', proj:397,  exec:397, cv:0, brans:0,  per:'' },
  { id:'CD13', proj:1265, exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD14', proj:857,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD15', proj:413,  exec:413, cv:0, brans:0,  per:'' },
  { id:'CD16', proj:150,  exec:150, cv:0, brans:0,  per:'' },
  { id:'CD17', proj:851,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD18', proj:163,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD19', proj:527,  exec:527, cv:0, brans:0,  per:'' },
  { id:'CD20', proj:107,  exec:107, cv:0, brans:0,  per:'' },
  { id:'CD22', proj:1556, exec:400, cv:0, brans:0,  per:'' },
  { id:'CD23', proj:600,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD24', proj:64,   exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD25', proj:681,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD26', proj:293,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD27', proj:584,  exec:384, cv:0, brans:0,  per:'' },
  { id:'CD28', proj:710,  exec:710, cv:0, brans:0,  per:'' },
  { id:'CD29', proj:242,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD30', proj:411,  exec:411, cv:0, brans:0,  per:'' },
  { id:'CD31', proj:193,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD32', proj:64,   exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD33', proj:76,   exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD34', proj:157,  exec:0,   cv:0, brans:0,  per:'' },
  { id:'CD35', proj:66,   exec:0,   cv:0, brans:0,  per:'' },
];

let progressUnsubscribe = null;
let progressData = {};
let progressSaveTimer = null;

function pct(exec, proj) { return proj > 0 ? Math.min(100, Math.round(exec / proj * 100)) : 0; }
function fmt(n) { return Number(n || 0).toFixed(1).replace('.0', ''); }

function pctColor(p) {
  if (p >= 100) return '#4ade80';
  if (p > 0)   return '#f7b719';
  return '#9a9080';
}

function progressBar(p) {
  const color = pctColor(p);
  return `<div class="pt-bar-wrap"><div class="pt-bar-fill" style="width:${p}%;background:${color}"></div></div>`;
}

function renderProgressTracker(siteId, panel) {
  if (progressUnsubscribe) { progressUnsubscribe(); progressUnsubscribe = null; }

  panel.innerHTML = `
    <div class="pt-header">
      <span class="ch-panel-icon">🎯</span>
      <span class="ch-panel-title">Progres Santier — Straja Apa Canal</span>
      <span class="pt-saved-badge" id="ptSaved" style="display:none">✓ Salvat</span>
    </div>
    <div class="pt-summary-grid" id="ptSummary">Se încarcă...</div>
    <div id="ptTables"></div>
  `;

  if (!currentUser || !isFirebaseConfigured()) {
    panel.querySelector('#ptSummary').innerHTML = '<p class="muted">Conectează-te pentru a accesa progresul.</p>';
    return;
  }

  progressUnsubscribe = subscribeToProgress(currentUser.uid, siteId, (data) => {
    progressData = data;
    renderPtContent(siteId, panel, data);
  });
}

function renderPtContent(siteId, panel, data) {
  const canal = data.canal || {};
  const ref_ = data.refulare || {};
  const apa = data.apa || {};

  // Merge template cu data salvata
  const canalRows = STRAJA_CANAL.map(t => ({
    ...t,
    exec: Number(canal[t.id]?.exec ?? t.exec),
    cv:   Number(canal[t.id]?.cv   ?? t.cv),
    rac:  Number(canal[t.id]?.rac  ?? t.rac),
    obs:  canal[t.id]?.obs ?? t.obs,
    per:  canal[t.id]?.per ?? t.per,
  }));
  const refRows = STRAJA_REFULARE.map(t => ({
    ...t,
    exec: Number(ref_[t.id]?.exec ?? t.exec),
    cv:   Number(ref_[t.id]?.cv   ?? t.cv),
    per:  ref_[t.id]?.per ?? t.per,
  }));
  const apaRows = STRAJA_APA.map(t => ({
    ...t,
    exec:  Number(apa[t.id]?.exec  ?? t.exec),
    cv:    Number(apa[t.id]?.cv    ?? t.cv),
    brans: Number(apa[t.id]?.brans ?? t.brans),
    per:   apa[t.id]?.per ?? t.per,
  }));
  const totalProjCanal = canalRows.reduce((s,r) => s+r.proj, 0);
  const totalExecCanal = canalRows.reduce((s,r) => s+r.exec, 0);
  const totalProjRef   = refRows.reduce((s,r) => s+r.proj, 0);
  const totalExecRef   = refRows.reduce((s,r) => s+r.exec, 0);
  const totalProjApa   = apaRows.reduce((s,r) => s+r.proj, 0);
  const totalExecApa   = apaRows.reduce((s,r) => s+r.exec, 0);
  const totalCvCanal   = canalRows.reduce((s,r) => s+r.cv, 0);
  const totalRacCanal  = canalRows.reduce((s,r) => s+r.rac, 0);

  const totalProj = totalProjCanal + totalProjRef + totalProjApa;
  const totalExec = totalExecCanal + totalExecRef + totalExecApa;
  const pctGeneral = pct(totalExec, totalProj);

  const summary = panel.querySelector('#ptSummary');
  const mkCard = (label, proj, exec, color) => `
    <div class="pt-card">
      <p class="pt-lbl">${label}</p>
      <div class="pt-card-row">
        <div><p class="pt-sub">Proiectat</p><p class="pt-val-sm">${proj.toLocaleString('ro-RO')} ml</p></div>
        <div><p class="pt-sub">Executat</p><p class="pt-val-sm" style="color:${color}">${exec.toLocaleString('ro-RO')} ml</p></div>
        <div><p class="pt-sub">Rest</p><p class="pt-val-sm" style="color:#f87171">${(proj-exec).toLocaleString('ro-RO')} ml</p></div>
      </div>
      ${progressBar(pct(exec,proj))}
      <p style="text-align:right;font-size:11px;color:${color};font-weight:700;margin-top:3px">${pct(exec,proj)}%</p>
    </div>`;

  summary.innerHTML = `
    ${mkCard('🔵 Canal PP Dn250', totalProjCanal, totalExecCanal, '#f7b719')}
    ${mkCard('🟡 Refulare PEHD Dn110', totalProjRef, totalExecRef, '#f7b719')}
    ${mkCard('💧 Apă PEHD Dn110', totalProjApa, totalExecApa, '#f7b719')}
    <div class="pt-card">
      <p class="pt-lbl">Progres General — ${pctGeneral}%</p>
      ${progressBar(pctGeneral)}
      <div class="pt-mini-stats" style="margin-top:10px">
        <span>Cv canal: ${totalCvCanal}</span>
        <span>Racorduri: ${totalRacCanal}</span>
        <span>Branș. apă: ${apaRows.reduce((s,r)=>s+(r.brans||0),0)}</span>
      </div>
    </div>
  `;

  const tables = panel.querySelector('#ptTables');
  tables.innerHTML = `
    <!-- CANAL -->
    <div class="pt-section">
      <div class="pt-section-head">
        <span class="pt-section-icon">🔵</span>
        <span class="pt-section-title">Canal PP Dn250 — Gravitațional</span>
        <span class="pt-section-stat">${totalExecCanal.toLocaleString('ro-RO')} / ${totalProjCanal.toLocaleString('ro-RO')} ml &nbsp;•&nbsp; ${pct(totalExecCanal,totalProjCanal)}%</span>
      </div>
      ${progressBar(pct(totalExecCanal,totalProjCanal))}
      <div class="pt-table-wrap">
        <table class="pt-table">
          <thead><tr>
            <th>Tronson</th><th>Proiectat (m)</th><th>Executat (m) ✏️</th>
            <th>%</th><th>Rest (m)</th>
            <th>Camine viz. ✏️</th><th>Racorduri ✏️</th>
            <th>Perioadă ✏️</th><th>Observații ✏️</th>
          </tr></thead>
          <tbody>
            ${canalRows.map(r => {
              const p = pct(r.exec, r.proj);
              const rest = r.proj - r.exec;
              const bg = p >= 100 ? 'rgba(74,222,128,.06)' : p > 0 ? 'rgba(247,183,25,.04)' : '';
              return `<tr style="background:${bg}">
                <td class="pt-id">${r.id}</td>
                <td class="pt-num">${r.proj}</td>
                <td class="pt-edit" data-cat="canal" data-id="${r.id}" data-field="exec">${r.exec}</td>
                <td><span style="color:${pctColor(p)};font-weight:700">${p}%</span></td>
                <td class="pt-num ${rest>0?'pt-rest':''}">${rest > 0 ? rest : '—'}</td>
                <td class="pt-edit" data-cat="canal" data-id="${r.id}" data-field="cv">${r.cv||''}</td>
                <td class="pt-edit" data-cat="canal" data-id="${r.id}" data-field="rac">${r.rac||''}</td>
                <td class="pt-edit pt-text" data-cat="canal" data-id="${r.id}" data-field="per">${r.per||''}</td>
                <td class="pt-edit pt-text" data-cat="canal" data-id="${r.id}" data-field="obs">${r.obs||''}</td>
              </tr>`;
            }).join('')}
            <tr class="pt-total">
              <td>TOTAL</td><td>${totalProjCanal}</td><td style="color:#f7b719">${totalExecCanal}</td>
              <td style="color:${pctColor(pct(totalExecCanal,totalProjCanal))}">${pct(totalExecCanal,totalProjCanal)}%</td>
              <td class="pt-rest">${totalProjCanal-totalExecCanal}</td>
              <td>${totalCvCanal}</td><td>${totalRacCanal}</td><td></td><td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- REFULARE -->
    <div class="pt-section">
      <div class="pt-section-head">
        <span class="pt-section-icon">🟡</span>
        <span class="pt-section-title">Refulare PEHD — Sub presiune</span>
        <span class="pt-section-stat">${totalExecRef.toLocaleString('ro-RO')} / ${totalProjRef.toLocaleString('ro-RO')} ml &nbsp;•&nbsp; ${pct(totalExecRef,totalProjRef)}%</span>
      </div>
      ${progressBar(pct(totalExecRef,totalProjRef))}
      <div class="pt-table-wrap">
        <table class="pt-table">
          <thead><tr><th>Tronson</th><th>Diametru</th><th>Proiectat (m)</th><th>Executat (m) ✏️</th><th>%</th><th>Rest (m)</th><th>Observații ✏️</th></tr></thead>
          <tbody>
            ${refRows.map(r => {
              const p = pct(r.exec, r.proj);
              const rest = r.proj - r.exec;
              const bg = p >= 100 ? 'rgba(74,222,128,.06)' : p > 0 ? 'rgba(247,183,25,.04)' : '';
              return `<tr style="background:${bg}">
                <td class="pt-id">${r.id}</td>
                <td style="font-size:11px;color:#9a9080">${r.dn}</td>
                <td class="pt-num">${r.proj}</td>
                <td class="pt-edit" data-cat="refulare" data-id="${r.id}" data-field="exec">${r.exec||''}</td>
                <td><span style="color:${pctColor(p)};font-weight:700">${p}%</span></td>
                <td class="pt-num ${rest>0?'pt-rest':''}">${rest > 0 ? rest : '—'}</td>
                <td class="pt-edit pt-text" data-cat="refulare" data-id="${r.id}" data-field="per">${r.per||''}</td>
              </tr>`;
            }).join('')}
            <tr class="pt-total">
              <td>TOTAL</td><td></td><td>${totalProjRef}</td><td style="color:#f7b719">${totalExecRef}</td>
              <td style="color:${pctColor(pct(totalExecRef,totalProjRef))}">${pct(totalExecRef,totalProjRef)}%</td>
              <td class="pt-rest">${totalProjRef-totalExecRef}</td><td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- APĂ -->
    <div class="pt-section">
      <div class="pt-section-head">
        <span class="pt-section-icon">💧</span>
        <span class="pt-section-title">Apă PEHD Dn110 — Distribuție (${apaRows.length} tronsoane)</span>
        <span class="pt-section-stat">${totalExecApa.toLocaleString('ro-RO')} / ${totalProjApa.toLocaleString('ro-RO')} ml &nbsp;•&nbsp; ${pct(totalExecApa,totalProjApa)}%</span>
      </div>
      ${progressBar(pct(totalExecApa,totalProjApa))}
      <div class="pt-table-wrap">
        <table class="pt-table">
          <thead><tr><th>Tronson</th><th>Proiectat (m)</th><th>Executat (m) ✏️</th><th>%</th><th>Rest (m)</th><th>Căm. Vane ✏️</th><th>Branș. ✏️</th><th>Perioadă ✏️</th></tr></thead>
          <tbody>
            ${apaRows.map(r => {
              const p = pct(r.exec, r.proj);
              const rest = r.proj - r.exec;
              const bg = p >= 100 ? 'rgba(74,222,128,.06)' : p > 0 ? 'rgba(247,183,25,.04)' : '';
              return `<tr style="background:${bg}">
                <td class="pt-id">${r.id}</td>
                <td class="pt-num">${r.proj}</td>
                <td class="pt-edit" data-cat="apa" data-id="${r.id}" data-field="exec">${r.exec||''}</td>
                <td><span style="color:${pctColor(p)};font-weight:700">${p}%</span></td>
                <td class="pt-num ${rest>0?'pt-rest':''}">${rest > 0 ? rest : '—'}</td>
                <td class="pt-edit" data-cat="apa" data-id="${r.id}" data-field="cv">${r.cv||''}</td>
                <td class="pt-edit" data-cat="apa" data-id="${r.id}" data-field="brans">${r.brans||''}</td>
                <td class="pt-edit pt-text" data-cat="apa" data-id="${r.id}" data-field="per">${r.per||''}</td>
              </tr>`;
            }).join('')}
            <tr class="pt-total">
              <td>TOTAL</td><td>${totalProjApa.toLocaleString('ro-RO')}</td>
              <td style="color:#f7b719">${totalExecApa.toLocaleString('ro-RO')}</td>
              <td style="color:${pctColor(pct(totalExecApa,totalProjApa))}">${pct(totalExecApa,totalProjApa)}%</td>
              <td class="pt-rest">${(totalProjApa-totalExecApa).toLocaleString('ro-RO')}</td>
              <td>${apaRows.reduce((s,r)=>s+r.cv,0)||''}</td>
              <td>${apaRows.reduce((s,r)=>s+r.brans,0)||''}</td><td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <p class="muted pt-hint">✏️ = celulă editabilă — click pentru a modifica valorile. Salvare automată.</p>
  `;

  // Atașează editare inline
  tables.querySelectorAll('.pt-edit').forEach(cell => {
    cell.addEventListener('click', () => startPtEdit(cell, siteId));
  });
}

function startPtEdit(cell, siteId) {
  if (cell.querySelector('input')) return;
  const val = cell.textContent.trim();
  const isText = cell.classList.contains('pt-text');
  const input = document.createElement('input');
  input.type = isText ? 'text' : 'number';
  input.min = '0';
  input.value = val;
  input.className = 'pt-input';
  cell.textContent = '';
  cell.appendChild(input);
  input.focus();
  input.select();

  const save = () => {
    const newVal = isText ? input.value.trim() : Math.max(0, parseFloat(input.value) || 0);
    const cat   = cell.dataset.cat;
    const id    = cell.dataset.id;
    const field = cell.dataset.field;

    if (!progressData[cat]) progressData[cat] = {};
    if (!progressData[cat][id]) progressData[cat][id] = {};
    progressData[cat][id][field] = newVal;

    // Debounce save 1s
    clearTimeout(progressSaveTimer);
    progressSaveTimer = setTimeout(async () => {
      if (currentUser) {
        await saveProgress(currentUser.uid, siteId, progressData);
        const badge = $("#ptSaved");
        if (badge) { badge.style.display = 'inline'; setTimeout(() => { badge.style.display = 'none'; }, 2000); }
      }
    }, 1000);

    // Re-render imediat cu noile date
    const panel = $("#chapterContent");
    if (panel) renderPtContent(siteId, panel, progressData);
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
}

function loadChapterFiles(siteId, chapter) {
  const panel = $("#chapterContent");
  if (!panel) return;
  currentChapterKey = chapter.key;

  // Capitol special: Progres santier
  if (chapter.key === 'progres-santier') {
    renderProgressTracker(siteId, panel);
    return;
  }

  panel.innerHTML = `
    <div class="ch-panel-header">
      <span class="ch-panel-icon">${chapter.icon}</span>
      <span class="ch-panel-title">${escapeHtml(chapter.title)}</span>
    </div>
    <div class="file-upload-zone" id="uploadZone">
      <input type="file" id="fileInput" multiple hidden />
      <div class="upload-prompt" id="uploadPrompt">
        <p>Trage fișierele aici sau <button class="upload-pick-btn" id="pickFiles">alege</button></p>
        <p class="muted" style="font-size:11px;margin-top:4px">PDF, DWG, DOCX, XLSX, JPG și orice format</p>
      </div>
      <div class="upload-progress" id="uploadProgress" hidden>
        <div class="upload-progress-bar"><div class="upload-progress-fill" id="progressFill"></div></div>
        <p id="progressText" class="muted" style="font-size:12px;text-align:center;margin-top:6px">Se încarcă...</p>
      </div>
    </div>
    <div class="file-list" id="fileList">
      <p class="muted" style="padding:16px;text-align:center;font-size:13px">Se încarcă...</p>
    </div>
  `;

  const input = $("#fileInput");
  const zone = $("#uploadZone");
  $("#pickFiles").addEventListener("click", async () => {
    // Autorizeaza Google Drive la primul click
    try {
      await getDriveToken();
      input.click();
    } catch (e) {
      notify("Conectare Google Drive necesară: " + e.message);
    }
  });
  input.addEventListener("change", () => handleUpload(Array.from(input.files), siteId, chapter.key));
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault(); zone.classList.remove("drag-over");
    handleUpload(Array.from(e.dataTransfer.files), siteId, chapter.key);
  });

  if (filesUnsubscribe) filesUnsubscribe();
  if (currentUser && isFirebaseConfigured()) {
    filesUnsubscribe = subscribeToFiles(currentUser.uid, siteId, chapter.key, (files) => {
      renderFileList(files, siteId, chapter.key);
    });
  } else {
    $("#fileList").innerHTML = `<p class="muted" style="padding:16px;text-align:center">Conectează-te pentru fișiere.</p>`;
  }
}

function showChapter(siteId, chapterKey, chapterTitle) {
  currentChapterKey = chapterKey;
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach((l) => { l.classList.remove("active"); l.removeAttribute("aria-current"); });
  const el = $("#chapter-files");
  el.classList.add("active");
  const sitesBtn = $("#sitesNavBtn");
  if (sitesBtn) sitesBtn.classList.add("active", "sub-open");
  renderFileManager(siteId, chapterKey, chapterTitle);
  $(".workspace").scrollIntoView({ behavior: "smooth" });
}

function getViewerBtn(f) {
  // Toate fisierele uploadate pe Drive au viewURL
  if (f.viewURL) {
    return `<a class="file-btn file-btn-view" href="${escapeAttr(f.viewURL)}" target="_blank" rel="noopener">Vizualizare</a>`;
  }
  // Fallback pentru fisiere vechi (Cloudinary)
  const t = (f.type || "").toLowerCase();
  const name = (f.name || "").toLowerCase();
  if (t.includes("pdf") || name.endsWith(".pdf") || t.includes("image") || name.match(/\.(jpg|jpeg|png|gif|webp)$/)) {
    return `<a class="file-btn file-btn-view" href="${escapeAttr(f.downloadURL)}" target="_blank" rel="noopener">Vizualizare</a>`;
  }
  if (name.match(/\.(doc|docx|xls|xlsx|ppt|pptx)$/)) {
    const officeUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(f.downloadURL)}`;
    return `<a class="file-btn file-btn-view" href="${escapeAttr(officeUrl)}" target="_blank" rel="noopener">Vizualizare</a>`;
  }
  return `<span class="file-btn" style="opacity:.4;cursor:default">Fără preview</span>`;
}

function fileIcon(type) {
  if (type.includes("pdf")) return "📄";
  if (type.includes("word") || type.includes("docx") || type.includes("doc")) return "📝";
  if (type.includes("excel") || type.includes("sheet") || type.includes("xlsx")) return "📊";
  if (type.includes("image") || type.includes("jpg") || type.includes("png")) return "🖼️";
  if (type.includes("zip") || type.includes("rar")) return "🗜️";
  if (type.includes("dwg") || type.includes("dxf") || type.includes("cad")) return "📐";
  return "📁";
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function renderFileManager(siteId, chapterKey, chapterTitle) {
  const el = $("#chapter-files");
  const site = state.sites.find((s) => s.id === siteId);
  el.innerHTML = `
    <div class="section-title row">
      <div>
        <p class="eyebrow" style="cursor:pointer" id="backToSite">← ${escapeHtml(site?.name || "Santier")}</p>
        <h2>${escapeHtml(chapterTitle)}</h2>
      </div>
    </div>

    <div class="file-upload-zone" id="uploadZone">
      <input type="file" id="fileInput" multiple hidden />
      <div class="upload-prompt" id="uploadPrompt">
        <span style="font-size:40px">📁</span>
        <p>Trage fișierele aici sau <button class="upload-pick-btn" id="pickFiles">alege fișiere</button></p>
        <p class="muted" style="font-size:12px;margin-top:6px">PDF, DWG, DOCX, XLSX, JPG și orice alt format</p>
      </div>
      <div class="upload-progress" id="uploadProgress" hidden>
        <div class="upload-progress-bar"><div class="upload-progress-fill" id="progressFill"></div></div>
        <p id="progressText" class="muted" style="font-size:13px;text-align:center;margin-top:8px">Se încarcă...</p>
      </div>
    </div>

    <div class="file-list" id="fileList">
      <p class="muted" style="padding:20px;text-align:center">Se încarcă fișierele...</p>
    </div>
  `;

  // Back button
  $("#backToSite").addEventListener("click", () => showSiteDetail(siteId));

  // Upload zone events
  const zone = $("#uploadZone");
  const input = $("#fileInput");
  const pickBtn = $("#pickFiles");

  pickBtn.addEventListener("click", () => input.click());
  input.addEventListener("change", () => handleUpload(Array.from(input.files), siteId, chapterKey));

  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    handleUpload(Array.from(e.dataTransfer.files), siteId, chapterKey);
  });

  // Ascultam fisierele real-time
  if (filesUnsubscribe) filesUnsubscribe();
  if (currentUser && isFirebaseConfigured()) {
    filesUnsubscribe = subscribeToFiles(currentUser.uid, siteId, chapterKey, (files) => {
      renderFileList(files, siteId, chapterKey);
    });
  } else {
    $("#fileList").innerHTML = `<p class="muted" style="padding:20px;text-align:center">Conectează-te pentru a accesa fișierele.</p>`;
  }
}

function renderFileList(files, siteId, chapterKey) {
  const el = $("#fileList");
  if (!el) return;
  if (!files.length) {
    el.innerHTML = `<p class="muted" style="padding:24px;text-align:center">Niciun fișier încărcat încă.</p>`;
    return;
  }
  el.innerHTML = files.map((f) => `
    <div class="file-item">
      <span class="file-icon">${fileIcon(f.type)}</span>
      <div class="file-info">
        <span class="file-name">${escapeHtml(f.name)}</span>
        <span class="file-meta">${formatSize(f.size)} · ${new Date(f.uploadedAt).toLocaleDateString("ro-RO")}</span>
      </div>
      <div class="file-actions">
        ${getViewerBtn(f)}
        <a class="file-btn" href="${escapeAttr(f.downloadURL)}" download="${escapeAttr(f.name)}" target="_blank" rel="noopener">Descarcă</a>
        <button class="file-btn file-btn-del" data-fid="${escapeAttr(f.fileId)}" data-drid="${escapeAttr(f.driveId || "")}">Șterge</button>
      </div>
    </div>
  `).join("");

  el.querySelectorAll(".file-btn-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Ștergi fișierul definitiv?")) return;
      btn.disabled = true;
      btn.textContent = "Se șterge...";
      try {
        await deleteFile(currentUser.uid, siteId, chapterKey, btn.dataset.fid, btn.dataset.drid);
      } catch (e) {
        notify("Eroare la ștergere: " + e.message);
        btn.disabled = false;
        btn.textContent = "Șterge";
      }
    });
  });
}

async function handleUpload(files, siteId, chapterKey) {
  if (!files.length || !currentUser) return;
  const prompt = $("#uploadPrompt");
  const progress = $("#uploadProgress");
  const fill = $("#progressFill");
  const text = $("#progressText");

  if (prompt) prompt.hidden = true;
  if (progress) progress.hidden = false;

  const uploaded = [];
  for (const file of files) {
    if (text) text.textContent = `Se încarcă: ${file.name}`;
    try {
      const meta = await uploadFile(currentUser.uid, siteId, chapterKey, file, (pct) => {
        if (fill) fill.style.width = pct + "%";
      });
      uploaded.push(meta);
    } catch (e) {
      notify("Eroare upload " + file.name + ": " + e.message);
    }
  }

  if (prompt) prompt.hidden = false;
  if (progress) progress.hidden = true;
  if (fill) fill.style.width = "0%";

  if (uploaded.length) {
    notify(`${uploaded.length} fișier(e) încărcate cu succes.`);
    // Forteaza re-subscribe ca sa apara fisierele imediat
    if (filesUnsubscribe) filesUnsubscribe();
    filesUnsubscribe = subscribeToFiles(currentUser.uid, siteId, chapterKey, (files) => {
      renderFileList(files, siteId, chapterKey);
    });
  }
}

function closeSitesSubmenu() {
  const btn = $("#sitesNavBtn");
  const sub = $("#sitesSubmenu");
  if (btn) btn.classList.remove("sub-open", "active");
  if (sub) sub.hidden = true;
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      showView(button.dataset.view);
      closeMobileNav(); // inchide sidebar pe mobil dupa navigare
    });
  });

  // Santiere dropdown toggle
  const sitesNavBtn = $("#sitesNavBtn");
  if (sitesNavBtn) {
    sitesNavBtn.addEventListener("click", () => {
      const sub = $("#sitesSubmenu");
      const isOpen = !sub.hidden;
      const isMobile = window.innerWidth <= 900;

      if (isMobile) {
        if (!isOpen) {
          // Prima apasare pe mobil: deschide dropdown, nu naviga inca
          renderSitesSubmenu();
          sub.hidden = false;
          sitesNavBtn.classList.add("sub-open", "active");
        } else {
          // A doua apasare pe mobil: navigheaza la lista santiere
          closeSitesSubmenu();
          showView("sites");
          closeMobileNav();
        }
      } else {
        // Desktop: toggle dropdown + navigheaza mereu
        if (isOpen) {
          closeSitesSubmenu();
        } else {
          renderSitesSubmenu();
          sub.hidden = false;
          sitesNavBtn.classList.add("sub-open", "active");
        }
        showView("sites");
      }
    });
  }

  // Inchide submenu cand se navigheaza la alta sectiune
  document.querySelectorAll(".nav-link[data-view]").forEach((btn) => {
    btn.addEventListener("click", closeSitesSubmenu);
  });

  $("#menuBtn")?.addEventListener("click", toggleMobileNav);
  $("#mobileMenuFab")?.addEventListener("click", toggleMobileNav);
  $("#navOverlay").addEventListener("click", closeMobileNav);


  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMobileNav();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) closeMobileNav();
  });

  $("#fromDate").value = monthStartIso();
  $("#toDate").value = monthEndIso();
  state.lastTimesheetMonth = currentMonthKey();
  $("#companyName").value = state.company;
  $("#fiscalCode").value = state.fiscalCode;

  ["fromDate", "toDate", "companyName", "fiscalCode"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      state.company = $("#companyName").value;
      state.fiscalCode = $("#fiscalCode").value;
      if (id === "fromDate" || id === "toDate") {
        state.lastTimesheetMonth = monthKeyFromIso($("#fromDate").value);
      }
      renderSheetPreview();
      saveState();
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !appReady) return;
    if (syncTimesheetToCurrentMonth({ notifyUser: true })) render();
  });

  $("#workerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const worker = createWorker(form.get("name").trim(), form.get("card").trim() || "CARD");
    fillMonth(worker);
    state.workers.push(worker);
    event.currentTarget.reset();
    render();
    notify("Muncitor adaugat.");
  });

  $("#workerList").addEventListener("click", (event) => {
    const punch = event.target.closest("[data-worker-day]");
    const toggle = event.target.closest("[data-toggle-worker]");
    const remove = event.target.closest("[data-remove-worker]");
    const clearW = event.target.closest("[data-clear-worker]");
    if (punch) {
      const worker = state.workers.find((item) => item.id === punch.dataset.workerDay);
      const date = selectedDate || todayIso();
      setDay(worker, date, punch.dataset.mode);
      render();
      const lbl = date === todayIso() ? "azi" : formatDateLabel(date);
      notify(`Pontajul pentru ${lbl} a fost actualizat.`);
    }
    if (toggle) {
      const worker = state.workers.find((item) => item.id === toggle.dataset.toggleWorker);
      worker.active = !worker.active;
      render();
      notify(worker.active ? "Persoana a fost reactivata." : "Persoana a fost scoasa din pontaj.");
    }
    if (remove && confirm("Stergi muncitorul din program?")) {
      state.workers = state.workers.filter((item) => item.id !== remove.dataset.removeWorker);
      render();
      notify("Muncitor sters.");
    }
    if (clearW) {
      const worker = state.workers.find((item) => item.id === clearW.dataset.clearWorker);
      const from = $("#fromDate").value;
      const to = $("#toDate").value;
      if (from && to && confirm(`Stergi pontajul lui ${worker.name} pentru intervalul selectat?`)) {
        clearWorkerRange(worker, from, to);
        render();
        notify(`Pontajul lui ${worker.name} a fost sters.`);
      }
    }
  });

  $("#timesheetPreview").addEventListener("input", (event) => {
    const input = event.target.closest("input[data-worker]");
    if (!input) return;
    const worker = state.workers.find((item) => item.id === input.dataset.worker);
    getDay(worker, input.dataset.date)[input.dataset.field] = input.value;
    saveState();
    renderWorkers();
    renderSummary();
  });

  $("#punchEngineerDay").addEventListener("click", () => {
    const engineer = state.workers.find((worker) => worker.isEngineer);
    const date = selectedDate || todayIso();
    setDay(engineer, date, "8h");
    render();
    const lbl = date === todayIso() ? "azi" : formatDateLabel(date);
    notify(`Inginer pontat ${lbl}.`);
  });

  $("#markEngineerCo").addEventListener("click", () => {
    const engineer = state.workers.find((worker) => worker.isEngineer);
    const date = selectedDate || todayIso();
    setDay(engineer, date, "CO");
    render();
    const lbl = date === todayIso() ? "azi" : formatDateLabel(date);
    notify(`Inginer marcat CO ${lbl}.`);
  });

  $("#fillAllBtn").addEventListener("click", () => {
    state.workers.forEach(fillMonth);
    render();
    notify("Luna a fost completata pentru toti.");
  });

  const pontajDate = $("#pontajDate");
  if (pontajDate) {
    selectedDate = todayIso();
    pontajDate.value = selectedDate;
    pontajDate.addEventListener("change", () => {
      selectedDate = pontajDate.value || todayIso();
      renderWorkers();
    });
  }

  $("#clearRangeBtn")?.addEventListener("click", () => {
    const from = $("#fromDate").value;
    const to = $("#toDate").value;
    if (!from || !to) { notify("Selecteaza mai intai intervalul de date."); return; }
    if (!confirm("Stergi pontajul TUTUROR muncitorilor pentru intervalul selectat?")) return;
    state.workers.forEach((worker) => clearWorkerRange(worker, from, to));
    render();
    notify("Pontajul a fost sters pentru toti.");
  });

  $("#generatePdfBtn").addEventListener("click", generatePdf);
  $("#logoutBtn")?.addEventListener("click", handleLogout);
  $("#sidebarLogout")?.addEventListener("click", handleLogout);

  $("#forceSyncBtn")?.addEventListener("click", async () => {
    if (!currentUser) {
      notify("Nu esti logat. Autentifica-te mai intai.");
      return;
    }
    try {
      setSyncStatus("Se salveaza in cloud...");
      await saveStateToCloud(currentUser.uid, state);
      cloudReady = true;
      setSyncStatus(`Sincronizat: ${new Date().toLocaleString("ro-RO")}`);
      notify("Salvat in cloud. Reincarca pe mobil.");
      renderAccountPanel();
    } catch (e) {
      notify("Eroare: " + e.message);
      console.error(e);
    }
  });
  $("#loginForm")?.addEventListener("submit", handleLogin);
  $("#registerForm")?.addEventListener("submit", handleRegister);
  $("#showRegisterBtn")?.addEventListener("click", () => toggleAuthMode("register"));
  $("#showLoginBtn")?.addEventListener("click", () => toggleAuthMode("login"));

  $("#addSiteBtn").addEventListener("click", () => {
    state.sites.push({ id: uid(), name: "Santier nou", location: "Locatie", progress: 0, status: "Status de completat" });
    render();
    notify("Santier adaugat.");
  });

  $("#siteEditor").addEventListener("input", (event) => {
    const input = event.target.closest("[data-site]");
    if (!input) return;
    const site = state.sites.find((item) => item.id === input.dataset.site);
    site[input.dataset.field] = input.dataset.field === "progress" ? Number(input.value) : input.value;
    renderSummary();
    saveState();
  });

  $("#siteEditor").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-delete-site]");
    if (!remove) return;
    state.sites = state.sites.filter((site) => site.id !== remove.dataset.deleteSite);
    render();
    notify("Santier sters.");
  });
}

async function handleLogin(event) {
  event.preventDefault();
  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;
  try {
    await login(email, password);
    notify("Autentificare reusita.");
  } catch (error) {
    notify(friendlyAuthError(error));
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const email = $("#registerEmail").value.trim();
  const password = $("#registerPassword").value;
  try {
    await register(email, password);
    notify("Cont creat. Datele se sincronizeaza automat.");
  } catch (error) {
    notify(friendlyAuthError(error));
  }
}

async function handleLogout() {
  if (stateUnsubscribe) {
    stateUnsubscribe();
    stateUnsubscribe = null;
  }
  cloudReady = false;
  await logout();
  notify("Delogat.");
}

function friendlyAuthError(error) {
  const code = error?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "Email sau parola gresita.";
  if (code.includes("email-already-in-use")) return "Există deja un cont cu acest email.";
  if (code.includes("weak-password")) return "Parola trebuie sa aiba minim 6 caractere.";
  if (code.includes("invalid-email")) return "Email invalid.";
  return error?.message || "Eroare autentificare.";
}

function toggleAuthMode(mode) {
  const loginForm = $("#loginForm");
  const registerForm = $("#registerForm");
  const showRegisterBtn = $("#showRegisterBtn");
  const showLoginBtn = $("#showLoginBtn");
  if (!loginForm || !registerForm) return;
  const showLogin = mode === "login";
  loginForm.hidden = !showLogin;
  registerForm.hidden = showLogin;
  if (showRegisterBtn) showRegisterBtn.hidden = !showLogin;
  if (showLoginBtn) showLoginBtn.hidden = showLogin;
}

function setAuthGateVisible(visible) {
  const gate = $("#authGate");
  const shell = document.querySelector(".hero-shell");
  const workspace = $("#workspace");
  if (!gate) return;
  gate.hidden = !visible;
  if (shell) shell.hidden = visible;
  if (workspace) workspace.hidden = visible;
  document.body.classList.toggle("auth-locked", visible);
}

function applyRemoteState(remoteState) {
  applyingRemote = true;
  state = { ...remoteState }; // copie, nu referinta directa
  state.lastTimesheetMonth = currentMonthKey();
  const companyEl = $("#companyName");
  const fiscalEl = $("#fiscalCode");
  if (companyEl) companyEl.value = state.company || "";
  if (fiscalEl) fiscalEl.value = state.fiscalCode || "";
  applyingRemote = false;
  render();
}

async function migrateLocalToCloudIfNeeded() {
  const hasLocalData = Boolean(localStorage.getItem(storageKey));
  if (!hasLocalData) return false;
  const local = loadLocalState();
  await saveStateToCloud(currentUser.uid, local);
  state = local;
  saveStateLocal();
  notify("Datele locale au fost migrate in cloud.");
  return true;
}

async function startCloudSync(user) {
  if (stateUnsubscribe) stateUnsubscribe();
  cloudReady = false;
  setSyncStatus("Se incarca din cloud...");
  console.log("[sync] startCloudSync uid:", user.uid);

  stateUnsubscribe = subscribeToState(
    user.uid,
    async (remoteState) => {
      console.log("[sync] onSnapshot fired, hasData:", !!remoteState);
      if (remoteState) {
        try { applyRemoteState(remoteState); } catch (e) { console.error("[sync] applyRemoteState error:", e); }
        cloudReady = true;
        setSyncStatus(`Sincronizat: ${new Date().toLocaleString("ro-RO")}`);
        return;
      }

      cloudReady = true;
      const migrated = await migrateLocalToCloudIfNeeded();
      if (!migrated) {
        state = createDefaultState();
        await saveStateToCloud(user.uid, state);
        setSyncStatus("Cont nou — date initiale create in cloud.");
      }
      applyRemoteState(state);
    },
    (error) => {
      console.error("[sync] Firestore error:", error);
      setSyncStatus(`Eroare sync: ${error.message}`);
      notify("Eroare Firestore: " + error.message);
    }
  );
}

function initAuth() {
  if (!isFirebaseConfigured()) {
    setAuthGateVisible(false);
    renderAccountPanel();
    return;
  }

  initFirebase();
  watchAuth(async (user) => {
    currentUser = user;
    renderAccountPanel();

    if (!user) {
      cloudReady = false;
      if (stateUnsubscribe) {
        stateUnsubscribe();
        stateUnsubscribe = null;
      }
      setAuthGateVisible(true);
      toggleAuthMode("login");
      return;
    }

    setAuthGateVisible(false);
    startCloudSync(user);
  });
}

async function bootstrap() {
  bindEvents();
  registerServiceWorker();

  // Render imediat din localStorage — nu asteapta Firebase
  state = loadLocalState();
  if (!state.lastTimesheetMonth) state.lastTimesheetMonth = currentMonthKey();

  // Detecteaza automat daca avem date reale (nu datele demo default)
  // Daca da, marcam ca "date locale mai recente" → castiga la sync vs cloud cu demo
  const DEMO_SITES = new Set(["Complex rezidential Nord", "Hala productie Otopeni", "Amenajare birouri Cornell"]);
  const DEMO_WORKERS = new Set(["Ing. Vitel Silviu", "Simonescu Gabriel"]);
  const hasRealSites = state.sites && state.sites.some(s => !DEMO_SITES.has(s.name));
  const hasRealWorkers = state.workers && state.workers.some(w => !DEMO_WORKERS.has(w.name));
  const hasRealData = hasRealSites || hasRealWorkers;
  if (hasRealData && !localStorage.getItem("cf-last-edit")) {
    const ts = Date.now();
    state.savedAt = ts;
    localStorage.setItem("cf-last-edit", ts.toString());
    saveStateLocal();
  }
  $("#fromDate").value = monthStartIso();
  $("#toDate").value = monthEndIso();
  $("#companyName").value = state.company || "";
  $("#fiscalCode").value = state.fiscalCode || "";
  syncTimesheetToCurrentMonth({ notifyUser: false });
  appReady = true;
  render(); // afiseaza datele locale instant

  initAuth();    // Firebase updateaza in background cand e gata
  initHeroSlider();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./service-worker.js").catch((error) => {
    console.warn("Service worker neinstalat.", error);
  });
}

function closeMobileNav() {
  document.body.classList.remove("menu-open");
  $("#menuBtn")?.setAttribute("aria-expanded", "false");
  $("#mobileMenuFab")?.setAttribute("aria-expanded", "false");
  $("#navOverlay").hidden = true;
}

function toggleMobileNav() {
  const open = !document.body.classList.contains("menu-open");
  document.body.classList.toggle("menu-open", open);
  $("#menuBtn")?.setAttribute("aria-expanded", open ? "true" : "false");
  $("#mobileMenuFab")?.setAttribute("aria-expanded", open ? "true" : "false");
  $("#navOverlay").hidden = !open;
  if (open) $("#mainNav").querySelector(".nav-link.active")?.focus();
}

function showView(id, options = {}) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach((link) => {
    const active = link.dataset.view === id;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  $(`#${id}`).classList.add("active");
  closeMobileNav();

  if (id === "timesheets") {
    syncTimesheetToCurrentMonth({ notifyUser: true });
  }

  const scrollTarget = options.scrollTo ? $(options.scrollTo) : $(".workspace");
  scrollTarget?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (options.focusTarget) {
    window.setTimeout(() => {
      const target = $(options.focusTarget);
      target?.focus({ preventScroll: true });
    }, 320);
  }
}

function notify(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#039;");
}

function initHeroSlider() {
  const slides = document.querySelectorAll(".hero-slide");
  if (slides.length < 2) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let current = 0;
  let timer = null;

  function goTo(n) {
    slides[current].classList.remove("active");
    current = (n + slides.length) % slides.length;
    slides[current].classList.add("active");
  }

  function start() {
    timer = window.setInterval(() => goTo(current + 1), 7000);
  }

  start();
}

bootstrap();
