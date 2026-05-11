// Content script runs on all Manheim/OVE pages

console.log('Manheim/OVE Scraper extension loaded');

// Shared domain detection
function isManheimDomain(hostname) {
  return hostname.endsWith('manheim.com') ||
         hostname.endsWith('ove.com') ||
         hostname.endsWith('edgepipeline.com') ||
         hostname.includes('simulcast') ||
         hostname.includes('crsimplified');
}

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkPage') {
    sendResponse({
      isManheim: isManheimDomain(window.location.hostname),
      url: window.location.href
    });
  }
  return true;
});
