// This script runs inside the web page context

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "PING") {
    sendResponse({ status: "OK" });
    return true;
  }

  if (request.action === "SCRAPE_LISTING") {
    showToast("Snapshottng HTML...", "info");
    try {
      // 1. Inject Metadata for the processor to find later
      const meta = document.createElement('meta');
      meta.name = "x-deprecity-source-url";
      meta.content = window.location.href;
      document.head.appendChild(meta);

      const scrapedAt = document.createElement('meta');
      scrapedAt.name = "x-deprecity-scraped-at";
      scrapedAt.content = new Date().toISOString();
      document.head.appendChild(scrapedAt);

      // 2. Capture full HTML
      const fullHtml = document.documentElement.outerHTML;

      // 3. Determine Filename Slug
      const h1 = document.querySelector('h1')?.innerText || "listing";
      const slug = h1.replace(/[^a-z0-9]/gi, '_').toLowerCase();

      // Add a small delay for user feedback
      setTimeout(() => showToast("HTML Captured! Downloading...", "success"), 500);
      
      sendResponse({ 
        success: true, 
        payload: {
            html: fullHtml,
            filename: `${slug}.html`
        }
      });

    } catch (error) {
      console.error("DepreCity Scrape Error:", error);
      showToast("Error Snapshotting Page", "error");
      sendResponse({ success: false, error: error.message });
    }
  }
  return true; 
});

// --- UI Feedback Helper ---
function showToast(message, type = "info") {
  const existing = document.getElementById("deprecity-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "deprecity-toast";
  toast.style.position = "fixed";
  toast.style.top = "20px";
  toast.style.right = "20px";
  toast.style.padding = "12px 20px";
  toast.style.borderRadius = "8px";
  toast.style.color = "white";
  toast.style.fontWeight = "bold";
  toast.style.zIndex = "999999";
  toast.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
  toast.style.fontFamily = "sans-serif";
  toast.style.fontSize = "14px";
  toast.style.transition = "opacity 0.3s ease";

  if (type === "success") toast.style.backgroundColor = "#10b981"; // Green
  else if (type === "error") toast.style.backgroundColor = "#ef4444"; // Red
  else toast.style.backgroundColor = "#d97706"; // Amber

  toast.textContent = message;
  document.body.appendChild(toast);

  // Auto remove
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
