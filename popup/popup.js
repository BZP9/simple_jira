// Simple Jira Worklog - Popup Script
"use strict";

let selectedTicket = null;
let loggedMinutesToday = 0;
let dailyHoursTarget = 8;
let loggedWorklogs = [];
let dateChangeTimeout = null; // Debounce timer for date changes
let currentRequestId = 0; // Track current request to prevent stale updates
let statusTimeout = null; // Track status message timeout
let isSubmitting = false; // Prevent concurrent submissions
let isSearching = false; // Prevent concurrent searches
let inputMode = "endTime"; // "endTime" or "duration"
let editingWorklog = null; // { ticketKey, id } when editing an existing worklog
let wiggleEnabled = false;
let wiggleMaxMinutes = 10;

// Overview mode state
let overviewYear = new Date().getFullYear();
let overviewMonth = new Date().getMonth(); // 0-indexed
let overviewDayStats = {}; // { 'YYYY-MM-DD': { minutes, loaded } }
let isLoadingOverview = false;

// Constants for validation
const MAX_DOMAIN_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_TOKEN_LENGTH = 500;
const MAX_SEARCH_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_WORKLOG_HOURS = 24;

// Work schedule constants
const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "12:00"; // Lunch break start (morning default)
const LUNCH_START = 12 * 60; // 12:00 in minutes
const LUNCH_END = 13 * 60;   // 13:00 in minutes
const WORK_END = 18 * 60;    // 18:00 in minutes

const ENABLE_WIGGLE = true;
const MAX_WIGGLE_TIME = 10; // start and end time have some wiggle time to randomize the total time to prevent flat records
// DOM Elements
const elements = {};

document.addEventListener("DOMContentLoaded", async () => {
  initElements();
  await checkLoginStatus();
});

function initElements() {
  // Pages
  elements.loginPage = document.getElementById("login-page");
  elements.mainPage = document.getElementById("main-page");
  elements.overviewPage = document.getElementById("overview-page");

  // Login
  elements.jiraDomain = document.getElementById("jira-domain");
  elements.jiraEmail = document.getElementById("jira-email");
  elements.jiraToken = document.getElementById("jira-token");
  elements.loginBtn = document.getElementById("login-btn");
  elements.loginError = document.getElementById("login-error");

  // Main page - Header
  elements.refreshBtn = document.getElementById("refresh-btn");
  elements.logoutBtn = document.getElementById("logout-btn");
  elements.settingsBtn = document.getElementById("settings-btn");
  elements.settingsSheet = document.getElementById("settings-sheet");
  elements.settingsClose = document.getElementById("settings-close");
  elements.targetBarFill = document.getElementById("target-bar-fill");
  elements.workDate = document.getElementById("work-date");
  elements.dateLabel = document.getElementById("date-label");
  elements.prevDay = document.getElementById("prev-day");
  elements.nextDay = document.getElementById("next-day");
  elements.startTime = document.getElementById("start-time");
  elements.endTime = document.getElementById("end-time");
  elements.durationDisplay = document.getElementById("duration-display");

  // Summary section
  elements.dailyHours = document.getElementById("daily-hours");
  elements.loggedHours = document.getElementById("logged-hours");
  elements.remainingHours = document.getElementById("remaining-hours");
  elements.monthLogged = document.getElementById("month-logged");
  elements.monthLeft = document.getElementById("month-left");
  elements.monthLoggedLabel = document.getElementById("month-logged-label");
  elements.monthLeftLabel = document.getElementById("month-left-label");
  elements.worklogList = document.getElementById("worklog-list");
  elements.worklogLoadStatus = document.getElementById("worklog-load-status");

  // Search
  elements.ticketSearch = document.getElementById("ticket-search");
  elements.searchBtn = document.getElementById("search-btn");
  elements.searchResults = document.getElementById("search-results");

  // Worklog entry
  elements.worklogSection = document.getElementById("worklog-section");
  elements.selectedTicketKey = document.getElementById("selected-ticket-key");
  elements.selectedTicketSummary = document.getElementById("selected-ticket-summary");
  elements.clearTicket = document.getElementById("clear-ticket");
  elements.worklogDesc = document.getElementById("worklog-desc");
  elements.submitWorklog = document.getElementById("submit-worklog");
  elements.statusMessage = document.getElementById("status-message");

  // Pinned tickets
  elements.pinnedTickets = document.getElementById("pinned-tickets");
  elements.pinTicket = document.getElementById("pin-ticket");

  // Ticket dropdown
  elements.ticketDropdownBtn = document.getElementById("ticket-dropdown-btn");
  elements.ticketDropdownLabel = document.getElementById("ticket-dropdown-label");
  elements.ticketDropdownMenu = document.getElementById("ticket-dropdown-menu");
  elements.ticketDropdownList = document.getElementById("ticket-dropdown-list");

  // Last unlogged day
  elements.lastUnloggedDay = document.getElementById("last-unlogged-day");

  // Overview page
  elements.overviewBtn = document.getElementById("overview-btn");
  elements.overviewBackBtn = document.getElementById("overview-back-btn");
  elements.overviewPrevMonth = document.getElementById("overview-prev-month");
  elements.overviewNextMonth = document.getElementById("overview-next-month");
  elements.overviewReloadBtn = document.getElementById("overview-reload-btn");
  elements.overviewMonthLabel = document.getElementById("overview-month-label");
  elements.overviewCalendar = document.getElementById("overview-calendar");
  elements.overviewSummary = document.getElementById("overview-summary");
  elements.overviewHoursSummary = document.getElementById("overview-hours-summary");
  elements.overviewStatus = document.getElementById("overview-status");

  // Auto-advance & presets
  elements.autoAdvance = document.getElementById("auto-advance");
  elements.rememberTicket = document.getElementById("remember-ticket");
  elements.presetDescriptions = document.getElementById("preset-descriptions");
  elements.saveDescPreset = document.getElementById("save-desc-preset");

  // Duration/End time toggle
  elements.endTimeContainer = document.getElementById("end-time-container");
  elements.durationInputContainer = document.getElementById("duration-input-container");
  elements.durationHours = document.getElementById("duration-hours");
  elements.durationMinutes = document.getElementById("duration-minutes");
  elements.toggleInputMode = document.getElementById("toggle-input-mode");
  elements.durationLabel = document.getElementById("duration-label");

  // Collapsible time chip
  elements.timeChip = document.getElementById("time-chip");
  elements.timeChipText = document.getElementById("time-chip-text");
  elements.timeEditor = document.getElementById("time-editor");

  // Wiggle settings
  elements.wiggleEnabled = document.getElementById("wiggle-enabled");
  elements.wiggleValue = document.getElementById("wiggle-value");
  elements.wiggleInputGroup = document.querySelector(".wiggle-input-group");

  // Set default date to today
  elements.workDate.value = new Date().toISOString().split("T")[0];
  updateDateLabel();

  // Set default times
  elements.startTime.value = DEFAULT_START_TIME;
  elements.endTime.value = DEFAULT_END_TIME;

  setupEventListeners();
}

function setupEventListeners() {
  // Stir the aurora on any click anywhere in the popup (capture phase so it
  // still fires even through handlers that call stopPropagation elsewhere).
  document.addEventListener("click", stirAurora, true);

  // Login / Refresh
  elements.loginBtn.addEventListener("click", handleLogin);
  elements.logoutBtn.addEventListener("click", handleLogout);
  elements.refreshBtn.addEventListener("click", handleRefresh);

  // Settings sheet
  elements.settingsBtn.addEventListener("click", () => {
    const open = elements.settingsSheet.style.display === "none";
    elements.settingsSheet.style.display = open ? "block" : "none";
  });
  elements.settingsClose.addEventListener("click", () => {
    elements.settingsSheet.style.display = "none";
  });

  // Daily hours
  elements.dailyHours.addEventListener("change", async () => {
    let value = parseInt(elements.dailyHours.value) || 8;
    // Enforce bounds (1-24 hours)
    value = Math.max(1, Math.min(24, value));
    elements.dailyHours.value = value;
    dailyHoursTarget = value;
    await browser.storage.local.set({ dailyHours: dailyHoursTarget });
    updateHoursDisplay();
  });

  // Date change - reload worklogs for selected date
  elements.workDate.addEventListener("change", () => {
    updateDateLabel();
    scheduleWorklogLoad(elements.workDate.value);
  });

  // Ticket dropdown
  elements.ticketDropdownBtn.addEventListener("click", toggleTicketDropdown);
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".ticket-dropdown")) closeTicketDropdown();
  });

  // Search
  elements.searchBtn.addEventListener("click", searchTickets);
  elements.ticketSearch.addEventListener("keypress", (e) => {
    if (e.key === "Enter") searchTickets();
  });

  // Worklog
  elements.clearTicket.addEventListener("click", clearSelectedTicket);
  // Cmd/Ctrl+Enter in the description logs the work (zero-mouse path)
  elements.worklogDesc.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submitWorklog();
    }
  });
  elements.startTime.addEventListener("change", () => {
    if (inputMode === "endTime") {
      updateDuration();
    } else {
      // In duration mode, keep duration fixed and update end time
      syncEndTimeFromDurationInputs();
      updateDurationBadgeDisplay();
    }
  });
  elements.endTime.addEventListener("change", updateDuration);
  elements.submitWorklog.addEventListener("click", submitWorklog);

  // Collapsible time editor
  elements.timeChip.addEventListener("click", () => {
    const open = elements.timeEditor.style.display === "none";
    elements.timeEditor.style.display = open ? "block" : "none";
    elements.timeChip.classList.toggle("open", open);
  });

  // Duration input mode toggle
  elements.toggleInputMode.addEventListener("click", toggleInputMode);
  elements.durationHours.addEventListener("change", updateDurationFromInputs);
  elements.durationMinutes.addEventListener("change", updateDurationFromInputs);
  elements.durationHours.addEventListener("input", updateDurationFromInputs);
  elements.durationMinutes.addEventListener("input", updateDurationFromInputs);

  // Date navigation
  elements.prevDay.addEventListener("click", () => changeDate(-1));
  elements.nextDay.addEventListener("click", () => changeDate(1));

  // Click on worklog status to force refresh
  elements.worklogLoadStatus.addEventListener("click", () => {
    scheduleWorklogLoad(elements.workDate.value, true);
  });

  // Pin ticket
  elements.pinTicket.addEventListener("click", togglePinTicket);

  // Last unlogged day
  elements.lastUnloggedDay.addEventListener("click", jumpToLastUnloggedDay);

  // Auto-advance preference
  elements.autoAdvance.addEventListener("change", async () => {
    await browser.storage.local.set({ autoAdvance: elements.autoAdvance.checked });
  });

  // Remember-last-ticket preference
  elements.rememberTicket.addEventListener("change", async () => {
    await browser.storage.local.set({ rememberTicket: elements.rememberTicket.checked });
  });

  // Wiggle settings (persisted so they survive reopening the popup)
  elements.wiggleEnabled.addEventListener("change", async () => {
    wiggleEnabled = elements.wiggleEnabled.checked;
    elements.wiggleInputGroup.style.display = wiggleEnabled ? "flex" : "none";
    await browser.storage.local.set({ wiggleEnabled });
    updateDuration();
  });

  elements.wiggleValue.addEventListener("change", async () => {
    wiggleMaxMinutes = Math.max(1, Math.min(30, parseInt(elements.wiggleValue.value) || 10));
    elements.wiggleValue.value = wiggleMaxMinutes;
    await browser.storage.local.set({ wiggleValue: wiggleMaxMinutes });
    updateDuration();
  });

  // Save description preset
  elements.saveDescPreset.addEventListener("click", saveDescriptionPreset);

  // Overview mode
  elements.overviewBtn.addEventListener("click", showOverviewPage);
  elements.overviewBackBtn.addEventListener("click", showDailyPage);
  elements.overviewPrevMonth.addEventListener("click", () => navigateOverviewMonth(-1));
  elements.overviewNextMonth.addEventListener("click", () => navigateOverviewMonth(1));
  elements.overviewReloadBtn.addEventListener("click", () => {
    overviewDayStats = {};
    loadMonthOverview(overviewYear, overviewMonth, true);
  });

  // Load saved input mode preference
  loadInputModePreference();
}

