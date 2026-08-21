const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}

function formatUpdated(value) {
  if (!value) return "noch nicht aktualisiert";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function levelText(level) {
  if (level === "red") return "dringend";
  if (level === "amber") return "pruefen";
  if (level === "green") return "ok";
  return "Info";
}

function renderAccess(displayState) {
  const access = displayState.deviceAccess || {};
  const urls = access.lanDisplayUrls?.length ? access.lanDisplayUrls : access.lanCandidateDisplayUrls || [];
  $("displayAccessPill").textContent = access.lanEnabled ? "LAN aktiv" : "lokal sicher";
  $("displayAccessPill").className = `pill ${access.lanEnabled ? "green" : "blue"}`;

  const rows = [
    {
      title: "Dieser Mac",
      detail: access.localDisplayUrl || `${location.origin}/display`,
      badge: "lokal",
    },
    {
      title: "TV / iPad / iPhone im Haus",
      detail: urls[0] || "LAN-Modus bewusst einschalten, dann diese Anzeige-URL auf dem Geraet oeffnen.",
      badge: access.lanEnabled ? "LAN" : "optional",
    },
    {
      title: "Unterwegs",
      detail: "Nur ueber privaten Tunnel, VPN, Tailscale oder Hermes-Relay. Keine oeffentliche Portfreigabe.",
      badge: "privat",
    },
  ];

  $("displayAccess").innerHTML = rows
    .map((row) => `
      <article class="display-access-card">
        <div>
          <strong>${escapeHtml(row.title)}</strong>
          <p>${escapeHtml(row.detail)}</p>
        </div>
        <span class="pill blue">${escapeHtml(row.badge)}</span>
      </article>
    `)
    .join("");
}

function renderWorkItems(displayState) {
  const items = displayState.workItems || [];
  $("displayWorkCount").textContent = `${items.length} offen`;
  $("displayWorkCount").className = `pill ${items.some((item) => item.level === "red") ? "red" : items.length ? "amber" : "green"}`;

  if (!items.length) {
    $("displayWorkItems").innerHTML = `<p class="display-empty">Keine akuten Schritte. Bei neuer Buchung Kalender aktualisieren.</p>`;
    return;
  }

  $("displayWorkItems").innerHTML = items
    .map((item, index) => `
      <article class="display-work-item ${escapeHtml(item.level)}">
        <div class="display-work-number">${index + 1}</div>
        <div>
          <div class="display-work-title">
            <strong>${escapeHtml(item.title)}</strong>
            <span class="pill ${escapeHtml(item.level)}">${escapeHtml(levelText(item.level))}</span>
          </div>
          <p>${escapeHtml(item.owner || "Airbnb HOA")}${item.dueText ? ` · ${escapeHtml(item.dueText)}` : ""}</p>
          <small>${escapeHtml(item.detail || "")}</small>
        </div>
      </article>
    `)
    .join("");
}

function renderCases(displayState) {
  const cases = displayState.cases || [];
  $("displayCaseCount").textContent = `${cases.length} Faelle`;
  if (!cases.length) {
    $("displayCases").innerHTML = `<p class="display-empty">Keine Fallakten gespeichert.</p>`;
    return;
  }

  $("displayCases").innerHTML = cases.slice(0, 6)
    .map((caseItem) => `
      <article class="display-case ${escapeHtml(caseItem.level)}">
        <div>
          <strong>${escapeHtml(caseItem.guestName)}</strong>
          <p>${escapeHtml(caseItem.stayText)}${caseItem.reservationCode ? ` · ${escapeHtml(caseItem.reservationCode)}` : ""}</p>
        </div>
        <div class="display-case-status">
          <span class="pill ${escapeHtml(caseItem.level)}">${escapeHtml(caseItem.label)}</span>
          <small>${caseItem.boardApproval ? "Board Approval vorhanden" : `${caseItem.missingCount} Punkte offen`}</small>
        </div>
      </article>
    `)
    .join("");
}

function renderDisplay(displayState) {
  $("displayTitle").textContent = displayState.property?.listingName || "Airbnb HOA";
  $("displaySubtitle").textContent = displayState.property?.unit || "Example Condominium";
  $("displayToday").textContent = formatDate(displayState.today);
  $("displayUpdated").textContent = `Stand ${formatUpdated(displayState.generatedAt)}`;
  $("displayRed").textContent = displayState.summary?.dailyRed ?? 0;
  $("displayAmber").textContent = displayState.summary?.dailyAmber ?? 0;
  $("displayLocked").textContent = displayState.summary?.lockedCases ?? 0;
  $("displayInbox").textContent = displayState.summary?.inboxOpen ?? 0;
  renderWorkItems(displayState);
  renderCases(displayState);
  renderAccess(displayState);
}

async function loadDisplay() {
  const response = await fetch("/api/display-state");
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Display konnte nicht geladen werden");
  renderDisplay(payload.displayState);
}

loadDisplay().catch((error) => {
  $("displayWorkItems").innerHTML = `<p class="display-empty">Display konnte nicht geladen werden: ${escapeHtml(error.message)}</p>`;
});

setInterval(() => {
  loadDisplay().catch(() => {});
}, 30000);
