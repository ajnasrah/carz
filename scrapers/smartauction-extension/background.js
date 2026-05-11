// SmartAuction Auto-Fill — Background Service Worker

'use strict';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ ok: true });
    return false;
  }
});
