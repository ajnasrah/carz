/**
 * SmartAuction "Manage Inventory" Scraper
 *
 * Scrapes all vehicles from the SA inventory page.
 * Handles: card/list layout, pagination/infinite scroll, and "Export Results" button.
 *
 * Injected on-demand by popup.js.
 */

'use strict';

if (!window._saInventoryScraperLoaded) {
  window._saInventoryScraperLoaded = true;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scrapeSAInventory') {
      scrapeSAInventory(request.options || {})
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message, log: [] }));
      return true;
    }

    if (request.action === 'discoverSAPage') {
      discoverPageStructure()
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true;
    }
  });

  // ── Helpers ──
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  function extractVINFromText(text) {
    const match = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i);
    return match ? match[0].toUpperCase() : '';
  }

  function extractYMMFromText(text) {
    const match = text.match(/\b(20\d{2}|19\d{2})\s+([\w-]+)\s+([\w][\w\s-]*?)(?:\s{2,}|\n|$)/);
    if (match) return { year: match[1], make: match[2], model: match[3].trim() };
    return null;
  }

  function extractStatusFromCard(card) {
    const text = card.textContent.toLowerCase();
    // Check for explicit status indicators
    if (text.includes('removed date') || text.includes('removed')) return 'Removed';
    if (text.includes('on hold')) return 'On Hold';
    if (text.includes('sold')) return 'Sold';
    if (text.includes('active') || text.includes('live')) return 'Active';
    if (text.includes('pending')) return 'Pending';
    if (text.includes('expired')) return 'Expired';
    if (text.includes('reposted')) return 'Reposted';
    return '';
  }

  // ── Main Scraper ──
  async function scrapeSAInventory(options) {
    const log = [];
    const addLog = (msg, cls = 'log-info') => log.push({ msg, cls });

    try {
      // Check the result count from the page header (e.g., "868 Vehicle Results")
      const resultCountEl = document.body.innerText.match(/(\d+)\s+Vehicle\s+Results/i);
      const expectedCount = resultCountEl ? parseInt(resultCountEl[1]) : 0;
      if (expectedCount > 0) {
        addLog(`Page shows ${expectedCount} vehicle results`);
      }

      // Strategy 1: Try clicking "Export Results" — gets ALL vehicles at once
      const exportBtn = findExportButton();
      if (exportBtn && options.useExport !== false) {
        addLog('Found "Export Results" button — clicking to download full list...');
        exportBtn.click();
        addLog('Export triggered. The file will download — upload it via the extension inventory upload to get all vehicles.', 'log-ok');
        // Export downloads a file — we can't intercept it, but we can still scrape visible cards
        await delay(1000);
      }

      // Strategy 2: Scroll to load all vehicles, then scrape cards
      addLog('Scrolling to load all vehicles...');
      const totalLoaded = await scrollToLoadAll(addLog);
      addLog(`Loaded ${totalLoaded} vehicle cards via scrolling`);

      // Now scrape all cards
      const vehicles = scrapeAllCards(addLog);
      addLog(`Scraped ${vehicles.length} vehicles total`, 'log-ok');

      if (expectedCount > 0 && vehicles.length < expectedCount * 0.9) {
        addLog(`Warning: found ${vehicles.length} of ${expectedCount} expected. Some may not have loaded.`, 'log-warn');
      }

      return { success: true, vehicles, count: vehicles.length, expectedCount, log };

    } catch (err) {
      addLog('Scrape error: ' + err.message, 'log-err');
      return { success: false, vehicles: [], error: err.message, log };
    }
  }

  // ── Find the Export Results button ──
  function findExportButton() {
    // Look for links/buttons with "Export" text
    const candidates = [...document.querySelectorAll('a, button, input[type="button"], input[type="submit"]')];
    for (const el of candidates) {
      const text = (el.textContent || el.value || '').trim().toLowerCase();
      if (text.includes('export') && (text.includes('result') || text.includes('csv') || text.includes('excel'))) {
        return el;
      }
    }
    // Also check for export icons/links by class or href
    const exportLink = document.querySelector('a[href*="export"], a[href*="Export"], [class*="export"]');
    return exportLink || null;
  }

  // ── Scroll to load all vehicles (handles infinite scroll / lazy loading) ──
  async function scrollToLoadAll(addLog) {
    // Find the scrollable container — could be the main page or a specific div
    const scrollContainer = findScrollContainer();
    const target = scrollContainer || document.documentElement;

    let prevCount = 0;
    let stableRounds = 0;
    const MAX_STABLE = 5; // Stop after 5 rounds with no new content
    const MAX_SCROLLS = 100;

    for (let i = 0; i < MAX_SCROLLS; i++) {
      // Count current cards
      const currentCount = countVehicleCards();

      if (currentCount === prevCount) {
        stableRounds++;
        if (stableRounds >= MAX_STABLE) break;
      } else {
        stableRounds = 0;
        if (i % 10 === 0 && i > 0) addLog(`  ...${currentCount} loaded so far`);
      }
      prevCount = currentCount;

      // Scroll down
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      } else {
        window.scrollTo(0, document.body.scrollHeight);
      }

      // Also try clicking "Load More" / "Show More" / pagination buttons
      const loadMoreBtn = document.querySelector(
        'button[class*="more"], a[class*="more"], [class*="load-more"], [class*="next"], a[class*="pagination"]'
      );
      if (loadMoreBtn && loadMoreBtn.offsetParent !== null) {
        loadMoreBtn.click();
      }

      await delay(500);
    }

    return countVehicleCards();
  }

  function findScrollContainer() {
    // Look for a scrollable container that holds vehicle cards
    const containers = document.querySelectorAll('div[style*="overflow"], div[class*="scroll"], div[class*="list"], div[class*="results"]');
    for (const c of containers) {
      if (c.scrollHeight > c.clientHeight + 100 && c.querySelectorAll('a, div').length > 20) {
        return c;
      }
    }
    return null;
  }

  function countVehicleCards() {
    // Count elements that look like vehicle cards
    // From the screenshot: each vehicle is in a card with VIN visible
    const allText = document.body.innerText;
    const vins = allText.match(/\b[A-HJ-NPR-Z0-9]{17}\b/gi) || [];
    return new Set(vins.map(v => v.toUpperCase())).size;
  }

  // ── Scrape all vehicle cards from DOM ──
  function scrapeAllCards(addLog) {
    const vehicles = [];
    const seenVINs = new Set();

    // Approach 1: Find structured card elements
    // SmartAuction uses card-like divs with vehicle info
    // From the screenshot: cards contain Year Make Model, VIN, Stock#, status info
    const allElements = document.querySelectorAll('div, li, article, section, tr');

    for (const el of allElements) {
      // Skip very small or very large containers
      const text = el.textContent || '';
      if (text.length < 20 || text.length > 2000) continue;

      // Must contain a 17-char VIN
      const vin = extractVINFromText(text);
      if (!vin || seenVINs.has(vin)) continue;

      // Check this isn't a parent container (we want the innermost card)
      const childVINs = (el.innerHTML.match(/\b[A-HJ-NPR-Z0-9]{17}\b/gi) || [])
        .map(v => v.toUpperCase());
      const uniqueChildVINs = new Set(childVINs);
      if (uniqueChildVINs.size > 1) continue; // Container has multiple vehicles — skip (not a card)

      seenVINs.add(vin);

      const ymm = extractYMMFromText(text);
      const status = extractStatusFromCard(el);

      // Try to find stock number
      const stockMatch = text.match(/STOCK(?:\/UNIT)?\s*#?\s*[:=]?\s*(\S+)/i) ||
                         text.match(/STOCK\s*(?:\/\s*UNIT\s*)?#?\s*(\S+)/i);

      // Try to find date
      const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);

      vehicles.push({
        vin,
        year: ymm?.year || '',
        make: ymm?.make || '',
        model: ymm?.model || '',
        status,
        stock: stockMatch ? stockMatch[1] : '',
        listDate: dateMatch ? dateMatch[0] : '',
        price: '',
      });
    }

    // Approach 2: If card approach didn't find much, do full-page VIN extraction
    if (vehicles.length < 10) {
      addLog('Card scrape found few results, doing full VIN scan...');
      const allText = document.body.innerText;
      const vinMatches = allText.match(/\b[A-HJ-NPR-Z0-9]{17}\b/gi) || [];
      for (const rawVin of vinMatches) {
        const vin = rawVin.toUpperCase();
        if (seenVINs.has(vin)) continue;
        seenVINs.add(vin);
        vehicles.push({ vin, year: '', make: '', model: '', status: '', stock: '', listDate: '', price: '' });
      }
    }

    return vehicles;
  }

  // ── Discovery mode ──
  async function discoverPageStructure() {
    const data = {
      url: window.location.href,
      title: document.title,
      resultCount: '',
      tables: [],
      cards: [],
      buttons: [],
      scrollContainers: [],
    };

    // Result count
    const countMatch = document.body.innerText.match(/(\d+)\s+Vehicle\s+Results/i);
    data.resultCount = countMatch ? countMatch[1] : 'not found';

    // VIN count
    const vins = document.body.innerText.match(/\b[A-HJ-NPR-Z0-9]{17}\b/gi) || [];
    data.vinCount = new Set(vins.map(v => v.toUpperCase())).size;

    // Tables
    document.querySelectorAll('table').forEach((table, i) => {
      const rowCount = table.querySelectorAll('tr').length;
      data.tables.push({ index: i, rowCount, className: (table.className || '').substring(0, 80) });
    });

    // Potential vehicle cards
    const cardSelectors = ['[class*="vehicle"]', '[class*="listing"]', '[class*="card"]', '[class*="result"]', '[class*="item"]'];
    for (const sel of cardSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        data.cards.push({
          selector: sel,
          count: els.length,
          sampleText: els[0].textContent.trim().substring(0, 150)
        });
      }
    }

    // Export/pagination buttons
    document.querySelectorAll('a, button').forEach(el => {
      const text = (el.textContent || '').trim();
      if (text.length > 1 && text.length < 50 &&
          (text.toLowerCase().includes('export') || text.toLowerCase().includes('next') ||
           text.toLowerCase().includes('more') || text.toLowerCase().includes('page'))) {
        data.buttons.push({ tag: el.tagName, text, href: (el.href || '').substring(0, 100) });
      }
    });

    // Scroll containers
    document.querySelectorAll('div').forEach(div => {
      if (div.scrollHeight > div.clientHeight + 200) {
        data.scrollContainers.push({
          className: (div.className || '').substring(0, 80),
          scrollHeight: div.scrollHeight,
          clientHeight: div.clientHeight,
          childCount: div.children.length
        });
      }
    });

    return data;
  }
}