async function loadInputModePreference() {
  const data = await browser.storage.local.get(["inputMode"]);
  if (data.inputMode === "duration") {
    inputMode = "duration";
    applyInputMode();
  }
}

function toggleInputMode() {
  inputMode = inputMode === "endTime" ? "duration" : "endTime";
  browser.storage.local.set({ inputMode });
  applyInputMode();
}

function applyInputMode() {
  if (inputMode === "duration") {
    elements.endTimeContainer.style.display = "none";
    elements.durationInputContainer.style.display = "block";
    elements.durationLabel.textContent = "End";
    // Sync duration inputs from current end time calculation
    syncDurationInputsFromEndTime();
  } else {
    elements.endTimeContainer.style.display = "block";
    elements.durationInputContainer.style.display = "none";
    elements.durationLabel.textContent = "Duration";
    // Sync end time from duration inputs
    syncEndTimeFromDurationInputs();
  }
  // Update badge display
  updateDurationBadgeDisplay();
}

function syncDurationInputsFromEndTime() {
  const minutes = calculateDurationMinutes();
  if (minutes > 0) {
    elements.durationHours.value = Math.floor(minutes / 60);
    elements.durationMinutes.value = minutes % 60;
  }
}

function syncEndTimeFromDurationInputs() {
  const hours = parseInt(elements.durationHours.value) || 0;
  const mins = parseInt(elements.durationMinutes.value) || 0;
  const totalMinutes = hours * 60 + mins;

  const start = elements.startTime.value;
  if (start) {
    const [startH, startM] = start.split(":").map(Number);
    const startMinutes = startH * 60 + startM;
    let endMinutes = startMinutes + totalMinutes;

    // Cap at 23:59 to prevent invalid times
    if (endMinutes >= 24 * 60) {
      endMinutes = 23 * 60 + 59;
    }

    const endH = Math.floor(endMinutes / 60);
    const endM = endMinutes % 60;
    elements.endTime.value = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
  }
}

function updateDurationFromInputs() {
  let hours = parseInt(elements.durationHours.value) || 0;
  let mins = parseInt(elements.durationMinutes.value) || 0;

  // Clamp values
  hours = Math.max(0, Math.min(24, hours));
  mins = Math.max(0, Math.min(59, mins));

  // Update input fields if clamped (on blur will enforce this)
  if (parseInt(elements.durationHours.value) !== hours) {
    elements.durationHours.value = hours;
  }
  if (parseInt(elements.durationMinutes.value) !== mins) {
    elements.durationMinutes.value = mins;
  }

  const totalMinutes = hours * 60 + mins;

  if (totalMinutes > 0 && totalMinutes <= MAX_WORKLOG_HOURS * 60) {
    // Update end time based on duration
    syncEndTimeFromDurationInputs();
    // Show end time in the badge when in duration mode
    updateDurationBadgeDisplay();
  } else if (totalMinutes === 0) {
    elements.durationDisplay.textContent = "0h 0m";
  } else {
    elements.durationDisplay.textContent = "Invalid";
  }
}

function updateDurationBadgeDisplay() {
  if (inputMode === "duration") {
    // Show end time when in duration mode
    const end = elements.endTime.value;
    if (end) {
      elements.durationDisplay.textContent = `→ ${end}`;
    }
  } else {
    // Show duration when in end time mode
    const duration = calculateDurationMinutes();
    if (duration > 0) {
      elements.durationDisplay.textContent = formatMinutes(duration);
    } else {
      elements.durationDisplay.textContent = "Invalid";
    }
  }
  updateTimeChip();
}

// Keep the collapsed chip in sync with the current start/end/duration.
// When wiggle is on, the logged span is randomised at submit, so the chip
// marks the planned duration as approximate (~) to signal it will drift.
function updateTimeChip() {
  if (!elements.timeChipText) return;
  const start = elements.startTime.value || "--:--";
  const end = elements.endTime.value || "--:--";
  const duration = calculateDurationMinutes();
  const durText = duration > 0
    ? `${wiggleEnabled ? "~" : ""}${formatMinutes(duration)}`
    : "—";
  const wiggleTag = wiggleEnabled ? " · wiggle" : "";
  elements.timeChipText.textContent = `${start} → ${end} · ${durText}${wiggleTag}`;
}

// Several fixed pivot regions, each its own oval orbit (center, distinct
// x/y radii so it's an ellipse not a circle, a tilt, and its own running
// phase) — generated once per popup session, not from click position. Every
// stir randomly picks one of these and advances ITS phase, so the pivot
// wanders unpredictably between several distinct paths instead of repeating
// one ellipse or jumping to wherever you happened to click. Centers/radii
// are chosen to stay well clear of the edges (see clampPct below combined
// with the wrap's own generous overscan), so the aurora is always
// guaranteed to fully cover the UI no matter which pivot or phase is active.
const AURORA_PIVOT_COUNT = 4;
const auroraPivots = Array.from({ length: AURORA_PIVOT_COUNT }, () => ({
  centerX: 30 + Math.random() * 40, // 30-70%
  centerY: 30 + Math.random() * 40, // 30-70%
  radiusX: 8 + Math.random() * 14,  // 8-22%
  radiusY: 5 + Math.random() * 10,  // 5-15% — distinct range from radiusX, so it's an oval
  tilt: Math.random() * 360,        // degrees, fixed orientation of this pivot's ellipse
  phase: Math.random() * 360        // each pivot remembers its own progress independently
}));

// Stir the aurora like touching water: every click anywhere in the popup
// (attached once, capture phase, in setupEventListeners) advances its
// rotation by a big, fully randomized amount — magnitude and direction both
// random each time — and HOLDS there (a smooth CSS transition on the
// rotation, not a spring back to 0), so each click leaves the aurora at a
// new resting orientation instead of visibly snapping back afterward. Only
// the brief "catching the light" filter flash is a one-shot animation; the
// rotation itself is persistent, accumulating across clicks. The pivot point
// travels along one of the fixed oval paths above (a different one picked
// at random each time) rather than the click position, so it's always
// within the safe band regardless of where in the popup you clicked.
// Capture phase so it still fires even through handlers elsewhere that call
// stopPropagation (e.g. the unpin button, worklog action buttons).
let auroraRotation = 0;
function stirAurora() {
  const wrap = document.getElementById("aurora-wrap");
  if (!wrap) return;

  // Respect reduced motion by skipping the effect entirely, rather than
  // instantly snapping a big rotation into place with no transition.
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const pivot = auroraPivots[Math.floor(Math.random() * auroraPivots.length)];
  pivot.phase = (pivot.phase + 40 + Math.random() * 70) % 360;
  const rad = (pivot.phase * Math.PI) / 180;
  const tiltRad = (pivot.tilt * Math.PI) / 180;
  const ux = pivot.radiusX * Math.cos(rad);
  const uy = pivot.radiusY * Math.sin(rad);
  const xPct = pivot.centerX + (ux * Math.cos(tiltRad) - uy * Math.sin(tiltRad));
  const yPct = pivot.centerY + (ux * Math.sin(tiltRad) + uy * Math.cos(tiltRad));

  const sign = Math.random() < 0.5 ? 1 : -1;
  const magnitude = 60 + Math.random() * 80; // 60..140 degrees — a real sweep, not a wiggle

  auroraRotation = (auroraRotation + sign * magnitude) % 360;

  wrap.style.setProperty("--stir-x", `${xPct.toFixed(1)}%`);
  wrap.style.setProperty("--stir-y", `${yPct.toFixed(1)}%`);
  wrap.style.setProperty("--stir-angle", `${auroraRotation.toFixed(2)}deg`);

  // Filter flash only — the rotation above holds via CSS transition, no
  // restart needed for that part.
  wrap.classList.remove("aurora-stir");
  void wrap.offsetWidth; // force reflow so re-adding the class restarts the CSS animation
  wrap.classList.add("aurora-stir");
  wrap.addEventListener("animationend", () => wrap.classList.remove("aurora-stir"), { once: true });
}

function changeDate(days) {
  const current = new Date(elements.workDate.value);
  current.setDate(current.getDate() + days);
  elements.workDate.value = current.toISOString().split("T")[0];
  updateDateLabel();
  scheduleWorklogLoad(elements.workDate.value);
}

// Debounced worklog loading - clears display immediately, loads after 100ms delay
function scheduleWorklogLoad(date, forceRefresh = false) {
  // Clear any pending load
  if (dateChangeTimeout) {
    clearTimeout(dateChangeTimeout);
    dateChangeTimeout = null;
  }

  // Increment request ID to invalidate any in-flight requests
  const requestId = ++currentRequestId;

  // Clear display immediately to prevent stale data
  loggedMinutesToday = 0;
  loggedWorklogs = [];
  updateHoursDisplay();
  hideWorklogLoadStatus();

  // Schedule the actual load after 100ms
  dateChangeTimeout = setTimeout(() => {
    dateChangeTimeout = null;
    // Only proceed if this is still the current request
    if (requestId === currentRequestId) {
      loadWorklogsForDate(date, forceRefresh, requestId);
    }
  }, 100);
}

function updateDateLabel() {
  const today = new Date().toISOString().split("T")[0];
  const selected = elements.workDate.value;

  if (selected === today) {
    elements.dateLabel.textContent = "Today";
  } else {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    if (selected === yesterdayStr) {
      elements.dateLabel.textContent = "Yesterday";
    } else if (selected === tomorrowStr) {
      elements.dateLabel.textContent = "Tomorrow";
    } else {
      const date = new Date(selected);
      const options = { weekday: 'short', month: 'short', day: 'numeric' };
      elements.dateLabel.textContent = date.toLocaleDateString('en-US', options);
    }
  }
}

async function checkLoginStatus() {
  const data = await browser.storage.local.get([
    "jiraDomain",
    "jiraEmail",
    "jiraToken",
    "dailyHours",
    "autoAdvance",
    "wiggleEnabled",
    "wiggleValue",
    "rememberTicket",
    "lastTicket"
  ]);

  if (data.jiraDomain && data.jiraEmail && data.jiraToken) {
    // Already logged in, show main page
    dailyHoursTarget = data.dailyHours || 8;
    elements.dailyHours.value = dailyHoursTarget;
    elements.autoAdvance.checked = data.autoAdvance || false;

    // Restore wiggle preference (persisted across popup sessions)
    wiggleEnabled = data.wiggleEnabled || false;
    wiggleMaxMinutes = data.wiggleValue || 10;
    elements.wiggleEnabled.checked = wiggleEnabled;
    elements.wiggleValue.value = wiggleMaxMinutes;
    elements.wiggleInputGroup.style.display = wiggleEnabled ? "flex" : "none";

    // Memory mode: default on. Restore whichever ticket was last selected
    // immediately, independent of the day's worklog load (which can be slow
    // or fail) — the point is to never make you re-pick a ticket you were
    // already working from. autoSelectDefaultTicket() (recent/pinned
    // fallback) is a no-op once a ticket is already selected here.
    const rememberTicket = data.rememberTicket !== false; // default true
    elements.rememberTicket.checked = rememberTicket;
    if (rememberTicket && data.lastTicket && data.lastTicket.key) {
      selectTicket(data.lastTicket.key, data.lastTicket.summary || "");
    }

    showMainPage();
    loadTodayWorklogs();
  } else {
    // Show login page
    showLoginPage();
  }
}

function showLoginPage() {
  elements.loginPage.style.display = "block";
  elements.mainPage.style.display = "none";
}

function showMainPage() {
  elements.loginPage.style.display = "none";
  elements.mainPage.style.display = "block";
  renderTicketDropdown();
  renderDescriptionPresets();
}

