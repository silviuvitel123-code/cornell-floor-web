import {
  initFirebase,
  isFirebaseConfigured,
  watchAuth,
  login,
  register,
  logout,
  subscribeToState,
  saveStateToCloud,
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
  if (!emailEl || !modeEl) return;

  if (!isFirebaseConfigured()) {
    emailEl.textContent = "Firebase neconfigurat";
    modeEl.textContent = "Datele raman doar in browser (localStorage). Adauga variabilele Firebase pe Vercel.";
    if (logoutBtn) logoutBtn.hidden = true;
    setSyncStatus("Mod local — fara cloud.");
    return;
  }

  if (logoutBtn) logoutBtn.hidden = !currentUser;

  if (currentUser) {
    emailEl.textContent = currentUser.email || "Cont activ";
    modeEl.textContent = cloudReady
      ? "Date sincronizate automat intre laptop si telefon."
      : "Se incarca datele din cloud...";
  } else {
    emailEl.textContent = "Neautentificat";
    modeEl.textContent = "Autentifica-te pentru sync intre dispozitive.";
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
  $("#alertBadge").textContent = alerts;
  $("#alertIconBtn").setAttribute("aria-label", `${alerts} notificari si alerte`);
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
  const engineerDay = getDay(engineer, today);
  $("#selfTodayStatus").textContent = engineerDay.hours === "CO" ? "CO azi" : engineerDay.hours ? `${engineerDay.in} - ${engineerDay.out}, ${engineerDay.hours}h` : "Nepontat azi";
  $("#selfHoursMonth").textContent = `${engineerMonthHours()} ore luna aceasta`;

  $("#workerList").innerHTML = state.workers.map((worker) => {
    const day = getDay(worker, today);
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
          ${worker.isEngineer ? "" : `<button class="mini-btn" data-remove-worker="${worker.id}">Sterge</button>`}
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

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

  $("#menuBtn").addEventListener("click", toggleMobileNav);
  $("#navOverlay").addEventListener("click", closeMobileNav);
  $("#alertIconBtn").addEventListener("click", () => {
    showView("home", { scrollTo: "#homeAlerts", focusTarget: "#homeAlerts" });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMobileNav();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) closeMobileNav();
  });

  $("#fromDate").value = monthStartIso();
  $("#toDate").value = monthEndIso();
  $("#companyName").value = state.company;
  $("#fiscalCode").value = state.fiscalCode;

  ["fromDate", "toDate", "companyName", "fiscalCode"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      state.company = $("#companyName").value;
      state.fiscalCode = $("#fiscalCode").value;
      renderSheetPreview();
      saveState();
    });
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
    if (punch) {
      const worker = state.workers.find((item) => item.id === punch.dataset.workerDay);
      setDay(worker, todayIso(), punch.dataset.mode);
      render();
      notify("Pontajul de azi a fost actualizat.");
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
    setDay(engineer, todayIso(), "8h");
    render();
    notify("Inginer pontat azi.");
  });

  $("#markEngineerCo").addEventListener("click", () => {
    const engineer = state.workers.find((worker) => worker.isEngineer);
    setDay(engineer, todayIso(), "CO");
    render();
    notify("Inginer marcat CO azi.");
  });

  $("#fillAllBtn").addEventListener("click", () => {
    state.workers.forEach(fillMonth);
    render();
    notify("Luna a fost completata pentru toti.");
  });

  $("#generatePdfBtn").addEventListener("click", generatePdf);
  $("#logoutBtn")?.addEventListener("click", handleLogout);
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
  state = remoteState;
  $("#companyName").value = state.company || "";
  $("#fiscalCode").value = state.fiscalCode || "";
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

function startCloudSync(user) {
  if (stateUnsubscribe) stateUnsubscribe();
  cloudReady = false;
  setSyncStatus("Se incarca din Firebase...");

  stateUnsubscribe = subscribeToState(
    user.uid,
    async (remoteState) => {
      if (remoteState) {
        applyRemoteState(remoteState);
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
      setSyncStatus(`Eroare sync: ${error.message}`);
      notify("Nu pot citi datele din cloud.");
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

  if (!isFirebaseConfigured()) {
    state = loadLocalState();
    appReady = true;
    $("#fromDate").value = monthStartIso();
    $("#toDate").value = monthEndIso();
    $("#companyName").value = state.company;
    $("#fiscalCode").value = state.fiscalCode;
    render();
    initAuth();
    initHeroSlider();
    return;
  }

  initAuth();
  appReady = true;
  renderAccountPanel();
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
  $("#menuBtn").setAttribute("aria-expanded", "false");
  $("#navOverlay").hidden = true;
}

function toggleMobileNav() {
  const open = !document.body.classList.contains("menu-open");
  document.body.classList.toggle("menu-open", open);
  $("#menuBtn").setAttribute("aria-expanded", open ? "true" : "false");
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

bindEvents();

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
