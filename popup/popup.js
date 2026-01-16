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

// DOM Elements
const elements = {};

document.addEventListener("DOMContentLoaded", async () => {
  initElements();
  await loadPopupSize();
  await checkLoginStatus();
});

function initElements() {
  // Pages
  elements.loginPage = document.getElementById("login-page");
  elements.mainPage = document.getElementById("main-page");

  // Login
  elements.jiraDomain = document.getElementById("jira-domain");
  elements.jiraEmail = document.getElementById("jira-email");
  elements.jiraToken = document.getElementById("jira-token");
  elements.loginBtn = document.getElementById("login-btn");
  elements.loginError = document.getElementById("login-error");

  // Main page - Date/Time picker
  elements.logoutBtn = document.getElementById("logout-btn");
  elements.sizeSm = document.getElementById("size-sm");
  elements.sizeMd = document.getElementById("size-md");
  elements.sizeLg = document.getElementById("size-lg");
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

  // Duration/End time toggle
  elements.endTimeContainer = document.getElementById("end-time-container");
  elements.durationInputContainer = document.getElementById("duration-input-container");
  elements.durationHours = document.getElementById("duration-hours");
  elements.durationMinutes = document.getElementById("duration-minutes");
  elements.toggleInputMode = document.getElementById("toggle-input-mode");
  elements.durationLabel = document.getElementById("duration-label");

  // Set default date to today
  elements.workDate.value = new Date().toISOString().split("T")[0];
  updateDateLabel();

  // Set default times
  elements.startTime.value = DEFAULT_START_TIME;
  elements.endTime.value = DEFAULT_END_TIME;

  setupEventListeners();
}

function setupEventListeners() {
  // Login
  elements.loginBtn.addEventListener("click", handleLogin);
  elements.logoutBtn.addEventListener("click", handleLogout);

  // Size buttons
  elements.sizeSm.addEventListener("click", () => setPopupSize("sm"));
  elements.sizeMd.addEventListener("click", () => setPopupSize("md"));
  elements.sizeLg.addEventListener("click", () => setPopupSize("lg"));

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

  // Search
  elements.searchBtn.addEventListener("click", searchTickets);
  elements.ticketSearch.addEventListener("keypress", (e) => {
    if (e.key === "Enter") searchTickets();
  });

  // Worklog
  elements.clearTicket.addEventListener("click", clearSelectedTicket);
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
    "dailyHours"
  ]);

  if (data.jiraDomain && data.jiraEmail && data.jiraToken) {
    // Already logged in, show main page
    dailyHoursTarget = data.dailyHours || 8;
    elements.dailyHours.value = dailyHoursTarget;
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
}

async function setPopupSize(size) {
  // Remove all size classes
  document.body.classList.remove("size-sm", "size-md", "size-lg");

  // Add new size class if not default
  if (size && size !== "default") {
    document.body.classList.add(`size-${size}`);
  }

  // Update button states
  elements.sizeSm.classList.toggle("active", size === "sm");
  elements.sizeMd.classList.toggle("active", size === "md");
  elements.sizeLg.classList.toggle("active", size === "lg");

  // Save preference
  await browser.storage.local.set({ popupSize: size });
}