async function handleLogin() {
  const domain = normalizeDomain(elements.jiraDomain.value.trim());
  const email = sanitizeString(elements.jiraEmail.value.trim(), MAX_EMAIL_LENGTH);
  const token = sanitizeString(elements.jiraToken.value.trim(), MAX_TOKEN_LENGTH);

  // Validate inputs
  if (!domain || !email || !token) {
    elements.loginError.textContent = "Please fill in all fields";
    return;
  }

  if (!isValidDomain(domain)) {
    elements.loginError.textContent = "Invalid domain format";
    return;
  }

  if (!isValidEmail(email)) {
    elements.loginError.textContent = "Invalid email format";
    return;
  }

  if (token.length < 10) {
    elements.loginError.textContent = "API token seems too short";
    return;
  }

  elements.loginBtn.disabled = true;
  elements.loginBtn.textContent = "Connecting...";
  elements.loginError.textContent = "";

  try {
    // Save credentials first so background script can use them
    await browser.storage.local.set({
      jiraDomain: domain,
      jiraEmail: email,
      jiraToken: token
    });

    // Test connection using background script
    const response = await jiraFetch(`https://${domain}/rest/api/3/myself`);

    if (response.ok) {
      showMainPage();
      loadTodayWorklogs();
    } else {
      // Clear credentials on failure
      await browser.storage.local.remove(["jiraDomain", "jiraEmail", "jiraToken"]);

      if (response.status === 401) {
        elements.loginError.textContent = "Invalid email or API token";
      } else if (response.status === 403) {
        elements.loginError.textContent = "Access denied. Check permissions.";
      } else if (response.status === 404) {
        elements.loginError.textContent = "Domain not found. Check your Jira URL.";
      } else {
        elements.loginError.textContent = `Connection failed (${response.status})`;
      }
    }
  } catch (err) {
    // Clear credentials on error
    await browser.storage.local.remove(["jiraDomain", "jiraEmail", "jiraToken"]);
    elements.loginError.textContent = `Error: ${sanitizeString(err.message, 100)}`;
  }

  elements.loginBtn.disabled = false;
  elements.loginBtn.textContent = "Connect";
}

async function handleLogout() {
  // Cancel any pending requests
  if (dateChangeTimeout) {
    clearTimeout(dateChangeTimeout);
    dateChangeTimeout = null;
  }
  currentRequestId++; // Invalidate any in-flight requests

  await browser.storage.local.remove(["jiraDomain", "jiraEmail", "jiraToken"]);
  await clearWorklogCache();
  elements.jiraDomain.value = "";
  elements.jiraEmail.value = "";
  elements.jiraToken.value = "";
  loggedMinutesToday = 0;
  loggedWorklogs = [];
  selectedTicket = null;
  elements.worklogSection.style.display = "none";
  elements.searchResults.innerHTML = "";
  elements.worklogList.innerHTML = "";
  hideWorklogLoadStatus();
  updateHoursDisplay();
  showLoginPage();
}

async function handleRefresh() {
  elements.refreshBtn.disabled = true;

  // Clear all cached worklog data
  await clearWorklogCache();

  // Reset current state
  loggedMinutesToday = 0;
  loggedWorklogs = [];
  updateHoursDisplay();

  // Reload worklogs for the current date (force refresh)
  scheduleWorklogLoad(elements.workDate.value, true);

  // Re-render ticket dropdown (in case storage changed externally)
  renderTicketDropdown();

  elements.refreshBtn.disabled = false;
}

function normalizeDomain(domain) {
  if (!domain || typeof domain !== "string") return "";
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/\/+$/, "");
  // Remove any path components
  domain = domain.split("/")[0];
  if (!domain.includes(".")) {
    domain = domain + ".atlassian.net";
  }
  return domain.slice(0, MAX_DOMAIN_LENGTH);
}

// Input validation helpers
function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  if (email.length > MAX_EMAIL_LENGTH) return false;
  // Basic email validation
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidDomain(domain) {
  if (!domain || typeof domain !== "string") return false;
  if (domain.length > MAX_DOMAIN_LENGTH) return false;
  // Check for valid domain characters
  return /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/.test(domain);
}

function isValidTicketKey(key) {
  if (!key || typeof key !== "string") return false;
  // Jira ticket format: PROJECT-123
  return /^[A-Z][A-Z0-9]+-\d+$/i.test(key) && key.length <= 50;
}

function isValidDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return false;
  // Check format YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

function isValidTime(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return false;
  // Check format HH:MM
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(timeStr);
}

function sanitizeString(str, maxLength = 1000) {
  if (str == null) return "";
  return String(str).slice(0, maxLength);
}

// With wiggle on, each entry can shave up to 2*wiggle minutes, so a full day
// lands up to 2*wiggle*entries short of target. Treat the day as met within
// that margin (the accepted margin) so "Done" and auto-advance still fire.
function targetToleranceMinutes(entryCount) {
  if (!wiggleEnabled) return 0;
  return 2 * wiggleMaxMinutes * Math.max(1, entryCount);
}

function updateHoursDisplay() {
  const targetMinutes = dailyHoursTarget * 60;

  elements.loggedHours.textContent = formatMinutes(loggedMinutesToday);

  const remaining = targetMinutes - loggedMinutesToday;
  const tolerance = targetToleranceMinutes(loggedWorklogs.length);
  const metWithinMargin = loggedMinutesToday >= targetMinutes - tolerance;

  if (remaining <= 0) {
    // Over target — show excess
    elements.remainingHours.textContent = `+${formatMinutes(Math.abs(remaining))}`;
    elements.remainingHours.style.color = "#57e2b0";
  } else if (metWithinMargin) {
    // Within the wiggle margin — effectively done for the day
    elements.remainingHours.textContent = `${formatMinutes(remaining)} ✓`;
    elements.remainingHours.style.color = "#57e2b0";
  } else {
    elements.remainingHours.textContent = formatMinutes(remaining);
    elements.remainingHours.style.color = "";
  }

  // Update target progress bar
  if (elements.targetBarFill) {
    const pct = targetMinutes > 0
      ? Math.max(0, Math.min(100, (loggedMinutesToday / targetMinutes) * 100))
      : 0;
    elements.targetBarFill.style.width = `${pct}%`;
    elements.targetBarFill.classList.toggle("met", metWithinMargin);
  }

  // Drive the aurora's intensity from how full the day is (dim when empty,
  // vivid near/at target). Uncapped a bit above 1 so overtime keeps glowing
  // rather than plateauing right at the target.
  const auroraFill = targetMinutes > 0
    ? Math.max(0, Math.min(1.2, loggedMinutesToday / targetMinutes))
    : 0;
  document.documentElement.style.setProperty("--aurora-fill", auroraFill.toFixed(3));

  // Update monthly summary from cache
  updateMonthSummary();

  // Render worklog list
  if (loggedWorklogs.length === 0) {
    elements.worklogList.innerHTML = "";
  } else {
    elements.worklogList.innerHTML = loggedWorklogs
      .map((log, idx) => {
        const startTime = log.started ? log.started.substring(11, 16) : "";
        const endTime = getWorklogEndTime(log.started, log.minutes);
        const timeRange = startTime && endTime ? `${startTime}–${endTime}` : startTime;
        return `
        <div class="worklog-entry" data-index="${idx}">
          <span class="worklog-ticket">${escapeHtml(log.ticketKey || "")}</span>
          <span class="worklog-time">${timeRange}</span>
          <span class="worklog-comment">${log.comment ? escapeHtml(log.comment) : "-"}</span>
          <span class="worklog-duration">${formatMinutes(log.minutes || 0)}</span>
        </div>
      `;
      })
      .join("");

    // Add click handlers for toggle actions
    elements.worklogList.querySelectorAll(".worklog-entry").forEach(entry => {
      entry.addEventListener("click", () => {
        const idx = parseInt(entry.dataset.index);
        toggleWorklogActions(idx, entry);
      });
    });
  }
}

async function updateMonthSummary() {
  const selectedDate = elements.workDate.value || new Date().toISOString().split("T")[0];
  const [year, monthNum] = selectedDate.split("-").map(Number);
  const month = monthNum - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Count total working days in month
  let totalWorkingDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow !== 0 && dow !== 6) totalWorkingDays++;
  }

  // Sum logged minutes from cache for this month
  const pad = n => String(n).padStart(2, "0");
  const startDate = `${year}-${pad(month + 1)}-01`;
  const endDate = `${year}-${pad(month + 1)}-${pad(daysInMonth)}`;

  const cache = await getWorklogCache();
  let totalLoggedMinutes = 0;
  for (const [date, data] of Object.entries(cache)) {
    if (date >= startDate && date <= endDate) {
      totalLoggedMinutes += data.totalMinutes || 0;
    }
  }

  const totalExpectedMinutes = totalWorkingDays * dailyHoursTarget * 60;
  const monthLeftMinutes = totalExpectedMinutes - totalLoggedMinutes;

  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthLabel = monthNames[month];
  elements.monthLoggedLabel.textContent = `${monthLabel} logged:`;
  elements.monthLeftLabel.textContent = `${monthLabel} left:`;

  elements.monthLogged.textContent = formatMinutes(totalLoggedMinutes);

  if (monthLeftMinutes >= 0) {
    elements.monthLeft.textContent = formatMinutes(monthLeftMinutes);
    elements.monthLeft.style.color = "";
  } else {
    elements.monthLeft.textContent = `+${formatMinutes(Math.abs(monthLeftMinutes))}`;
    elements.monthLeft.style.color = "#57e2b0";
  }
}

function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

// Compute end time (HH:MM) from a worklog's start timestamp + logged minutes.
// Lets the history show the actual logged span so wiggle's effect is visible.
function getWorklogEndTime(started, minutes) {
  if (!started || !minutes) return "";
  const startH = parseInt(started.substring(11, 13), 10);
  const startM = parseInt(started.substring(14, 16), 10);
  if (Number.isNaN(startH) || Number.isNaN(startM)) return "";
  const endTotal = startH * 60 + startM + minutes;
  const endH = Math.floor(endTotal / 60) % 24;
  const endM = endTotal % 60;
  return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
}

function calculateDurationMinutes() {
  const start = elements.startTime.value;
  const end = elements.endTime.value;

  if (!start || !end) return 0;

  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  return endMinutes - startMinutes;
}

function updateDuration() {
  const duration = calculateDurationMinutes();

  if (duration > 0) {
    // Keep duration inputs in sync when in end time mode
    if (inputMode === "endTime") {
      elements.durationHours.value = Math.floor(duration / 60);
      elements.durationMinutes.value = duration % 60;
    }
  }
  // Update badge display based on current mode
  updateDurationBadgeDisplay();
}

async function getJiraDomain() {
  const data = await browser.storage.local.get(["jiraDomain"]);
  return data.jiraDomain;
}

async function jiraFetch(url, options = {}) {
  // Use background script to make API calls (avoids CORS issues)
  const result = await browser.runtime.sendMessage({
    action: "jiraFetch",
    url: url,
    options: options
  });

  if (result.error) {
    throw new Error(result.error);
  }

  // Return a response-like object
  return {
    ok: result.ok,
    status: result.status,
    json: async () => result.data,
    text: async () => typeof result.data === "string" ? result.data : JSON.stringify(result.data)
  };
}

// Issue search that survives Jira Cloud's removal of the classic
// GET /rest/api/3/search (now returns 410). Tries the classic endpoint for
// older Server/DC instances, then falls back to POST /rest/api/3/search/jql.
// Returns a jiraFetch response-like object; both endpoints expose `.issues`.
async function jiraSearchIssues(domain, jql, fields, maxResults) {
  const fieldList = (fields || ["key"]).join(",");
  let resp = await jiraFetch(
    `https://${domain}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=${fieldList}`
  );

  if (resp.status === 410 || resp.status === 404) {
    resp = await jiraFetch(`https://${domain}/rest/api/3/search/jql`, {
      method: "POST",
      body: JSON.stringify({ jql, maxResults, fields: fields || ["key"] })
    });
  }

  return resp;
}

function loadTodayWorklogs() {
  const date = new Date().toISOString().split("T")[0];
  scheduleWorklogLoad(date);
}

function showWorklogLoadStatus(message, type) {
  elements.worklogLoadStatus.textContent = message;
  elements.worklogLoadStatus.className = `worklog-load-status ${type}`;
}

