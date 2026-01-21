document.addEventListener('DOMContentLoaded', () => {
  const scrapeBtn = document.getElementById('scrapeBtn');
  const statusEl = document.getElementById('status');

  scrapeBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      statusEl.textContent = "Error: No active tab.";
      return;
    }

    statusEl.textContent = "Connecting...";

    try {
      await ensureContentScript(tab.id);

      statusEl.textContent = "Snapshotting DOM...";

      const response = await chrome.tabs.sendMessage(tab.id, { action: "SCRAPE_LISTING" });
      
      if (response && response.success) {
        statusEl.textContent = "Downloading HTML...";
        downloadHtml(response.payload);
        statusEl.textContent = "Saved to Downloads/deprecity_raw/";
      } else {
        throw new Error(response?.error || "Unknown parsing error.");
      }

    } catch (err) {
      console.error("Popup Error:", err);
      statusEl.textContent = "Error: " + (err.message || "Failed to connect.");
    }
  });
});

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "PING" });
  } catch (err) {
    console.log("Content script not detected. Injecting...");
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });
    await new Promise(r => setTimeout(r, 100));
  }
}

function downloadHtml(payload) {
    const blob = new Blob([payload.html], {type: 'text/html'});
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = payload.filename;
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
