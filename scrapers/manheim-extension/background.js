console.log('Background script loaded');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.action);

  if (request.action === 'downloadData') {
    console.log('Starting download for VIN:', request.data?.vin);

    // Respond immediately so the popup doesn't hang waiting for downloads
    sendResponse({ success: true });

    // Download in the background - don't block the popup
    downloadAllData(request.data)
      .then(() => {
        console.log('Download completed successfully for VIN:', request.data?.vin);
      })
      .catch((error) => {
        console.error('Download error for VIN:', request.data?.vin, error);
      });

    return false; // Response already sent synchronously
  }
  
  // Handle single image download
  if (request.action === 'downloadSingleImage') {
    chrome.downloads.download({
      url: request.url,
      filename: request.filename,
      saveAs: false
    }).then(() => {
      console.log('Downloaded:', request.filename);
      sendResponse({ success: true });
    }).catch(err => {
      console.error('Download failed:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // Will respond asynchronously
  }
});

// Keep service worker alive during long downloads (MV3 workaround).
// setInterval alone isn't reliable — Chrome can still kill after 5 minutes.
// Pair with a short-period alarm so the worker gets re-woken if terminated.
let keepAliveInterval = null;

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000);
  chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
  chrome.alarms.clear('keepAlive');
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    console.log('keepAlive alarm fired');
  }
});