function hideWorklogLoadStatus() {
  elements.worklogLoadStatus.textContent = "";
  elements.worklogLoadStatus.className = "worklog-load-status";
}

// ===== Fetch guard =====
// Throttles live Jira reads to at most once per FETCH_GUARD_MS per scope
// (e.g. "day:2026-07-21", "month:2026-07"), persisted so it survives closing
// and reopening the popup. Any worklog mutation made by this extension bumps
// a monotonic mutationSeq, which invalidates every scope's freshness
// immediately regardless of the timer — a single write can shift what a
// month/day query returns, and we'd rather over-fetch once than show stale
// numbers after our own edit. A counter (not a timestamp) decides "mutated
// since last fetch" so same-millisecond mutation-then-fetch calls can't race;
// the 60s window still uses wall-clock time, which only needs to be
// approximately right. This does NOT know about changes made outside this
// popup (Jira web UI, teammates on a shared ticket) — those are only caught
// once the guard window naturally elapses.
const FETCH_GUARD_KEY = "fetchGuard";
const FETCH_GUARD_MS = 60 * 1000;

async function getFetchGuardState() {
  const stored = await browser.storage.local.get([FETCH_GUARD_KEY]);
  const state = stored[FETCH_GUARD_KEY] || {};
  // Normalize defensively rather than trusting the stored shape: storage may
  // hold an object saved by an earlier schema version (e.g. the original
  // {lastFetchAt, lastMutationAt} shape before mutationSeq replaced it), or be
  // partially written. Missing fields default to empty rather than crashing.
  return {
    lastFetchAt: state.lastFetchAt || {},
    lastFetchSeq: state.lastFetchSeq || {},
    mutationSeq: state.mutationSeq || 0
  };
}

async function isScopeFresh(scopeKey) {
  const state = await getFetchGuardState();
  const fetchedAt = state.lastFetchAt[scopeKey];
  if (!fetchedAt) return false;
  if ((state.lastFetchSeq[scopeKey] ?? -1) !== state.mutationSeq) return false; // mutated since last fetch
  return Date.now() - fetchedAt < FETCH_GUARD_MS;
}

async function markScopeFetched(scopeKey) {
  const state = await getFetchGuardState();
  state.lastFetchAt[scopeKey] = Date.now();
  state.lastFetchSeq[scopeKey] = state.mutationSeq;
  await browser.storage.local.set({ [FETCH_GUARD_KEY]: state });
}

// Call after any successful create/update/delete worklog request.
async function markJiraMutated() {
  const state = await getFetchGuardState();
  state.mutationSeq = (state.mutationSeq || 0) + 1;
  await browser.storage.local.set({ [FETCH_GUARD_KEY]: state });
}

// Cache management for worklog data
const CACHE_KEY = "worklogCache";
const CACHE_MAX_DAYS = 20;

async function getWorklogCache() {
  const stored = await browser.storage.local.get([CACHE_KEY]);
  return stored[CACHE_KEY] || {};
}

async function saveWorklogCache(cache) {
  // Clean up old entries - keep only last 20 days
  const dates = Object.keys(cache).sort().reverse();
  const cleanedCache = {};
  for (const date of dates.slice(0, CACHE_MAX_DAYS)) {
    cleanedCache[date] = cache[date];
  }
  await browser.storage.local.set({ [CACHE_KEY]: cleanedCache });
}

async function getCachedWorklogs(date) {
  const cache = await getWorklogCache();
  const cached = cache[date];
  if (!cached || !cached.worklogs) return null;

  // Derive the total from the individual entries rather than trusting the
  // stored totalMinutes field: summing independently-rounded per-entry
  // minutes doesn't always equal Math.round(sum of raw seconds) (e.g. three
  // 89-second logs round to 1min each = 3, but the true sum 267s rounds to
  // 4) — that's ordinary rounding drift, not corruption. An earlier version
  // rejected the whole cache entry whenever these disagreed, which combined
  // with the fetch guard meant: guard says "already fetched, don't re-hit
  // Jira" while this check independently threw the cached data away, leaving
  // the board blank until the guard window elapsed.
  const totalMinutes = cached.worklogs.reduce((sum, log) => sum + (log.minutes || 0), 0);
  return { worklogs: cached.worklogs, totalMinutes };
}

async function setCachedWorklogs(date, worklogs, totalMinutes) {
  const cache = await getWorklogCache();
  cache[date] = {
    worklogs: worklogs,
    totalMinutes: totalMinutes,
    cachedAt: Date.now()
  };
  await saveWorklogCache(cache);
}

async function clearWorklogCache() {
  await browser.storage.local.remove([CACHE_KEY]);
}

async function loadWorklogsForDate(date, forceRefresh = false, requestId = null) {
  // If no requestId provided (direct call), use current
  if (requestId === null) {
    requestId = ++currentRequestId;
  }

  const domain = await getJiraDomain();
  if (!domain) return;

  // Check cache first (unless force refresh).
  // Past dates: cache is trusted indefinitely (assumed immutable).
  // Today: only trust cache within the 1-min fetch guard, since today's
  // worklogs are the ones actively being added to.
  const today = new Date().toISOString().split("T")[0];
  const isToday = date === today;
  const dayScope = `day:${date}`;
  const useCacheForToday = isToday && await isScopeFresh(dayScope);

  if (!forceRefresh && (!isToday || useCacheForToday)) {
    const cached = await getCachedWorklogs(date);
    if (cached) {
      if (requestId !== currentRequestId) return;
      loggedMinutesToday = cached.totalMinutes;
      loggedWorklogs = [...cached.worklogs]; // Copy array to avoid reference issues
      updateHoursDisplay();
      // Recalculate start time based on cached worklogs if a ticket is selected
      if (selectedTicket) {
        setSmartStartTime();
        syncDurationInputsFromEndTime();
        updateDurationBadgeDisplay();
      } else {
        autoSelectDefaultTicket();
      }
      showWorklogLoadStatus(
        isToday ? "Cached (refreshes within 1 min, tap to force)" : "From cache (tap to refresh)",
        "info"
      );
      return;
    }
  }

  if (requestId !== currentRequestId) return;
  showWorklogLoadStatus("Connecting to Jira...", "loading");

  try {
    // Get current user
    const meResponse = await jiraFetch(`https://${domain}/rest/api/3/myself`);
    if (!meResponse.ok) {
      if (requestId !== currentRequestId) return;
      showWorklogLoadStatus(`Failed to get user (${meResponse.status})`, "error");
      return;
    }

    const me = await meResponse.json();
    const accountId = me.accountId;

    if (requestId !== currentRequestId) return;
    showWorklogLoadStatus("Searching for tickets...", "loading");

    // Get tickets to check - combine JQL search + recent tickets list
    let ticketKeys = [];
    let jqlTicketCount = 0;

    // Try JQL search for worklogs on this date
    try {
      const jql = `worklogDate = "${date}" AND worklogAuthor = currentUser()`;
      const searchResponse = await jiraSearchIssues(domain, jql, ["key"], 50);
      if (searchResponse.ok) {
        const searchResult = await searchResponse.json();
        ticketKeys = (searchResult.issues || []).map(i => i.key);
        jqlTicketCount = ticketKeys.length;
      }
    } catch (e) {
      // JQL search failed, continue with recent tickets
    }

    // Also include recent tickets
    const stored = await browser.storage.local.get(["recentTickets"]);
    const recentTickets = stored.recentTickets || [];
    ticketKeys = [...new Set([...ticketKeys, ...recentTickets])];

    if (ticketKeys.length === 0) {
      if (requestId !== currentRequestId) return;
      loggedMinutesToday = 0;
      loggedWorklogs = [];
      updateHoursDisplay();
      showWorklogLoadStatus("No tickets tracked - search and select tickets", "info");
      return;
    }

    if (requestId !== currentRequestId) return;
    showWorklogLoadStatus(`Found ${jqlTicketCount} tickets, fetching worklogs (0/${ticketKeys.length})...`, "loading");

    // Fetch worklogs from tickets and filter by date
    const result = await fetchWorklogsForDate(ticketKeys, accountId, date, domain, requestId);

    if (result === null) {
      if (requestId !== currentRequestId) return;
      showWorklogLoadStatus("Request cancelled", "info");
      return;
    }

    const { worklogs, totalMinutes } = result;

    // Save to cache
    await setCachedWorklogs(date, worklogs, totalMinutes);
    await markScopeFetched(dayScope);

    if (requestId !== currentRequestId) return;

    // Update UI
    loggedWorklogs = worklogs;
    loggedMinutesToday = totalMinutes;
    updateHoursDisplay();

    // Recalculate start time based on new date's worklogs if a ticket is selected
    if (selectedTicket) {
      setSmartStartTime();
      syncDurationInputsFromEndTime();
      updateDurationBadgeDisplay();
    } else {
      autoSelectDefaultTicket();
    }

    if (worklogs.length === 0) {
      showWorklogLoadStatus("No worklogs for this date", "info");
    } else {
      showWorklogLoadStatus(`Loaded ${worklogs.length} worklogs (${formatMinutes(totalMinutes)})`, "info");
    }

  } catch (err) {
    if (requestId !== currentRequestId) return;
    console.error("Error loading worklogs:", err);
    loggedMinutesToday = 0;
    loggedWorklogs = [];
    updateHoursDisplay();
    showWorklogLoadStatus(`Error: ${err.message}`, "error");
  }
}

async function fetchWorklogsForDate(ticketKeys, accountId, date, domain, requestId) {
  let totalSeconds = 0;
  const worklogs = [];
  const keysToCheck = ticketKeys.slice(0, 30);

  for (let idx = 0; idx < keysToCheck.length; idx++) {
    const ticketKey = keysToCheck[idx];
    if (requestId !== currentRequestId) return null;

    showWorklogLoadStatus(`Fetching worklogs (${idx + 1}/${keysToCheck.length}): ${ticketKey}...`, "loading");

    try {
      const response = await jiraFetch(
        `https://${domain}/rest/api/3/issue/${ticketKey}/worklog?maxResults=5000`
      );

      if (!response.ok) continue;

      const data = await response.json();

      for (const log of data.worklogs || []) {
        // Only include worklogs by current user on the selected date
        if (log.author?.accountId === accountId && log.started?.startsWith(date)) {
          const minutes = Math.round((log.timeSpentSeconds || 0) / 60);
          totalSeconds += log.timeSpentSeconds || 0;
          worklogs.push({
            id: log.id,
            ticketKey,
            minutes,
            comment: extractCommentText(log.comment),
            started: log.started
          });
        }
      }
    } catch (err) {
      // Skip failed tickets
    }
  }

  if (requestId !== currentRequestId) return null;

  // Sort by start time
  worklogs.sort((a, b) => (a.started || "").localeCompare(b.started || ""));

  return {
    worklogs,
    totalMinutes: Math.round(totalSeconds / 60)
  };
}

// Save ticket to recent list when selected
async function saveRecentTicket(ticketKey, summary) {
  const stored = await browser.storage.local.get(["recentTickets", "ticketSummaries"]);
  let recentTickets = stored.recentTickets || [];

  // Remove if already exists, then add to front
  recentTickets = recentTickets.filter(k => k !== ticketKey);
  recentTickets.unshift(ticketKey);

  // Keep only last 50
  recentTickets = recentTickets.slice(0, 50);

  // Cache the summary so the dropdown can label recents (keys carry no title)
  const ticketSummaries = stored.ticketSummaries || {};
  if (summary) ticketSummaries[ticketKey] = summary;

  await browser.storage.local.set({ recentTickets, ticketSummaries });
}

function extractCommentText(comment) {
  if (!comment) return "";
  if (typeof comment === "string") return comment;

  // Handle Atlassian Document Format
  if (comment.content) {
    let text = "";
    for (const block of comment.content) {
      if (block.content) {
        for (const item of block.content) {
          if (item.text) text += item.text;
        }
      }
    }
    return text;
  }
  return "";
}

