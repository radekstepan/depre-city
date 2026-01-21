// Listens for the extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url.startsWith("http")) return;

  try {
    await sendScrapeCommand(tab.id);
  } catch (err) {
    console.log("Content script not ready. Injecting...", err);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      await new Promise(r => setTimeout(r, 100));
      await sendScrapeCommand(tab.id);
    } catch (injectErr) {
      console.error("Failed to inject scraper:", injectErr);
    }
  }
});

async function sendScrapeCommand(tabId) {
  const response = await chrome.tabs.sendMessage(tabId, { action: "SCRAPE_LISTING" });
  
  if (response && response.success) {
    downloadHtml(response.payload);
  } else {
    throw new Error(response?.error || "Unknown error");
  }
}

function downloadHtml(payload) {
  const blob = new Blob([payload.html], {type: 'text/html'});
  const reader = new FileReader();
  
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    chrome.downloads.download({
        url: dataUrl,
        filename: `deprecity_raw/${payload.filename}`, // Save to subfolder in Downloads
        conflictAction: 'uniquify',
        saveAs: false
    });
  };
  
  reader.readAsDataURL(blob);
}
