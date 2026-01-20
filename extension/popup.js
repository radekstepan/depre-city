document.addEventListener('DOMContentLoaded', () => {
  const scrapeBtn = document.getElementById('scrapeBtn');
  const statusEl = document.getElementById('status');

  scrapeBtn.addEventListener('click', async () => {
    // 1. Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      statusEl.textContent = "Error: No active tab.";
      return;
    }

    statusEl.textContent = "Connecting...";

    try {
      // 2. Ensure content script is loaded before sending message
      await ensureContentScript(tab.id);

      statusEl.textContent = "Parsing data...";

      // 3. Send Scrape Command
      const response = await chrome.tabs.sendMessage(tab.id, { action: "SCRAPE_LISTING" });
      
      if (response && response.success) {
        statusEl.textContent = "Generating JSON...";
        downloadJSON(response.data);
        statusEl.textContent = "Success! Data downloaded.";
      } else {
        throw new Error(response?.error || "Unknown parsing error.");
      }

    } catch (err) {
      console.error("Popup Error:", err);
      statusEl.textContent = "Error: " + (err.message || "Failed to connect.");
      
      // Detailed feedback for common issues
      if (err.message.includes("receiving end does not exist")) {
        statusEl.textContent = "Error: Please refresh the page.";
      }
    }
  });
});

/**
 * Checks if the content script is listening. If not, injects it.
 */
async function ensureContentScript(tabId) {
  try {
    // Attempt to ping the content script
    await chrome.tabs.sendMessage(tabId, { action: "PING" });
  } catch (err) {
    // If ping fails, inject the script file dynamically
    console.log("Content script not detected. Injecting...");
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });
    // Give it a moment to initialize
    await new Promise(r => setTimeout(r, 100));
  }
}

/**
 * Triggers a browser download of the JSON object
 */
function downloadJSON(data) {
  try {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    
    // Naming convention: Address-City.json or timestamp if fallback
    const safeAddress = (data.address || "listing")
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .toLowerCase();
      
    a.download = `${safeAddress}_data.json`;
    
    document.body.appendChild(a);
    a.click();
    
    // Cleanup
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Download Error:", e);
    throw new Error("Failed to create download file.");
  }
}