async function searchTickets() {
  // Prevent concurrent searches
  if (isSearching) return;

  const query = sanitizeString(elements.ticketSearch.value.trim(), MAX_SEARCH_LENGTH);
  if (!query) return;

  // Whitelist validation - only allow safe characters in JQL queries
  if (!/^[a-zA-Z0-9\s\-_.,()]+$/.test(query)) {
    showStatus("Invalid characters in search", "error");
    return;
  }

  const domain = await getJiraDomain();

  if (!domain) {
    showStatus("Please login first", "error");
    return;
  }

  isSearching = true;
  elements.searchBtn.disabled = true;
  elements.searchResults.innerHTML = '<div class="loading">Searching...</div>';

  try {
    const isTicketKey = /^[A-Z]+-\d+$/i.test(query);

    if (isTicketKey) {
      const response = await jiraFetch(
        `https://${domain}/rest/api/3/issue/${query.toUpperCase()}?fields=key,summary`
      );

      if (response.ok) {
        const issue = await response.json();
        displaySearchResults([{
          key: issue.key,
          fields: { summary: issue.fields.summary }
        }]);
      } else if (response.status === 404) {
        elements.searchResults.innerHTML = '<div class="no-results">Ticket not found</div>';
      } else {
        throw new Error(`${response.status}: Could not fetch ticket`);
      }
    } else {
      let response = await jiraFetch(
        `https://${domain}/rest/api/3/issue/picker?query=${encodeURIComponent(query)}&currentJQL=&showSubTasks=true`
      );

      if (response.ok) {
        const result = await response.json();
        const issues = [];
        for (const section of result.sections || []) {
          for (const issue of section.issues || []) {
            issues.push({
              key: issue.key,
              fields: { summary: issue.summaryText || issue.summary || "" }
            });
          }
        }
        displaySearchResults(issues);
      } else {
        const jql = `summary ~ "${query}" OR text ~ "${query}" ORDER BY updated DESC`;
        response = await jiraFetch(
          `https://${domain}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=10&fields=key,summary`
        );

        if (response.status === 410) {
          response = await jiraFetch(
            `https://${domain}/rest/api/3/search/jql`,
            {
              method: "POST",
              body: JSON.stringify({
                jql: jql,
                maxResults: 10,
                fields: ["key", "summary"]
              })
            }
          );
        }

        if (!response.ok) {
          throw new Error(`${response.status}: Search failed`);
        }

        const result = await response.json();
        displaySearchResults(result.issues || []);
      }
    }
  } catch (err) {
    elements.searchResults.innerHTML = "";
    showStatus(`Search error: ${sanitizeString(err.message, 100)}`, "error");
  } finally {
    isSearching = false;
    elements.searchBtn.disabled = false;
  }
}

function displaySearchResults(issues) {
  if (issues.length === 0) {
    elements.searchResults.innerHTML = '<div class="no-results">No tickets found</div>';
    return;
  }

  elements.searchResults.innerHTML = issues
    .map(
      (issue) => {
        const key = issue.key || "";
        const summary = issue.fields?.summary || "";
        // Escape for HTML content display
        const keyHtml = escapeHtml(key);
        const summaryHtml = escapeHtml(summary);
        // Escape for data attribute (different escaping)
        const keyAttr = key.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        const summaryAttr = summary.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        return `
      <div class="search-result-item" data-key="${keyAttr}" data-summary="${summaryAttr}">
        <div class="ticket-key">${keyHtml}</div>
        <div class="ticket-summary">${summaryHtml}</div>
      </div>
    `;
      }
    )
    .join("");

  elements.searchResults.querySelectorAll(".search-result-item").forEach((item) => {
    item.addEventListener("click", () => {
      selectTicket(item.dataset.key, item.dataset.summary);
    });
  });
}

