// SmartAuction Auto-Fill — Background Service Worker

'use strict';

// The UI is a SIDE PANEL, not a popup — manifest `side_panel.default_path`
// points at popup.html. Chrome only opens it from the toolbar icon because of
// this call, and it is the single point of failure for "the extension won't
// open": if it rejects, the icon silently does nothing and the only trace is an
// unhandled rejection nobody reads.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error('sidePanel.setPanelBehavior failed:', e));

// Fallback for exactly that case. When openPanelOnActionClick is in effect
// Chrome opens the panel itself and this listener never fires, so it costs
// nothing; when the call above failed, this is what still opens the panel.
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel
    .open({ windowId: tab.windowId })
    .catch((e) => console.error('sidePanel.open failed:', e));
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ ok: true });
    return false;
  }
});
