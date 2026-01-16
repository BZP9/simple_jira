// Simple Jira Worklog - Background Script
"use strict";

console.log("Simple Jira Worklog extension loaded");

// Constants
const API_TIMEOUT = 30000; // 30 seconds
const MAX_URL_LENGTH = 2000;
const ALLOWED_DOMAINS = [".atlassian.net", ".jira.com"];

// Handle messages from popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "jiraFetch") {
    handleJiraFetch(message.url, message.options)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: sanitizeError(err.message) }));
    return true; // Keep message channel open for async response
  }
});

// Sanitize error messages to prevent information leakage
function sanitizeError(message) {
  if (!message || typeof message !== "string") return "Unknown error";
  // Truncate and remove any potentially sensitive info
  return message.slice(0, 200);
}

// Validate URL is for Jira
function isValidJiraUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (url.length > MAX_URL_LENGTH) return false;

  try {
    const urlObj = new URL(url);
    // Must be HTTPS
    if (urlObj.protocol !== "https:") return false;
    // Must be an allowed Jira domain
    const hostname = urlObj.hostname.toLowerCase();
    return ALLOWED_DOMAINS.some(domain => hostname.endsWith(domain));
  } catch {
    return false;
  }
}

// Fetch with timeout
async function fetchWithTimeout(url, options, timeout = API_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleJiraFetch(url, options = {}) {
  // Validate URL
  if (!isValidJiraUrl(url)) {
    return { error: "Invalid or unauthorized URL" };
  }

  const data = await browser.storage.local.get(["jiraEmail", "jiraToken"]);

  if (!data.jiraEmail || !data.jiraToken) {
    return { error: "Not authenticated" };
  }

  const credentials = btoa(`${data.jiraEmail}:${data.jiraToken}`);

  // Extract origin from URL for CORS/XSRF headers
  const urlObj = new URL(url);
  const origin = urlObj.origin;

  const headers = {
    "Authorization": `Basic ${credentials}`,
    "Accept": "application/json",
    "Content-Type": "application/json",
    "X-Atlassian-Token": "no-check",
    "Origin": origin,
    "Referer": origin + "/"
  };

  try {
    const response = await fetchWithTimeout(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers
      },
      referrer: origin + "/",
      referrerPolicy: "origin"
    }, API_TIMEOUT);

    const responseText = await response.text();
    let responseData;

    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = responseText;
    }

    return {
      ok: response.ok,
      status: response.status,
      data: responseData
    };
  } catch (err) {
    if (err.name === "AbortError") {
      return { error: "Request timed out" };
    }
    return { error: sanitizeError(err.message) };
  }
}