async function loadPopupSize() {
  const data = await browser.storage.local.get(["popupSize"]);
  const size = data.popupSize || "default";

  if (size && size !== "default") {
    document.body.classList.add(`size-${size}`);
  }

  // Update button states
  if (elements.sizeSm) {
    elements.sizeSm.classList.toggle("active", size === "sm");
    elements.sizeMd.classList.toggle("active", size === "md");
    elements.sizeLg.classList.toggle("active", size === "lg");
  }
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

function updateHoursDisplay() {
  const targetMinutes = dailyHoursTarget * 60;

  elements.loggedHours.textContent = formatMinutes(loggedMinutesToday);

  const remaining = targetMinutes - loggedMinutesToday;
  if (remaining >= 0) {
    elements.remainingHours.textContent = formatMinutes(remaining);
    elements.remainingHours.style.color = "";
  } else {
    // Show overtime as negative/excess
    elements.remainingHours.textContent = `+${formatMinutes(Math.abs(remaining))}`;
    elements.remainingHours.style.color = "#00875a"; // Green for overtime
  }

  // Render worklog list
  if (loggedWorklogs.length === 0) {
    elements.worklogList.innerHTML = "";
  } else {
    elements.worklogList.innerHTML = loggedWorklogs
      .map(
        (log) => `
        <div class="worklog-entry">
          <span class="worklog-ticket">${escapeHtml(log.ticketKey || "")}</span>
          <span class="worklog-comment">${log.comment ? escapeHtml(log.comment) : "-"}</span>
          <span class="worklog-duration">${formatMinutes(log.minutes || 0)}</span>
        </div>
      `
      )
      .join("");
  }
}

function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
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

  // Validate cache integrity
  const calculatedMinutes = cached.worklogs.reduce((sum, log) => sum + (log.minutes || 0), 0);
  if (calculatedMinutes !== cached.totalMinutes) return null;

  return cached;
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

  // Check cache first (unless force refresh)
  // Always refresh for today's date to avoid stale data
  const today = new Date().toISOString().split("T")[0];
  const isToday = date === today;

  if (!forceRefresh && !isToday) {
    const cached = await getCachedWorklogs(date);
    if (cached) {
      if (requestId !== currentRequestId) return;
      loggedMinutesToday = cached.totalMinutes;
      loggedWorklogs = [...cached.worklogs]; // Copy array to avoid reference issues
      updateHoursDisplay();
      showWorklogLoadStatus("From cache (tap to refresh)", "info");
      return;
    }
  }

  if (requestId !== currentRequestId) return;
  showWorklogLoadStatus("Loading...", "loading");

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

    // Get tickets to check - combine JQL search + recent tickets list
    let ticketKeys = [];

    // Try JQL search for worklogs on this date
    try {
      const jql = `worklogDate = "${date}" AND worklogAuthor = currentUser()`;
      const searchResponse = await jiraFetch(
        `https://${domain}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=key`
      );
      if (searchResponse.ok) {
        const searchResult = await searchResponse.json();
        ticketKeys = (searchResult.issues || []).map(i => i.key);
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

    // Fetch worklogs from tickets and filter by date
    const result = await fetchWorklogsForDate(ticketKeys, accountId, date, domain, requestId);

    if (result === null) return; // Request was cancelled

    const { worklogs, totalMinutes } = result;

    // Save to cache
    await setCachedWorklogs(date, worklogs, totalMinutes);

    if (requestId !== currentRequestId) return;

    // Update UI
    loggedWorklogs = worklogs;
    loggedMinutesToday = totalMinutes;
    updateHoursDisplay();

    if (worklogs.length === 0) {
      showWorklogLoadStatus("No worklogs for this date", "info");
    } else {
      hideWorklogLoadStatus();
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

  for (const ticketKey of ticketKeys.slice(0, 30)) {
    if (requestId !== currentRequestId) return null;

    try {
      const response = await jiraFetch(
        `https://${domain}/rest/api/3/issue/${ticketKey}/worklog`
      );

      if (!response.ok) continue;

      const data = await response.json();

      for (const log of data.worklogs || []) {
        // Only include worklogs by current user on the selected date
        if (log.author?.accountId === accountId && log.started?.startsWith(date)) {
          const minutes = Math.round((log.timeSpentSeconds || 0) / 60);
          totalSeconds += log.timeSpentSeconds || 0;
          worklogs.push({
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
async function saveRecentTicket(ticketKey) {
  const stored = await browser.storage.local.get(["recentTickets"]);
  let recentTickets = stored.recentTickets || [];

  // Remove if already exists, then add to front
  recentTickets = recentTickets.filter(k => k !== ticketKey);
  recentTickets.unshift(ticketKey);

  // Keep only last 50
  recentTickets = recentTickets.slice(0, 50);

  await browser.storage.local.set({ recentTickets });
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

  // Basic query validation - prevent injection
  if (/[<>{}]/.test(query)) {
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

  // Set smart start time based on existing worklogs
  setSmartStartTime();
  // Sync both duration inputs and badge display
  syncDurationInputsFromEndTime();
  updateDurationBadgeDisplay();
  saveRecentTicket(key);
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
  elements.worklogSection.style.display = "none";
  elements.worklogDesc.value = "";
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
  const localDate = new Date(`${date}T${start}:00`);
  const tzOffset = -localDate.getTimezoneOffset();
  const tzHours = Math.floor(Math.abs(tzOffset) / 60).toString().padStart(2, "0");
  const tzMinutes = (Math.abs(tzOffset) % 60).toString().padStart(2, "0");
  const tzSign = tzOffset >= 0 ? "+" : "-";
  const started = `${date}T${start}:00.000${tzSign}${tzHours}${tzMinutes}`;

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
    const response = await jiraFetch(
      `https://${domain}/rest/api/3/issue/${selectedTicket.key}/worklog`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    );

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

    showStatus(`Logged ${formatMinutes(durationMinutes)} to ${selectedTicket.key}`, "success");

    // Clear description but keep ticket selected for consecutive logs
    elements.worklogDesc.value = "";

    // Update start time to the end time for quick consecutive logging
    const prevEnd = elements.endTime.value;
    elements.startTime.value = prevEnd;

    // Update end time based on new start (uses smart defaults)
    const [endH, endM] = prevEnd.split(":").map(Number);
    const newStartMinutes = endH * 60 + endM;
    updateDefaultEndTime(newStartMinutes);

    // Sync duration display
    syncDurationInputsFromEndTime();
    updateDurationBadgeDisplay();

    // Reload worklogs for the selected date to reflect actual logged time (force refresh to update cache)
    scheduleWorklogLoad(date, true);
  } catch (err) {
    showStatus(`Error: ${sanitizeString(err.message, 100)}`, "error");
  } finally {
    // Re-enable button
    isSubmitting = false;
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