function escapeHtml(text) {
  if (text == null) return "";
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

function selectTicket(key, summary) {
  selectedTicket = { key, summary };
  elements.selectedTicketKey.textContent = key;
  elements.selectedTicketSummary.textContent = summary;
  elements.worklogSection.style.display = "block";
  elements.searchResults.innerHTML = "";
  elements.ticketSearch.value = "";

  // Reflect selection on the dropdown button and close the menu
  setTicketDropdownLabel(key, summary);
  closeTicketDropdown();

  // Update pin button state
  updatePinButtonState(key);

  // Set smart start time based on existing worklogs
  setSmartStartTime();
  // Sync both duration inputs and badge display
  syncDurationInputsFromEndTime();
  updateDurationBadgeDisplay();
  saveRecentTicket(key, summary);
  browser.storage.local.set({ lastTicket: { key, summary } });
}

function setTicketDropdownLabel(key, summary) {
  elements.ticketDropdownLabel.textContent = summary ? `${key} · ${summary}` : key;
  elements.ticketDropdownLabel.classList.add("has-selection");
}

function toggleTicketDropdown() {
  if (elements.ticketDropdownMenu.style.display === "none") {
    openTicketDropdown();
  } else {
    closeTicketDropdown();
  }
}

function openTicketDropdown() {
  elements.ticketDropdownMenu.style.display = "block";
  elements.ticketDropdownBtn.classList.add("open");
  renderTicketDropdown();
}

function closeTicketDropdown() {
  elements.ticketDropdownMenu.style.display = "none";
  elements.ticketDropdownBtn.classList.remove("open");
}

// Merge pinned tickets (objects) with recent keys (labelled from the summary
// cache), pinned first, deduped. This is the dropdown's data source.
async function getMergedTickets() {
  const pinned = await getPinnedTickets();
  const stored = await browser.storage.local.get(["recentTickets", "ticketSummaries"]);
  const recentKeys = stored.recentTickets || [];
  const summaries = stored.ticketSummaries || {};
  const pinnedKeys = new Set(pinned.map(t => t.key));

  const list = pinned.map(t => ({
    key: t.key,
    summary: t.summary || summaries[t.key] || "",
    pinned: true
  }));
  for (const key of recentKeys) {
    if (pinnedKeys.has(key)) continue;
    list.push({ key, summary: summaries[key] || "", pinned: false });
  }
  return list;
}

async function renderTicketDropdown() {
  const tickets = await getMergedTickets();

  if (tickets.length === 0) {
    elements.ticketDropdownList.innerHTML =
      '<div class="ticket-dropdown-empty">No recent tickets yet — search below</div>';
    return;
  }

  elements.ticketDropdownList.innerHTML = tickets.map(t => {
    const keyAttr = t.key.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const summaryAttr = (t.summary || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const isSel = selectedTicket && selectedTicket.key === t.key ? " selected" : "";
    const summaryHtml = t.summary
      ? escapeHtml(t.summary)
      : '<span class="ticket-option-nosummary">No description</span>';
    return `
      <div class="ticket-option${isSel}" data-key="${keyAttr}" data-summary="${summaryAttr}">
        <span class="ticket-option-key">${escapeHtml(t.key)}</span>
        <span class="ticket-option-summary">${summaryHtml}</span>
        ${t.pinned ? '<span class="ticket-option-pin" title="Pinned">&#9733;</span>' : ""}
      </div>`;
  }).join("");

  elements.ticketDropdownList.querySelectorAll(".ticket-option").forEach(opt => {
    opt.addEventListener("click", () => {
      selectTicket(opt.dataset.key, opt.dataset.summary);
    });
  });
}

// Pre-select the top ticket on open so the common case is "type desc → log".
async function autoSelectDefaultTicket() {
  if (selectedTicket) return;
  const tickets = await getMergedTickets();
  if (tickets.length === 0) return;
  const top = tickets[0];
  selectTicket(top.key, top.summary);
  elements.worklogDesc.focus();
}

// Calculate smart start time based on existing worklogs
function setSmartStartTime() {
  let startMinutes = 9 * 60; // Default 9:00 AM

  // If there are worklogs for this date, use the end time of the last one
  if (loggedWorklogs.length > 0) {
    // Find the latest worklog end time
    let latestEndMinutes = 0;

    for (const log of loggedWorklogs) {
      if (log.started) {
        // Parse the start time from worklog
        const timePart = log.started.split("T")[1];
        if (timePart) {
          const [h, m] = timePart.split(":").map(Number);
          const logStartMinutes = h * 60 + m;
          const logEndMinutes = logStartMinutes + (log.minutes || 0);

          if (logEndMinutes > latestEndMinutes) {
            latestEndMinutes = logEndMinutes;
          }
        }
      }
    }

    if (latestEndMinutes > 0) {
      startMinutes = latestEndMinutes;
    }
  }

  // Skip lunch break (12:00-13:00) for convenience only
  // User can still manually set times during lunch if needed
  startMinutes = skipLunchBreakForConvenience(startMinutes);

  // Cap at reasonable work hours (before midnight)
  startMinutes = Math.min(startMinutes, 23 * 60);

  // Format and set the start time
  const startH = Math.floor(startMinutes / 60);
  const startM = startMinutes % 60;
  elements.startTime.value = `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`;

  // Calculate default end time
  updateDefaultEndTime(startMinutes);
}

// Skip lunch break for convenience when auto-calculating start time
// This does NOT prevent logging during lunch - user can always adjust manually
function skipLunchBreakForConvenience(minutes) {
  // If time falls within lunch break, move to end of lunch
  if (minutes >= LUNCH_START && minutes < LUNCH_END) {
    return LUNCH_END;
  }
  return minutes;
}

// Update end time based on start time
// Sets end time to lunch break start (12:00) or work end time (18:00)
function updateDefaultEndTime(startMinutes) {
  let endMinutes;

  if (startMinutes < LUNCH_START) {
    // Morning: end at lunch break start (12:00)
    endMinutes = LUNCH_START;
  } else {
    // Afternoon: end at work end time (18:00)
    endMinutes = WORK_END;
  }

  // Make sure end is after start
  if (endMinutes <= startMinutes) {
    // Default to 1 hour if end would be before or same as start
    endMinutes = startMinutes + 60;
  }

  // Cap at end of day (23:59)
  endMinutes = Math.min(endMinutes, 23 * 60 + 59);

  const endH = Math.floor(endMinutes / 60);
  const endM = endMinutes % 60;
  elements.endTime.value = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;

  // Sync duration inputs - this is the actual duration (end - start)
  const duration = endMinutes - startMinutes;
  if (duration > 0) {
    elements.durationHours.value = Math.floor(duration / 60);
    elements.durationMinutes.value = duration % 60;
  }
}

function clearSelectedTicket() {
  selectedTicket = null;
  editingWorklog = null;
  elements.worklogSection.style.display = "none";
  elements.worklogDesc.value = "";
  elements.submitWorklog.textContent = "Log Work";
  // Reset pin button
  elements.pinTicket.innerHTML = "&#9744;";
  elements.pinTicket.classList.remove("pinned");
  // Reset dropdown label
  elements.ticketDropdownLabel.textContent = "Select a ticket…";
  elements.ticketDropdownLabel.classList.remove("has-selection");
  // An explicit clear means "don't re-pick this for me" — otherwise memory
  // mode would just re-select the same ticket next time the popup opens.
  browser.storage.local.remove(["lastTicket"]);
}

async function submitWorklog() {
  // Prevent concurrent submissions
  if (isSubmitting) return;

  if (!selectedTicket || !isValidTicketKey(selectedTicket.key)) {
    showStatus("Please select a valid ticket first", "error");
    return;
  }

  const start = elements.startTime.value;
  const date = elements.workDate.value;
  const description = sanitizeString(elements.worklogDesc.value.trim(), MAX_DESCRIPTION_LENGTH);

  // Validate date and time formats
  if (!isValidDate(date)) {
    showStatus("Invalid date format", "error");
    return;
  }

  if (!isValidTime(start)) {
    showStatus("Invalid start time format", "error");
    return;
  }

  // Calculate duration based on input mode
  let durationMinutes;

  if (inputMode === "duration") {
    // Use duration inputs directly
    const hours = parseInt(elements.durationHours.value) || 0;
    const mins = parseInt(elements.durationMinutes.value) || 0;
    durationMinutes = hours * 60 + mins;
  } else {
    // Use end time calculation
    const end = elements.endTime.value;
    if (!isValidTime(end)) {
      showStatus("Invalid end time format", "error");
      return;
    }

    const [startH, startM] = start.split(":").map(Number);
    const [endH, endM] = end.split(":").map(Number);

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    durationMinutes = endMinutes - startMinutes;
  }

  if (durationMinutes <= 0) {
    showStatus("Duration must be greater than 0", "error");
    return;
  }

  // Sanity check - no worklog over 24 hours
  if (durationMinutes > MAX_WORKLOG_HOURS * 60) {
    showStatus(`Worklog cannot exceed ${MAX_WORKLOG_HOURS} hours`, "error");
    return;
  }

  // Apply wiggle: jitter the start later AND pull the end in, so both the
  // start time and the duration drift off round numbers (looks hand-entered).
  //   logged span = (end - wiggleEnd) - (start + wiggleStart)
  // Each entry loses 0..2*wiggle minutes, so the day undershoots the target by
  // a bounded amount — worst case total = target - 2*wiggle*entries. This
  // undershoot is intentional (accepted margin) and predictable by design.
  let startForLog = start;
  if (wiggleEnabled && durationMinutes > 0) {
    const wiggleStart = Math.floor(Math.random() * (wiggleMaxMinutes + 1));
    const wiggleEnd = Math.floor(Math.random() * (wiggleMaxMinutes + 1));
    const [sh, sm] = start.split(":").map(Number);
    const shifted = sh * 60 + sm + wiggleStart;
    const nh = Math.floor(shifted / 60) % 24;
    const nm = shifted % 60;
    startForLog = `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
    durationMinutes = Math.max(1, durationMinutes - wiggleStart - wiggleEnd);
  }

  const domain = await getJiraDomain();

  if (!domain) {
    showStatus("Please login first", "error");
    return;
  }

  // Disable button and show full-screen loading
  isSubmitting = true;
  elements.submitWorklog.disabled = true;
  elements.submitWorklog.textContent = "Logging...";
  showLoading("Logging...");

  // Create proper ISO 8601 timestamp with user's local timezone
  // Jira expects format like: 2024-01-14T09:00:00.000+0800
  const localDate = new Date(`${date}T${startForLog}:00`);
  const tzOffset = -localDate.getTimezoneOffset();
  const tzHours = Math.floor(Math.abs(tzOffset) / 60).toString().padStart(2, "0");
  const tzMinutes = (Math.abs(tzOffset) % 60).toString().padStart(2, "0");
  const tzSign = tzOffset >= 0 ? "+" : "-";
  const started = `${date}T${startForLog}:00.000${tzSign}${tzHours}${tzMinutes}`;

  const payload = {
    timeSpentSeconds: durationMinutes * 60,
    started: started
  };

  if (description) {
    payload.comment = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: description
            }
          ]
        }
      ]
    };
  }

  try {
    let url;
    let method;

    if (editingWorklog) {
      // Update existing worklog: PUT to the original ticket's worklog
      url = `https://${domain}/rest/api/3/issue/${editingWorklog.ticketKey}/worklog/${editingWorklog.id}`;
      method = "PUT";
    } else {
      // Create new worklog
      url = `https://${domain}/rest/api/3/issue/${selectedTicket.key}/worklog`;
      method = "POST";
    }

    const response = await jiraFetch(url, {
      method: method,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      const responseText = await response.text();
      try {
        const error = JSON.parse(responseText);
        errorMsg = error.errorMessages?.[0] || error.errors?.started || error.message || responseText;
      } catch (e) {
        errorMsg = responseText || errorMsg;
      }
      throw new Error(errorMsg);
    }

    const isEditing = !!editingWorklog;
    editingWorklog = null;
    elements.submitWorklog.textContent = "Log Work";
    await markJiraMutated();

    // Calculate new remaining before deciding to advance
    const newLoggedMinutes = loggedMinutesToday + (isEditing ? 0 : durationMinutes);
    const targetMinutes = dailyHoursTarget * 60;
    const newRemaining = targetMinutes - newLoggedMinutes;
    // Count this new entry toward the wiggle tolerance so the day can register
    // as done within the accepted margin (otherwise wiggle never reaches 0).
    const advanceTolerance = targetToleranceMinutes(loggedWorklogs.length + (isEditing ? 0 : 1));

    showStatus(`${isEditing ? "Updated" : "Logged"} ${formatMinutes(durationMinutes)} to ${selectedTicket.key}`, "success");

    // Clear description but keep ticket selected for consecutive logs
    elements.worklogDesc.value = "";

    // Check if we should auto-advance to next workday
    if (elements.autoAdvance.checked && newRemaining <= advanceTolerance) {
      // Advance to next workday
      const current = new Date(date);
      current.setDate(current.getDate() + 1);
      while (isWeekend(current)) {
        current.setDate(current.getDate() + 1);
      }
      const nextDate = current.toISOString().split("T")[0];
      elements.workDate.value = nextDate;
      updateDateLabel();

      // Reset start time to default for new day
      elements.startTime.value = DEFAULT_START_TIME;
      updateDefaultEndTime(9 * 60); // 09:00
      syncDurationInputsFromEndTime();
      updateDurationBadgeDisplay();

      // Load worklogs for the new date
      scheduleWorklogLoad(nextDate, true);
    } else {
      // Update start time to the end time for quick consecutive logging
      const prevEnd = elements.endTime.value;
      const [endH, endM] = prevEnd.split(":").map(Number);
      let newStartMinutes = endH * 60 + endM;

      // Skip lunch break (12:00-13:00) for convenience
      newStartMinutes = skipLunchBreakForConvenience(newStartMinutes);

      // Format and set the new start time
      const startH = Math.floor(newStartMinutes / 60);
      const startM = newStartMinutes % 60;
      elements.startTime.value = `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`;

      // Update end time based on new start (uses smart defaults)
      updateDefaultEndTime(newStartMinutes);

      // Sync duration display
      syncDurationInputsFromEndTime();
      updateDurationBadgeDisplay();

      // Reload worklogs for the selected date to reflect actual logged time (force refresh to update cache)
      scheduleWorklogLoad(date, true);
    }
  } catch (err) {
    showStatus(`Error: ${sanitizeString(err.message, 100)}`, "error");
  } finally {
    // Re-enable button
    isSubmitting = false;
    editingWorklog = null;
    elements.submitWorklog.disabled = false;
    elements.submitWorklog.textContent = "Log Work";
  }
}

function showLoading(message = "Logging...") {
  // Clear any existing timeout
  if (statusTimeout) {
    clearTimeout(statusTimeout);
    statusTimeout = null;
  }

  elements.statusMessage.className = "status-message loading";
  elements.statusMessage.textContent = sanitizeString(message, 200);

  // Trigger reflow to ensure transition works
  elements.statusMessage.offsetHeight;

  // Add show class to fade in
  elements.statusMessage.classList.add("show");
}

function showStatus(message, type) {
  // Clear any existing timeout
  if (statusTimeout) {
    clearTimeout(statusTimeout);
    statusTimeout = null;
  }

  if (type === "error") {
    // Error: show modal with OK button that user must dismiss
    elements.statusMessage.className = "status-message error";
    elements.statusMessage.innerHTML = `
      <div class="error-content">${escapeHtml(sanitizeString(message, 500))}</div>
      <button class="error-dismiss">OK</button>
    `;
    elements.statusMessage.offsetHeight;
    elements.statusMessage.classList.add("show");
    elements.statusMessage.querySelector(".error-dismiss").addEventListener("click", dismissStatus);
  } else if (type === "success") {
    // Success: transition from loading gray to green, then auto-dismiss
    elements.statusMessage.textContent = sanitizeString(message, 200);
    elements.statusMessage.className = "status-message success show";

    statusTimeout = setTimeout(() => {
      elements.statusMessage.classList.remove("show");
      setTimeout(() => {
        elements.statusMessage.textContent = "";
        elements.statusMessage.className = "status-message";
      }, 300);
      statusTimeout = null;
    }, 700);
  } else {
    // Info: simple flash
    elements.statusMessage.className = "status-message info";
    elements.statusMessage.textContent = sanitizeString(message, 200);
    elements.statusMessage.offsetHeight;
    elements.statusMessage.classList.add("show");

    statusTimeout = setTimeout(() => {
      elements.statusMessage.classList.remove("show");
      setTimeout(() => {
        elements.statusMessage.textContent = "";
        elements.statusMessage.className = "status-message";
      }, 300);
      statusTimeout = null;
    }, 700);
  }
}

function dismissStatus() {
  elements.statusMessage.classList.remove("show");
  setTimeout(() => {
    elements.statusMessage.innerHTML = "";
    elements.statusMessage.className = "status-message";
  }, 100);
}

// ===== Pinned Tickets =====

const MAX_PINNED_TICKETS = 10;

async function getPinnedTickets() {
  const data = await browser.storage.local.get(["pinnedTickets"]);
  return data.pinnedTickets || [];
}

async function savePinnedTickets(tickets) {
  await browser.storage.local.set({ pinnedTickets: tickets });
}

async function isTicketPinned(key) {
  const pinned = await getPinnedTickets();
  return pinned.some(t => t.key === key);
}

async function updatePinButtonState(key) {
  const pinned = await isTicketPinned(key);
  if (pinned) {
    elements.pinTicket.innerHTML = "&#9746;";
    elements.pinTicket.classList.add("pinned");
    elements.pinTicket.title = "Unpin this ticket";
  } else {
    elements.pinTicket.innerHTML = "&#9744;";
    elements.pinTicket.classList.remove("pinned");
    elements.pinTicket.title = "Pin this ticket";
  }
}

async function togglePinTicket() {
  if (!selectedTicket) return;

  const pinned = await getPinnedTickets();
  const idx = pinned.findIndex(t => t.key === selectedTicket.key);

  if (idx >= 0) {
    // Unpin
    pinned.splice(idx, 1);
  } else {
    // Pin - add to front
    if (pinned.length >= MAX_PINNED_TICKETS) {
      pinned.pop(); // Remove oldest
    }
    pinned.unshift({ key: selectedTicket.key, summary: selectedTicket.summary });
  }

  await savePinnedTickets(pinned);
  updatePinButtonState(selectedTicket.key);
  renderTicketDropdown();
}

async function unpinTicket(key) {
  const pinned = await getPinnedTickets();
  const filtered = pinned.filter(t => t.key !== key);
  await savePinnedTickets(filtered);
  renderTicketDropdown();

  // Update pin button if this ticket is currently selected
  if (selectedTicket && selectedTicket.key === key) {
    updatePinButtonState(key);
  }
}

// ===== Worklog Actions (Edit/Delete) =====

function toggleWorklogActions(index, entryElement) {
  // If already expanded, collapse it
  const existingBar = entryElement.nextElementSibling;
  if (existingBar && existingBar.classList.contains("worklog-actions-bar")) {
    existingBar.remove();
    entryElement.classList.remove("expanded");
    return;
  }

  // Collapse any other expanded entry
  const prevExpanded = elements.worklogList.querySelector(".worklog-entry.expanded");
  if (prevExpanded) {
    const prevBar = prevExpanded.nextElementSibling;
    if (prevBar && prevBar.classList.contains("worklog-actions-bar")) prevBar.remove();
    prevExpanded.classList.remove("expanded");
  }

  const log = loggedWorklogs[index];
  if (!log) return;

  entryElement.classList.add("expanded");

  const bar = document.createElement("div");
  bar.className = "worklog-actions-bar";
  bar.innerHTML = `
    <button class="worklog-action-btn action-edit">Edit</button>
    <button class="worklog-action-btn action-delete">Delete</button>
  `;

  entryElement.after(bar);

  bar.querySelector(".action-edit").addEventListener("click", (e) => {
    e.stopPropagation();
    loadWorklogForEdit(index);
    bar.remove();
    entryElement.classList.remove("expanded");
  });

  bar.querySelector(".action-delete").addEventListener("click", (e) => {
    e.stopPropagation();
    deleteWorklog(index);
    bar.remove();
    entryElement.classList.remove("expanded");
  });
}

function loadWorklogForEdit(index) {
  const log = loggedWorklogs[index];
  if (!log) return;

  // Select the ticket
  selectTicket(log.ticketKey, "");

  // Set the start time from the worklog
  if (log.started) {
    elements.startTime.value = log.started.substring(11, 16);
  }

  // Calculate end time from start + duration
  if (log.started && log.minutes) {
    const [h, m] = log.started.substring(11, 16).split(":").map(Number);
    const endMinutes = h * 60 + m + log.minutes;
    const endH = Math.floor(endMinutes / 60);
    const endM = endMinutes % 60;
    elements.endTime.value = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
  }

  // Set description
  elements.worklogDesc.value = log.comment || "";

  // Sync duration display
  syncDurationInputsFromEndTime();
  updateDurationBadgeDisplay();

  // Store the editing worklog info so we can delete the old one on submit
  editingWorklog = { ticketKey: log.ticketKey, id: log.id };

  // Change button text to indicate editing
  elements.submitWorklog.textContent = "Update Work";
}

async function deleteWorklog(index) {
  const log = loggedWorklogs[index];
  if (!log || !log.id || !log.ticketKey) {
    showStatus("Cannot delete: missing worklog info", "error");
    return;
  }

  const domain = await getJiraDomain();
  if (!domain) return;

  showStatus("Deleting...", "loading");

  try {
    const response = await jiraFetch(
      `https://${domain}/rest/api/3/issue/${log.ticketKey}/worklog/${log.id}`,
      { method: "DELETE" }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    await markJiraMutated();
    showStatus(`Deleted worklog from ${log.ticketKey}`, "success");

    // Refresh worklogs
    scheduleWorklogLoad(elements.workDate.value, true);
  } catch (err) {
    showStatus(`Delete failed: ${sanitizeString(err.message, 100)}`, "error");
  }
}

// ===== Preset Descriptions =====

const MAX_PRESETS = 10;

async function getDescriptionPresets() {
  const data = await browser.storage.local.get(["descPresets"]);
  return data.descPresets || [];
}

async function saveDescriptionPresets(presets) {
  await browser.storage.local.set({ descPresets: presets });
}

async function saveDescriptionPreset() {
  const desc = elements.worklogDesc.value.trim();
  if (!desc) {
    showStatus("Enter a description first", "error");
    return;
  }

  const presets = await getDescriptionPresets();

  // Don't add duplicates
  if (presets.includes(desc)) {
    showStatus("Preset already exists", "info");
    return;
  }

  // Add to front, limit to MAX_PRESETS
  presets.unshift(desc);
  if (presets.length > MAX_PRESETS) presets.pop();

  await saveDescriptionPresets(presets);
  renderDescriptionPresets();

  // Visual feedback on save button
  const btn = elements.saveDescPreset;
  btn.textContent = "Saved!";
  btn.classList.add("saved");
  setTimeout(() => {
    btn.textContent = "+ Save as preset";
    btn.classList.remove("saved");
  }, 1500);
}

async function removeDescriptionPreset(index) {
  const presets = await getDescriptionPresets();
  presets.splice(index, 1);
  await saveDescriptionPresets(presets);
  renderDescriptionPresets();
}

async function editDescriptionPreset(index) {
  const presets = await getDescriptionPresets();
  const chip = elements.presetDescriptions.querySelector(`.preset-chip[data-index="${index}"]`);
  if (!chip || !presets[index]) return;

  // Switch chip to edit mode
  chip.classList.add("editing");
  chip.innerHTML = `
    <input type="text" class="preset-edit-input" value="${escapeHtml(presets[index])}" maxlength="200">
    <span class="preset-actions" style="opacity:1;max-width:50px;">
      <button class="preset-action-btn preset-save-edit" title="Save">&#10003;</button>
      <button class="preset-action-btn preset-cancel-edit" title="Cancel">&#10005;</button>
    </span>
  `;

  const input = chip.querySelector(".preset-edit-input");
  input.focus();
  input.select();

  const saveEdit = async () => {
    const newValue = input.value.trim();
    if (newValue && newValue !== presets[index]) {
      // Check for duplicates
      if (presets.includes(newValue)) {
        input.style.borderBottom = "2px solid #ff8f7a";
        return;
      }
      presets[index] = newValue;
      await saveDescriptionPresets(presets);
    }
    renderDescriptionPresets();
  };

  chip.querySelector(".preset-save-edit").addEventListener("click", (e) => {
    e.stopPropagation();
    saveEdit();
  });

  chip.querySelector(".preset-cancel-edit").addEventListener("click", (e) => {
    e.stopPropagation();
    renderDescriptionPresets();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      renderDescriptionPresets();
    }
  });

  input.addEventListener("click", (e) => e.stopPropagation());
}

function requestDeletePreset(index, chipElement) {
  // If already confirming, ignore
  if (chipElement.classList.contains("confirm-delete")) return;

  chipElement.classList.add("confirm-delete");

  const actionsEl = chipElement.querySelector(".preset-actions");
  actionsEl.innerHTML = `
    <span class="preset-confirm-btns">
      <button class="preset-confirm-btn confirm-yes" title="Confirm delete">Del</button>
      <button class="preset-confirm-btn confirm-no" title="Cancel">No</button>
    </span>
  `;

  const textEl = chipElement.querySelector(".preset-text");
  textEl.textContent = "Delete?";

  actionsEl.querySelector(".confirm-yes").addEventListener("click", (e) => {
    e.stopPropagation();
    removeDescriptionPreset(index);
  });

  actionsEl.querySelector(".confirm-no").addEventListener("click", (e) => {
    e.stopPropagation();
    renderDescriptionPresets();
  });

  // Auto-cancel after 3 seconds
  setTimeout(() => {
    if (chipElement.classList.contains("confirm-delete")) {
      renderDescriptionPresets();
    }
  }, 3000);
}

async function renderDescriptionPresets() {
  const presets = await getDescriptionPresets();

  if (presets.length === 0) {
    elements.presetDescriptions.innerHTML = "";
    return;
  }

  elements.presetDescriptions.innerHTML = presets
    .map((desc, i) => {
      const displayText = desc.length > 25 ? desc.slice(0, 25) + "\u2026" : desc;
      const textHtml = escapeHtml(displayText);
      const fullHtml = escapeHtml(desc);
      return `
        <span class="preset-chip" data-index="${i}" title="${fullHtml}">
          <span class="preset-text">${textHtml}</span>
          <span class="preset-actions">
            <button class="preset-action-btn preset-edit-btn" title="Edit">\u270E</button>
            <button class="preset-action-btn preset-delete-btn" title="Delete">\u00D7</button>
          </span>
        </span>
      `;
    })
    .join("");

  // Click preset to fill description
  elements.presetDescriptions.querySelectorAll(".preset-chip").forEach(chip => {
    chip.addEventListener("click", async (e) => {
      if (e.target.closest(".preset-action-btn")) return;
      if (chip.classList.contains("editing") || chip.classList.contains("confirm-delete")) return;
      const presets = await getDescriptionPresets();
      const idx = parseInt(chip.dataset.index);
      if (presets[idx]) {
        elements.worklogDesc.value = presets[idx];
        // Brief highlight to confirm selection
        chip.style.background = "rgba(87, 226, 176, 0.18)";
        chip.style.borderColor = "#57e2b0";
        setTimeout(() => {
          chip.style.background = "";
          chip.style.borderColor = "";
        }, 400);
      }
    });
  });

  // Edit buttons
  elements.presetDescriptions.querySelectorAll(".preset-edit-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const chip = btn.closest(".preset-chip");
      editDescriptionPreset(parseInt(chip.dataset.index));
    });
  });

  // Delete buttons
  elements.presetDescriptions.querySelectorAll(".preset-delete-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const chip = btn.closest(".preset-chip");
      requestDeletePreset(parseInt(chip.dataset.index), chip);
    });
  });
}