// Collapse the same damage reported twice.
//
// Several extractors run over one page — the condition-detail table, then the
// body-text scan — and each pushes what it found. The same damage therefore
// lands twice in different clothes: "Front Bumper (Prev Repair)" from one and
// "Front Bumper - Prev Repair" from the other. A real 16-damage report went out
// as 20 rows, and neither pass was complete on its own, so you can't just keep
// one of them.
//
// Compared on panel + condition, kept in the FIRST form seen — the Manheim
// charges table writes "Desc: Condition (Severity) — Repair" and that detail is
// worth more than uniformity, so this never rewrites an entry, it only drops a
// later restatement of one already present.
function dedupeDamages(list) {
  const out = [];
  const seen = new Set();

  const split = (s) => {
    // Same precedence the SmartAuction importer uses: colon, then pipe, then a
    // dash with a space after it. Parentheses are checked last so a severity in
    // brackets doesn't get read as the condition.
    let m = s.match(/^([^:]+):\s*(.+)$/) || s.match(/^(.+?)\s*\|\s*(.+)$/)
         || s.match(/^(.+\S)\s*[-–—]\s+(.+)$/) || s.match(/^(.+?)\s*\((.+)\)\s*$/);
    return m ? [m[1], m[2]] : [s, ''];
  };
  // Only the words matter: "Prev Repair (SubStd Dirt) — Repair" and
  // "Prev Repair" are the same finding seen at two levels of detail.
  const norm = (s) => String(s || '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')       // drop parenthesised severity
    .replace(/\s*[—–]\s*.*$/, ' ')    // drop "— Suggested Repair"
    .replace(/\[[^\]]*\]/g, ' ')      // drop "[$120.00]"
    .replace(/[^a-z0-9]+/g, ' ').trim();

  for (const d of list || []) {
    const text = typeof d === 'string' ? d
      : (d && d.part && d.type) ? `${d.part} - ${d.type}` : null;
    if (!text && typeof d !== 'object') continue;

    let key;
    if (typeof d === 'string') {
      const [panel, cond] = split(d);
      key = norm(panel) + '|' + norm(cond);
    } else if (d && (d.part || d.type)) {
      key = norm(d.part) + '|' + norm(d.type);
    } else {
      out.push(d);   // shape we don't recognise — never silently drop it
      continue;
    }
    if (!key.replace('|', '').trim()) { out.push(d); continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

async function downloadAllData(data) {
  startKeepAlive();

  try {
    const vin = data.vin || 'UNKNOWN_VIN';
    const folderPrefix = vin + '/';

    // Before anything is written — the summary and the JSON must agree, and
    // both are generated from data.damages further down.
    const beforeCount = (data.damages || []).length;
    data.damages = dedupeDamages(data.damages);
    if (beforeCount !== data.damages.length) {
      console.log(`Damages: ${beforeCount} rows -> ${data.damages.length} unique`);
    }

    console.log(`Creating folder: ${folderPrefix}`);
    console.log(`Images to download: ${data.images?.length || 0}`);
    console.log(`Damages found: ${data.damages?.length || 0}`);

    // Download all images directly via their URLs.
    // MV3 service workers don't have URL.createObjectURL, so we pass the
    // CDN URL straight to chrome.downloads.download() and let the browser
    // handle the fetch. This is simpler and avoids the blob pipeline entirely.
    const downloadedImages = [];
    const failedImages = [];
    const skippedImages = [];
    let downloadIndex = 0;

    // Fire all downloads in parallel — chrome.downloads handles queuing
    const downloadPromises = (data.images || []).map((image, i) => {
      // Belt and braces on top of the collector's isJunk(): anything that isn't
      // an image is skipped here rather than queued. getFileExtension() falls
      // back to '.jpg' for an unknown URL, so a page (cr.html) used to be
      // recorded in the manifest as _image_N.jpg while Chrome wrote it to disk
      // as .html — a reference that pointed at nothing.
      const urlPath = String(image.url || '').split('?')[0].toLowerCase();
      const urlExt = urlPath.includes('.') ? urlPath.split('.').pop() : '';
      if (urlExt && !['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(urlExt)) {
        skippedImages.push(`${image.url.substring(0, 100)} — not an image (.${urlExt})`);
        return Promise.resolve();
      }

      const ext = getFileExtension(image.url, '');
      const idx = i + 1;
      const filename = folderPrefix + vin + '_image_' + idx + ext;
      const shortUrl = image.url.substring(0, 100);

      console.log(`Queuing image ${idx}: ${shortUrl}`);
      return chrome.downloads.download({
        url: image.url,
        filename: filename,
        saveAs: false
      }).then(downloadId => {
        downloadedImages.push({ index: idx, filename: vin + '_image_' + idx + ext });
      }).catch(error => {
        console.error(`Failed image ${idx}:`, error.message, shortUrl);
        failedImages.push(`${shortUrl} — ${error.message}`);
      });
    });

    await Promise.all(downloadPromises);
    downloadedImages.sort((a, b) => a.index - b.index);

    // Attach failure/skip info so the summary can report it
    data._failedImages = failedImages;
    data._skippedImages = skippedImages;

    // Generate summary AFTER downloads so it reflects what was actually saved
    const summary = generateSummaryText(data, downloadedImages);
    const summaryDataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(summary);

    console.log('Downloading summary file...');
    await chrome.downloads.download({
      url: summaryDataUrl,
      filename: folderPrefix + vin + '_summary.txt',
      saveAs: false
    });
    
    // Also save a JSON file with all the data
    const jsonData = {
      vin: data.vin,
      vehicle: data.vehicle,
      year: data.year,
      make: data.make,
      model: data.model,
      odometer: data.odometer,
      location: data.location,
      seller: data.seller,
      currentBid: data.currentBid,
      inspectionType: data.inspectionType,
      announcements: data.announcements,
      damages: data.damages || [],
      tires: data.tires || [],
      images: downloadedImages.map(img => img.filename),
      scraped_at: new Date().toISOString(),
      source_url: data.url || '',
      total_images: downloadedImages.length,
      total_damages: (data.damages || []).length
    };
    
    const jsonDataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(jsonData, null, 2));
    
    console.log('Downloading JSON data file...');
    await chrome.downloads.download({
      url: jsonDataUrl,
      filename: folderPrefix + vin + '_data.json',
      saveAs: false
    });

    console.log('All downloads completed for VIN:', vin);
  } finally {
    stopKeepAlive();
  }
}

function generateSummaryText(data, downloadedImages) {
  let text = '';

  text += '='.repeat(60) + '\n';
  text += 'MANHEIM LISTING SUMMARY\n';
  text += '='.repeat(60) + '\n\n';

  text += 'VIN: ' + (data.vin || 'Not found') + '\n';
  text += 'Vehicle: ' + (data.vehicle || 'Not found') + '\n';
  text += 'Odometer: ' + (data.odometer || 'Not found') + '\n';

  if (data.conditionScore) {
    text += 'Condition Score: ' + data.conditionScore + '\n';
  }

  if (data.stockNumber) {
    text += 'Stock Number: ' + data.stockNumber + '\n';
  }

  if (data.location) {
    text += 'Location: ' + data.location + '\n';
  }

  if (data.saleDate) {
    text += 'Sale Date: ' + data.saleDate + '\n';
  }

  const damages = data.damages || [];
  text += '\n' + '-'.repeat(60) + '\n';
  text += 'DAMAGES & ISSUES (' + damages.length + ' found)\n';
  text += '-'.repeat(60) + '\n\n';

  if (damages.length > 0) {
    damages.forEach((damage, i) => {
      // Handle both string damages and object damages
      if (typeof damage === 'string') {
        text += (i + 1) + '. ' + damage + '\n';
      } else if (damage.part && damage.type) {
        text += (i + 1) + '. ' + damage.part + ' - ' + damage.type;
        if (damage.severity) {
          text += ' (' + damage.severity + ')';
        }
        text += '\n';
      } else {
        text += (i + 1) + '. ' + JSON.stringify(damage) + '\n';
      }
    });
  } else {
    text += 'No damages detected or reported.\n';
  }

  if (data.tires && data.tires.length > 0) {
    text += '\n' + '-'.repeat(60) + '\n';
    text += 'TIRES AND WHEELS\n';
    text += '-'.repeat(60) + '\n\n';
    data.tires.forEach((tire) => {
      text += tire + '\n';
    });
  }

  // Handle announcements - can be either a string or an array
  if (data.announcements) {
    text += '\n' + '-'.repeat(60) + '\n';
    text += 'ANNOUNCEMENTS\n';
    text += '-'.repeat(60) + '\n\n';
    
    if (Array.isArray(data.announcements) && data.announcements.length > 0) {
      data.announcements.forEach((ann, i) => {
        text += (i + 1) + '. ' + ann + '\n\n';
      });
    } else if (typeof data.announcements === 'string' && data.announcements.length > 0) {
      text += data.announcements + '\n\n';
    } else {
      text += 'No announcements\n\n';
    }
  }

  text += '\n' + '-'.repeat(60) + '\n';
  text += 'IMAGES DOWNLOADED (' + (downloadedImages?.length || 0) + ')\n';
  text += '-'.repeat(60) + '\n\n';

  if (downloadedImages && downloadedImages.length > 0) {
    downloadedImages.forEach((img) => {
      text += '- ' + img.filename + '\n';
    });
  } else {
    text += 'No images downloaded.\n';
  }

  // Report failures so the user knows what went wrong
  const failed = data._failedImages || [];
  const skipped = data._skippedImages || [];

  if (failed.length > 0) {
    text += '\n' + '-'.repeat(60) + '\n';
    text += 'FAILED DOWNLOADS (' + failed.length + ')\n';
    text += '-'.repeat(60) + '\n\n';
    failed.forEach((f) => { text += '- ' + f + '\n'; });
  }

  if (skipped.length > 0) {
    text += '\n' + '-'.repeat(60) + '\n';
    text += 'SKIPPED (' + skipped.length + ')\n';
    text += '-'.repeat(60) + '\n\n';
    skipped.forEach((s) => { text += '- ' + s + '\n'; });
  }

  // Diagnostic: dump all image URLs the scraper found on the page
  const allUrls = data.images || [];
  text += '\n' + '-'.repeat(60) + '\n';
  text += 'DEBUG: ALL IMAGE URLS FOUND ON PAGE (' + allUrls.length + ')\n';
  text += '-'.repeat(60) + '\n\n';
  if (allUrls.length > 0) {
    allUrls.forEach((img, i) => {
      text += (i + 1) + '. ' + img.url + '\n';
    });
  } else {
    text += 'NONE — scraper could not find any image URLs on this page.\n';
    text += 'Images may be inside an iframe or loaded via a mechanism\n';
    text += 'the scraper does not handle yet.\n';
  }

  text += '\n' + '='.repeat(60) + '\n';
  text += 'Scraped on: ' + new Date().toLocaleString() + '\n';
  text += '='.repeat(60) + '\n';

  return text;
}

function getFileExtension(url, mimeType) {
  // Try to get extension from URL
  const urlPath = url.split('?')[0];
  const urlExt = urlPath.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(urlExt)) {
    return '.' + urlExt;
  }

  // Fall back to MIME type
  const mimeMap = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp'
  };

  return mimeMap[mimeType] || '.jpg';
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