// ===== Last Unlogged Day =====

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

// Standalone worklog fetcher - does NOT use currentRequestId so it won't be
// cancelled by concurrent scheduleWorklogLoad/refresh calls
async function getLoggedMinutesForDate(dateStr, accountId, domain) {
  // Check cache first
  const cached = await getCachedWorklogs(dateStr);
  if (cached) return cached.totalMinutes;

  // Query Jira directly (no currentRequestId dependency)
  try {
    let ticketKeys = [];

    // Try JQL search for worklogs on this date
    try {
      const jql = `worklogDate = "${dateStr}" AND worklogAuthor = currentUser()`;
      const searchResponse = await jiraSearchIssues(domain, jql, ["key"], 50);
      if (searchResponse.ok) {
        const searchResult = await searchResponse.json();
        ticketKeys = (searchResult.issues || []).map(iss => iss.key);
      }
    } catch (e) {
      // JQL search failed, continue with recent tickets
    }

    // Also include recent tickets (same as loadWorklogsForDate)
    const stored = await browser.storage.local.get(["recentTickets"]);
    const recentTickets = stored.recentTickets || [];
    ticketKeys = [...new Set([...ticketKeys, ...recentTickets])];

    if (ticketKeys.length === 0) return 0;

    // Fetch worklogs directly without fetchWorklogsForDate (avoids currentRequestId race)
    let totalSeconds = 0;
    const worklogs = [];

    for (const ticketKey of ticketKeys.slice(0, 30)) {
      try {
        const response = await jiraFetch(
          `https://${domain}/rest/api/3/issue/${ticketKey}/worklog?maxResults=5000`
        );
        if (!response.ok) continue;

        const data = await response.json();
        for (const log of data.worklogs || []) {
          if (log.author?.accountId === accountId && log.started?.startsWith(dateStr)) {
            const minutes = Math.round((log.timeSpentSeconds || 0) / 60);
            totalSeconds += log.timeSpentSeconds || 0;
            worklogs.push({
              id: log.id,
              ticketKey,
              minutes,
              comment: extractCommentText(log.comment),
              started: log.started
            });
          }
        }
      } catch (err) {
        // Skip failed tickets
      }
    }

    const totalMinutes = Math.round(totalSeconds / 60);
    worklogs.sort((a, b) => (a.started || "").localeCompare(b.started || ""));
    await setCachedWorklogs(dateStr, worklogs, totalMinutes);
    return totalMinutes;
  } catch (e) {
    return 0;
  }
}

async function jumpToLastUnloggedDay() {
  const domain = await getJiraDomain();
  if (!domain) {
    showStatus("Please login first", "error");
    return;
  }

  elements.lastUnloggedDay.disabled = true;
  elements.lastUnloggedDay.textContent = "Connecting...";

  try {
    // Get current user
    const meResponse = await jiraFetch(`https://${domain}/rest/api/3/myself`);
    if (!meResponse.ok) {
      showStatus("Failed to get user info", "error");
      return;
    }
    const me = await meResponse.json();
    const accountId = me.accountId;

    // Strategy: search backwards from yesterday, skipping weekends.
    // Track the OLDEST under-logged day (<target). Stop when we hit a
    // fully-logged day (>=target) — that's the boundary.
    // e.g. dates: 6(8h), 9(0h), 10(3h) → oldest under-logged = 9
    const today = new Date();
    let checkDate = new Date(today);
    checkDate.setDate(checkDate.getDate() - 1);
    let oldestUnloggedDate = null;

    for (let i = 0; i < 30; i++) {
      // Skip weekends
      while (isWeekend(checkDate)) {
        checkDate.setDate(checkDate.getDate() - 1);
      }

      const dateStr = checkDate.toISOString().split("T")[0];
      elements.lastUnloggedDay.textContent = `Checking ${dateStr}...`;
      const totalMinutes = await getLoggedMinutesForDate(dateStr, accountId, domain);
      const status = totalMinutes >= dailyHoursTarget * 60 ? "full" : `${formatMinutes(totalMinutes)}`;
      elements.lastUnloggedDay.textContent = `${dateStr}: ${status}`;

      if (totalMinutes < dailyHoursTarget * 60) {
        // Under-logged day — track as candidate, keep searching older days
        oldestUnloggedDate = dateStr;
      } else {
        // Fully-logged day — this is the boundary, stop
        break;
      }

      checkDate.setDate(checkDate.getDate() - 1);
    }

    if (oldestUnloggedDate) {
      elements.workDate.value = oldestUnloggedDate;
      updateDateLabel();
      scheduleWorklogLoad(oldestUnloggedDate);
    } else {
      showStatus("All recent workdays are fully logged", "info");
    }
  } catch (err) {
    showStatus(`Error: ${sanitizeString(err.message, 100)}`, "error");
  } finally {
    elements.lastUnloggedDay.disabled = false;
    elements.lastUnloggedDay.textContent = "Last unlogged day";
  }
}

// ── Overview Mode ─────────────────────────────────────────────────────────────

function showOverviewPage() {
  elements.mainPage.style.display = "none";
  elements.overviewPage.style.display = "block";
  renderMonthCalendar();
  loadMonthOverview(overviewYear, overviewMonth);
}

function showDailyPage(dateStr) {
  elements.overviewPage.style.display = "none";
  elements.mainPage.style.display = "block";
  if (dateStr && typeof dateStr === "string") {
    elements.workDate.value = dateStr;
    updateDateLabel();
    scheduleWorklogLoad(dateStr);
  }
}

function navigateOverviewMonth(delta) {
  overviewMonth += delta;
  if (overviewMonth > 11) { overviewMonth = 0; overviewYear++; }
  if (overviewMonth < 0)  { overviewMonth = 11; overviewYear--; }
  overviewDayStats = {};
  renderMonthCalendar();
  loadMonthOverview(overviewYear, overviewMonth);
}

// A day counts as met once its logged time is within the wiggle margin of the
// target (2*wiggle per entry), matching the daily view's completion tolerance.
function isDayMet(stats) {
  if (!stats || !stats.loaded || stats.minutes <= 0) return false;
  const tol = wiggleEnabled ? 2 * wiggleMaxMinutes * Math.max(1, stats.count || 1) : 0;
  return stats.minutes >= dailyHoursTarget * 60 - tol;
}

function renderMonthCalendar() {
  const today = new Date().toISOString().split("T")[0];
  const monthNames = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];
  elements.overviewMonthLabel.textContent = `${monthNames[overviewMonth]} ${overviewYear}`;

  const numDays = new Date(overviewYear, overviewMonth + 1, 0).getDate();
  const firstDow = new Date(overviewYear, overviewMonth, 1).getDay();
  const startOffset = (firstDow + 6) % 7; // Mon=0 … Sun=6

  let html = "";
  const dowLabels = ["M","T","W","T","F","S","S"];
  for (const d of dowLabels) {
    html += `<div class="overview-dow">${d}</div>`;
  }
  for (let i = 0; i < startOffset; i++) {
    html += `<div class="overview-day overview-day-empty"></div>`;
  }

  let metCount = 0, partialCount = 0, missedCount = 0;
  let totalLoggedMinutes = 0;
  let totalWorkingDays = 0;

  for (let d = 1; d <= numDays; d++) {
    const dateStr = `${overviewYear}-${String(overviewMonth + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const dow = new Date(overviewYear, overviewMonth, d).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isFuture = dateStr > today;
    const isToday = dateStr === today;
    const stats = overviewDayStats[dateStr];

    if (!isWeekend) totalWorkingDays++;
    if (stats && stats.loaded) totalLoggedMinutes += stats.minutes;

    let cls = "overview-day";
    let hoursHtml = "";

    if (isToday) cls += " overview-day-today";
    if (isFuture) {
      cls += " overview-day-future";
      if (isWeekend) cls += " day-weekend";
    } else if (isWeekend) {
      cls += " day-weekend";
    } else if (stats && stats.loaded) {
      if (isDayMet(stats)) {
        cls += " day-met";
        metCount++;
      } else if (stats.minutes > 0) {
        cls += " day-partial";
        partialCount++;
      } else {
        cls += " day-missed";
        missedCount++;
      }
    } else {
      cls += " day-no-data";
    }

    if (stats && stats.loaded) {
      const h = Math.floor(stats.minutes / 60);
      const m = stats.minutes % 60;
      const label = m > 0 ? `${h}h${m}m` : `${h}h`;
      const color = isDayMet(stats)
        ? "#57e2b0"
        : stats.minutes > 0 ? "#ffd166" : "#ff8f7a";
      hoursHtml = `<span class="overview-day-hours" style="color:${color}">${label}</span>`;
    } else if (!isFuture && !isWeekend) {
      hoursHtml = `<span class="overview-day-hours" style="color:rgba(255,255,255,0.4)">?</span>`;
    }

    const dataAttr = !isFuture ? `data-date="${escapeHtml(dateStr)}"` : "";
    html += `<div class="${cls}" ${dataAttr}><span class="overview-day-num">${d}</span>${hoursHtml}</div>`;
  }

  elements.overviewCalendar.innerHTML = html;

  // Click handlers for non-future days
  elements.overviewCalendar.querySelectorAll(".overview-day[data-date]").forEach(cell => {
    cell.addEventListener("click", () => showDailyPage(cell.dataset.date));
  });

  // Total logged vs. target for the whole month (just for fun — not gated on
  // any API call, purely derived from whatever's in overviewDayStats so far)
  if (elements.overviewHoursSummary) {
    const targetMinutes = totalWorkingDays * dailyHoursTarget * 60;
    elements.overviewHoursSummary.innerHTML =
      `<span class="overview-hours-logged">${formatMinutes(totalLoggedMinutes)}</span>` +
      `<span class="overview-hours-sep">/</span>` +
      `<span class="overview-hours-target">${formatMinutes(targetMinutes)} target</span>`;
  }

  // Summary bar
  const totalLoaded = Object.values(overviewDayStats).filter(s => s.loaded).length;
  if (totalLoaded > 0) {
    elements.overviewSummary.innerHTML =
      `<span class="overview-stat"><span class="overview-stat-dot" style="background:#57e2b0"></span>${metCount} met</span>` +
      `<span class="overview-stat"><span class="overview-stat-dot" style="background:#ffd166"></span>${partialCount} partial</span>` +
      `<span class="overview-stat"><span class="overview-stat-dot" style="background:#ff8f7a"></span>${missedCount} missed</span>`;
  } else {
    elements.overviewSummary.innerHTML = "";
  }
}

async function loadMonthOverview(year, month, forceRefresh = false) {
  if (isLoadingOverview) return;
  isLoadingOverview = true;
  elements.overviewReloadBtn.disabled = true;

  const pad = n => String(n).padStart(2, "0");
  const startDate = `${year}-${pad(month + 1)}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const endDate = `${year}-${pad(month + 1)}-${pad(lastDay)}`;
  const today = new Date().toISOString().split("T")[0];
  const monthScope = `month:${year}-${pad(month + 1)}`;

  // Load from cache first — go through the same validated reader the daily
  // view uses (getCachedWorklogs derives the total from the worklogs array
  // itself) instead of trusting the raw cache's stored totalMinutes
  // directly. Reading the raw field here let some cached days silently fail
  // to render (or render with a stale total) whenever it didn't match the
  // array — exactly the class of bug fixed for the daily view previously;
  // this consolidates both views onto the one already-fixed code path.
  const cacheCursor = new Date(startDate);
  const cacheEnd = new Date(endDate);
  while (cacheCursor <= cacheEnd) {
    const cacheDateStr = cacheCursor.toISOString().split("T")[0];
    const cachedDay = await getCachedWorklogs(cacheDateStr);
    if (cachedDay) {
      overviewDayStats[cacheDateStr] = {
        minutes: cachedDay.totalMinutes,
        count: cachedDay.worklogs.length,
        loaded: true
      };
    }
    cacheCursor.setDate(cacheCursor.getDate() + 1);
  }
  renderMonthCalendar();

  // Skip the live fetch (myself + JQL search + one worklog request per
  // ticket) if we already fetched this month within the guard window and
  // nothing has been mutated since. The reload button always sets
  // forceRefresh to bypass this.
  if (!forceRefresh && await isScopeFresh(monthScope)) {
    showOverviewStatus("Cached (up to date, refreshes within 1 min)", "info");
    isLoadingOverview = false;
    elements.overviewReloadBtn.disabled = false;
    return;
  }

  // Fetch from API
  showOverviewStatus("Loading from Jira...", "loading");
  try {
    const domain = await getJiraDomain();
    if (!domain) { showOverviewStatus("Not logged in", "error"); return; }

    const meResp = await jiraFetch(`https://${domain}/rest/api/3/myself`);
    if (!meResp.ok) { showOverviewStatus("Connection failed", "error"); return; }
    const me = await meResp.json();
    const accountId = me.accountId;

    // Single JQL to get all tickets with worklogs this month
    const jql = `worklogDate >= "${startDate}" AND worklogDate <= "${endDate}" AND worklogAuthor = currentUser()`;
    const searchResp = await jiraSearchIssues(domain, jql, ["key"], 100);
    if (!searchResp.ok) { showOverviewStatus("Failed to fetch month data", "error"); return; }

    const searchResult = await searchResp.json();
    const ticketKeys = (searchResult.issues || []).map(i => i.key);

    // Accumulate worklogs per day
    const dayAccum = {}; // { date: { seconds, worklogs[] } }

    for (const ticketKey of ticketKeys) {
      try {
        const resp = await jiraFetch(
          `https://${domain}/rest/api/3/issue/${ticketKey}/worklog?maxResults=5000`
        );
        if (!resp.ok) continue;
        const data = await resp.json();

        for (const log of data.worklogs || []) {
          if (log.author?.accountId !== accountId) continue;
          const logDate = log.started?.split("T")[0];
          if (!logDate || logDate < startDate || logDate > endDate) continue;

          if (!dayAccum[logDate]) dayAccum[logDate] = { seconds: 0, worklogs: [] };
          const minutes = Math.round((log.timeSpentSeconds || 0) / 60);
          dayAccum[logDate].seconds += log.timeSpentSeconds || 0;
          dayAccum[logDate].worklogs.push({
            id: log.id,
            ticketKey,
            minutes,
            comment: extractCommentText(log.comment),
            started: log.started
          });
        }
      } catch (e) {
        // skip failed ticket
      }
    }

    // Write results to overviewDayStats and cache
    for (const [date, { seconds, worklogs }] of Object.entries(dayAccum)) {
      const totalMinutes = Math.round(seconds / 60);
      overviewDayStats[date] = { minutes: totalMinutes, count: worklogs.length, loaded: true };
      const sorted = worklogs.sort((a, b) => (a.started || "").localeCompare(b.started || ""));
      await setCachedWorklogs(date, sorted, totalMinutes);
    }

    // Mark weekdays up to today with no worklogs as 0-minute loaded. This
    // MUST also persist to the worklog cache (setCachedWorklogs), not just
    // overviewDayStats in-memory — otherwise the confirmed-zero knowledge
    // evaporates the moment the popup closes. Next time the fetch guard
    // serves this month from cache (skipping the live fetch entirely), only
    // days that had real worklogs were ever persisted, so every previously
    // zero-filled day reverts to "no data" (?) instead of staying "missed" —
    // exactly the bug where only a couple of real-data days ever show up.
    const cursor = new Date(startDate);
    const endLimit = new Date(Math.min(new Date(endDate), new Date(today)));
    while (cursor <= endLimit) {
      const dateStr = cursor.toISOString().split("T")[0];
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6 && !overviewDayStats[dateStr]) {
        overviewDayStats[dateStr] = { minutes: 0, count: 0, loaded: true };
        await setCachedWorklogs(dateStr, [], 0);
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    await markScopeFetched(monthScope);
    renderMonthCalendar();

    const loggedDays = Object.keys(dayAccum).length;
    showOverviewStatus(
      loggedDays > 0
        ? `${ticketKeys.length} ticket${ticketKeys.length !== 1 ? "s" : ""}, ${loggedDays} day${loggedDays !== 1 ? "s" : ""} logged`
        : "No worklogs found this month",
      "info"
    );
  } catch (err) {
    showOverviewStatus(`Error: ${sanitizeString(err.message, 100)}`, "error");
  } finally {
    isLoadingOverview = false;
    elements.overviewReloadBtn.disabled = false;
  }
}

function showOverviewStatus(message, type) {
  elements.overviewStatus.textContent = message;
  elements.overviewStatus.className = `worklog-load-status ${type}`;
}
