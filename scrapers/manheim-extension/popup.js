// Shared domain detection — single source of truth
function isManheimDomain(urlOrHostname) {
  let hostname;
  try {
    // If it looks like a URL, extract the hostname
    if (urlOrHostname.includes('://')) {
      hostname = new URL(urlOrHostname).hostname.toLowerCase();
    } else {
      hostname = urlOrHostname.toLowerCase();
    }
  } catch (e) {
    hostname = urlOrHostname.toLowerCase();
  }
  return hostname.endsWith('manheim.com') ||
         hostname.endsWith('ove.com') ||
         hostname.endsWith('edgepipeline.com') ||
         hostname.includes('simulcast') ||
         hostname.includes('crsimplified');
}

document.addEventListener('DOMContentLoaded', async function() {
  const scrapeBtn = document.getElementById('scrapeBtn');
  const pdfUpload = document.getElementById('pdfUpload');
  const statusDiv = document.getElementById('status');
  const resultsDiv = document.getElementById('results');

  // Show current page info
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.url) {
      const hostname = new URL(tab.url).hostname;

      if (isManheimDomain(hostname)) {
        statusDiv.className = 'status success';
        statusDiv.textContent = `Ready to scrape ${hostname}`;
      } else {
        statusDiv.className = 'status error';
        statusDiv.textContent = `Not on Manheim/OVE (currently: ${hostname})`;
      }
    } else {
      statusDiv.textContent = 'Ready to scrape or upload PDF';
    }
  } catch (e) {
    console.error('Error checking page:', e);
    statusDiv.textContent = 'Ready to scrape or upload PDF';
  }

  // Handle PDF upload
  pdfUpload.addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file || !file.name.endsWith('.pdf')) {
      alert('Please select a PDF file');
      return;
    }

    scrapeBtn.disabled = true;
    pdfUpload.disabled = true;
    statusDiv.className = 'status working';
    statusDiv.textContent = 'Processing PDF...';
    resultsDiv.innerHTML = '';

    try {
      const data = await processPDFFile(file);

      if (!data.vin) {
        throw new Error('Could not extract VIN from PDF');
      }

      // Send data to background script for downloading
      await downloadData(data);

      statusDiv.className = 'status success';
      statusDiv.textContent = 'PDF processed successfully!';

      resultsDiv.innerHTML = `
        <div><strong>VIN:</strong> ${data.vin}</div>
        <div><strong>Vehicle:</strong> ${data.vehicle || 'N/A'}</div>
        <div><strong>Grade:</strong> ${data.conditionScore || 'N/A'}</div>
        <div><strong>Damages:</strong> ${data.damages.length}</div>
        <div style="margin-top: 10px; color: #666;">Check your Downloads folder for: ${data.vin}/</div>
      `;

    } catch (error) {
      statusDiv.className = 'status error';
      statusDiv.textContent = 'Error: ' + error.message;
      console.error('PDF processing error:', error);
    } finally {
      scrapeBtn.disabled = false;
      pdfUpload.disabled = false;
      pdfUpload.value = '';
    }
  });

  // Handle page scraping
  scrapeBtn.addEventListener('click', async function() {
    scrapeBtn.disabled = true;
    pdfUpload.disabled = true;
    statusDiv.className = 'status working';
    statusDiv.textContent = 'Scraping page...';
    resultsDiv.innerHTML = '';

    try {
      console.log('Step 1: Getting current tab...');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab) {
        throw new Error('No active tab found');
      }

      if (!tab.url) {
        throw new Error('Cannot access tab URL. Please reload the extension and try again.');
      }

      console.log('Current tab:', tab.url);

      if (!isManheimDomain(tab.url)) {
        throw new Error(`Not on Manheim/OVE/CR page. Current: ${new URL(tab.url).hostname}`);
      }

      statusDiv.textContent = 'Extracting data from page...';
      console.log('Step 2: Injecting scraper script...');

      // Inject and execute the scraping script with proper timeout cleanup
      let timeoutId;
      const executePromise = chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapePage
      });

      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Script execution timeout - page may not be fully loaded')), 30000);
      });

      let results;
      try {
        results = await Promise.race([executePromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutId);
      }

      console.log('Script execution results:', results);

      if (!results || !results[0]) {
        throw new Error('Script execution returned no results');
      }

      const data = results[0].result;
      console.log('Scraped data:', data);

      if (!data) {
        throw new Error('Script returned null/undefined data');
      }

      if (!data.vin) {
        throw new Error(`Could not extract VIN. Found: ${JSON.stringify(data).substring(0, 200)}`);
      }

      statusDiv.textContent = 'Sending to download...';
      console.log('Step 3: Sending data to background for download...');

      // Send data to background script for downloading (returns immediately)
      await downloadData(data);

      statusDiv.className = 'status success';
      statusDiv.textContent = 'Scrape complete! Downloads starting in background...';

      resultsDiv.innerHTML = `
        <div><strong>VIN:</strong> ${data.vin}</div>
        <div><strong>Vehicle:</strong> ${data.vehicle || 'N/A'}</div>
        <div><strong>Odometer:</strong> ${data.odometer || 'N/A'}</div>
        <div><strong>Images:</strong> ${data.images.length}</div>
        <div><strong>Damages:</strong> ${data.damages.length}</div>
        <div><strong>Tires:</strong> ${data.tires?.length || 0}</div>
        <div style="margin-top: 10px; color: #666;">Downloads saving to: ${data.vin}/</div>
        <div style="margin-top: 5px; font-size: 11px; color: #28a745;">You can close this and move to the next car now!</div>
      `;

      console.log('SUCCESS: Data sent to background!');

    } catch (error) {
      statusDiv.className = 'status error';
      statusDiv.textContent = 'Error: ' + error.message;
      console.error('Scraping error:', error);
      console.error('Error stack:', error.stack);
    } finally {
      scrapeBtn.disabled = false;
      pdfUpload.disabled = false;
    }
  });
});

// Helper function to send data to background for download
async function downloadData(data) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Download timeout - background script not responding'));
    }, 30000);

    chrome.runtime.sendMessage({
      action: 'downloadData',
      data: data
    }, (response) => {
      clearTimeout(timeout);

      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (response && response.success) {
        resolve();
      } else {
        reject(new Error(response?.error || 'Download failed'));
      }
    });
  });
}

// Process PDF file
async function processPDFFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const text = await extractTextFromPDF(arrayBuffer);

  const data = {
    vin: '',
    vehicle: '',
    odometer: '',
    damages: [],
    images: [],
    conditionScore: '',
    grade: '',
    location: ''
  };

  // Extract VIN
  const vinMatch = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (vinMatch) {
    data.vin = vinMatch[1];
  }

  // Extract vehicle info — comprehensive make list
  const makes = [
    'Acura', 'Alfa Romeo', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'Buick',
    'Cadillac', 'Chevrolet', 'Chrysler', 'Dodge', 'Fiat', 'Ford', 'Genesis',
    'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Jaguar', 'Jeep', 'Kia',
    'Lamborghini', 'Land Rover', 'Lexus', 'Lincoln', 'Lucid', 'Maserati',
    'Mazda', 'McLaren', 'Mercedes', 'Mercedes-Benz', 'Mini', 'Mitsubishi',
    'Nissan', 'Polestar', 'Porsche', 'Ram', 'Rivian', 'Rolls-Royce', 'Subaru',
    'Tesla', 'Toyota', 'Volkswagen', 'Volvo'
  ];
  const makesPattern = makes.join('|');
  const vehicleRegex = new RegExp(
    '(\\d{4})\\s+(' + makesPattern + ')\\s+([A-Za-z0-9\\s]+?)(?=\\s+\\d{1}WD|\\s+[A-Z]{3}|\\s+\\||Grade|VIN|$)',
    'i'
  );
  const vehicleMatch = text.match(vehicleRegex);
  if (vehicleMatch) {
    data.vehicle = `${vehicleMatch[1]} ${vehicleMatch[2]} ${vehicleMatch[3].trim()}`;
  }

  // Extract mileage
  const odoMatch = text.match(/(\d{1,3}(?:,\d{3})*)\s*mi/i);
  if (odoMatch) {
    data.odometer = odoMatch[1].replace(/,/g, '');
  }

  // Extract grade
  const gradeMatch = text.match(/Grade\s+(\d\.\d)/i);
  if (gradeMatch) {
    data.grade = gradeMatch[1];
    data.conditionScore = `Grade ${gradeMatch[1]}`;
  }

  // Extract location
  const locationMatch = text.match(/(?:DAA|Manheim)\s+([^\n]+?)(?=\d{5}|\n|$)/i);
  if (locationMatch) {
    data.location = locationMatch[1].trim();
  }

  // Extract damages - improved pattern matching for Manheim format
  const lines = text.split('\n');
  let inDamagesSection = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Look for DAMAGES section header
    if (line.toLowerCase().includes('damages') || line.toLowerCase() === 'damages') {
      inDamagesSection = true;
      continue;
    }
    
    // Exit damages section if we hit another section
    if (inDamagesSection && line.match(/^(DISCLOSURES|SEATING|OPTIONS|ANNOUNCEMENTS|TIRES)/i)) {
      break;
    }

    // Extract damages in the format: "Windshield | Cracked" or "Front Bumper Cover | Misaligned"
    if (inDamagesSection) {
      const pipeMatch = line.match(/^([A-Za-z\s]+[A-Za-z])\s*\|\s*([A-Za-z\s]+)$/);
      if (pipeMatch) {
        const location = pipeMatch[1].trim();
        const type = pipeMatch[2].trim();
        
        // Check next line for severity
        let severity = '';
        if (i + 1 < lines.length) {
          const severityMatch = lines[i + 1].match(/severity[:\s]+(.+)/i);
          if (severityMatch) {
            severity = ` (${severityMatch[1].trim()})`;
          }
        }

        const damageStr = `${location} - ${type}${severity}`;
        if (!data.damages.includes(damageStr)) {
          data.damages.push(damageStr);
        }
      }
    }
  }

  return data;
}

// PDF text extraction
// NOTE: This is a basic extractor. For reliable PDF parsing, bundle pdf.js:
// https://mozilla.github.io/pdf.js/
async function extractTextFromPDF(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);

  // Try to decompress and extract text from PDF streams
  const extractedTexts = [];

  // Method 1: Extract text from uncompressed streams (BT...ET blocks)
  const decoder = new TextDecoder('latin1');
  const rawText = decoder.decode(bytes);

  // Find text objects in PDF content streams
  const textObjRegex = /BT\s([\s\S]*?)ET/g;
  let match;
  while ((match = textObjRegex.exec(rawText)) !== null) {
    const block = match[1];
    // Extract text from Tj and TJ operators
    const tjMatches = block.match(/\(([^)]*)\)\s*Tj/g);
    if (tjMatches) {
      for (const tj of tjMatches) {
        const textMatch = tj.match(/\(([^)]*)\)/);
        if (textMatch) extractedTexts.push(textMatch[1]);
      }
    }
    // TJ array operator
    const tjArrayMatches = block.match(/\[(.*?)\]\s*TJ/g);
    if (tjArrayMatches) {
      for (const tja of tjArrayMatches) {
        const parts = tja.match(/\(([^)]*)\)/g);
        if (parts) {
          extractedTexts.push(parts.map(p => p.slice(1, -1)).join(''));
        }
      }
    }
  }

  // Method 2: Extract form field values (/V and /T)
  const fieldRegex = /\/(?:V|T)\s*\(([^)]*)\)/g;
  while ((match = fieldRegex.exec(rawText)) !== null) {
    extractedTexts.push(match[1]);
  }

  if (extractedTexts.length > 0) {
    return extractedTexts.join(' ');
  }

  // Fallback: extract all printable ASCII sequences (last resort)
  const printable = rawText.replace(/[^\x20-\x7E\n]/g, ' ').replace(/\s+/g, ' ');
  return printable;
}

// This function runs in the context of the web page
async function scrapePage() {
  console.log('scrapePage: Starting...');

  const data = {
    vin: '',
    vehicle: '',
    odometer: '',
    damages: [],
    images: [],
    conditionScore: '',
    stockNumber: '',
    location: '',
    saleDate: '',
    announcements: [],
    tires: []
  };

  // Wait for dynamic content and scroll to load lazy images
  console.log('scrapePage: Waiting for dynamic content...');
  console.log('scrapePage: Current URL:', window.location.href);
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Auto-navigate through image gallery to load all images
  console.log('scrapePage: Looking for gallery navigation...');

  // Find next/forward buttons in gallery
  const nextButtonSelectors = [
    'button[aria-label*="next" i]',
    'button[aria-label*="forward" i]',
    'button[title*="next" i]',
    'button[class*="next" i]',
    'button[class*="forward" i]',
    'button[class*="arrow-right" i]',
    'button[class*="right" i]',
    '[class*="carousel"] button',
    '[class*="gallery"] button',
    '[class*="slider"] button',
    'button svg[class*="arrow"]',
    'button svg[class*="chevron"]',
    'button svg[class*="right"]',
    'button[data-action*="next"]',
    'button > svg',
    'button'
  ];

  function findNextButton() {
    for (const selector of nextButtonSelectors) {
      try {
        const buttons = document.querySelectorAll(selector);
        for (const btn of buttons) {
          const text = btn.textContent.toLowerCase().trim();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          const title = (btn.getAttribute('title') || '').toLowerCase();
          const className = (typeof btn.className === 'string' ? btn.className : btn.getAttribute('class') || '').toLowerCase();

          // Use word-boundary checks to avoid matching "copyright", "all-rights", etc.
          const classHasNext = /\bnext\b/.test(className);
          const classHasRight = /\barrow[-_]?right\b|\bright[-_]?arrow\b|\bslide[-_]?right\b/.test(className);
          const classHasForward = /\bforward\b/.test(className);

          if (text === '>' || text === '\u203a' || text === '\u00bb' || text === '\u2192' ||
              text.includes('next') ||
              ariaLabel.includes('next') || ariaLabel.includes('forward') ||
              title.includes('next') ||
              classHasNext || classHasRight || classHasForward) {
            return btn;
          }
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  let nextButton = findNextButton();

  if (nextButton) {
    console.log('scrapePage: Found next button, clicking through gallery...');
    let clickCount = 0;
    const maxClicks = 50;

    while (clickCount < maxClicks) {
      try {
        // Check if button is disabled (end of gallery)
        if (nextButton.disabled ||
            nextButton.classList.contains('disabled') ||
            nextButton.getAttribute('aria-disabled') === 'true') {
          console.log('scrapePage: Reached end of gallery');
          break;
        }

        nextButton.click();
        clickCount++;
        console.log(`scrapePage: Gallery click ${clickCount}`);

        // Wait for images to load
        await new Promise(resolve => setTimeout(resolve, 400));

        // Re-find the next button (React may re-render it)
        nextButton = findNextButton();

        if (!nextButton) {
          console.log('scrapePage: Next button disappeared');
          break;
        }

      } catch (e) {
        console.log('scrapePage: Error clicking gallery:', e.message);
        break;
      }
    }
    console.log(`scrapePage: Clicked through gallery ${clickCount} times`);
  } else {
    console.log('scrapePage: No next button found');
  }

  const originalScroll = window.scrollY;

  // Scroll to bottom to trigger lazy loading
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise(resolve => setTimeout(resolve, 800));

  // Scroll back to top
  window.scrollTo(0, 0);
  await new Promise(resolve => setTimeout(resolve, 500));

  // Restore original position
  window.scrollTo(0, originalScroll);

  // Extract VIN (17 character alphanumeric)
  const vinPattern = /\b([A-HJ-NPR-Z0-9]{17})\b/;
  const bodyText = document.body.innerText;
  console.log('scrapePage: Body text length:', bodyText.length);

  try {
    const vinMatch = bodyText.match(vinPattern);
    if (vinMatch) {
      data.vin = vinMatch[1];
      console.log('scrapePage: Found VIN:', data.vin);
    } else {
      console.log('scrapePage: No VIN found in body text');
    }
  } catch (e) {
    console.error('scrapePage: Error extracting VIN:', e);
  }

  // Try to find VIN in common selectors
  try {
    const vinSelectors = [
      '[data-test-id="vin"]',
      '.vin',
      '#vin',
      '[class*="vin"]',
      '[class*="VIN"]',
    ];

    for (const selector of vinSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.textContent.trim();
        const match = text.match(vinPattern);
        if (match) {
          data.vin = match[1];
          console.log('scrapePage: Found VIN in selector:', data.vin);
          break;
        }
      }
    }
  } catch (e) {
    console.error('scrapePage: Error finding VIN in selectors:', e);
  }

  // Extract vehicle info (Year Make Model)
  try {
    const vehiclePatterns = [
      /(\d{4})\s+([A-Z][a-zA-Z-]+)\s+([A-Za-z0-9\s-]+)/,
      /Year:\s*(\d{4}).*Make:\s*([A-Za-z-]+).*Model:\s*([A-Za-z0-9\s-]+)/i
    ];

    for (const pattern of vehiclePatterns) {
      const match = bodyText.match(pattern);
      if (match) {
        data.vehicle = `${match[1]} ${match[2]} ${match[3]}`.trim();
        console.log('scrapePage: Found vehicle:', data.vehicle);
        break;
      }
    }
  } catch (e) {
    console.error('scrapePage: Error extracting vehicle:', e);
  }

  // Extract odometer - improved patterns
  try {
    const odoPatterns = [
      /(?:Odometer|Odo|Mileage)[:\s]*([0-9,]+)\s*(?:mi|miles|km)?/i,
      /([0-9,]+)\s*(?:mi|miles)\b/i,
      /\b([0-9,]+)\s*(?:Actual|Exempt|TMU|Miles?)\b/i,
      /(?:Actual|Current)\s*(?:Miles?|Mileage)[:\s]*([0-9,]+)/i
    ];

    for (const pattern of odoPatterns) {
      const odoMatch = bodyText.match(pattern);
      if (odoMatch) {
        data.odometer = odoMatch[1].replace(/,/g, '');
        console.log('scrapePage: Found odometer:', data.odometer);
        break;
      }
    }

    // Also try to find in specific elements
    if (!data.odometer) {
      const odoSelectors = [
        '[class*="odometer"]',
        '[class*="mileage"]',
        '[data-test*="odometer"]',
        '[data-test*="mileage"]'
      ];

      for (const selector of odoSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          const text = element.textContent;
          const match = text.match(/([0-9,]+)/);
          if (match) {
            data.odometer = match[1].replace(/,/g, '');
            console.log('scrapePage: Found odometer in selector:', data.odometer);
            break;
          }
        }
      }
    }
  } catch (e) {
    console.error('scrapePage: Error extracting odometer:', e);
  }

  // Extract tire information from TIRES AND WHEELS section
  try {
    console.log('scrapePage: Extracting tire information...');

    const tireInfo = [];
    const allText = bodyText.toLowerCase();

    // Method 1: Look for "TIRES AND WHEELS" section with visual diagram
    const tiresSectionIndex = allText.indexOf('tires and wheels');

    if (tiresSectionIndex !== -1) {
      console.log('scrapePage: Found TIRES AND WHEELS section at index', tiresSectionIndex);

      const tiresSection = bodyText.substring(tiresSectionIndex, tiresSectionIndex + 2000);
      const lines = tiresSection.split('\n').map(l => l.trim()).filter(l => l);

      console.log('scrapePage: TIRES section found, extracting depths...');

      const positionMap = {
        'Left Front': null,
        'Right Front': null,
        'Left Rear': null,
        'Right Rear': null,
        'Spare': null
      };

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line === 'Left Front' || line === 'Right Front' ||
            line === 'Left Rear' || line === 'Right Rear' ||
            line === 'Spare') {

          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            const nextLine = lines[j].trim();

            if (nextLine === '--') continue;

            if (nextLine.match(/\d+\/\d+/) || nextLine.toLowerCase() === 'n/a') {
              // Skip legend entries
              if (!nextLine.includes('+') && !nextLine.includes(' to ') && !nextLine.includes('< ')) {
                positionMap[line] = nextLine;
                console.log(`scrapePage: Found ${line}: ${nextLine}`);
                break;
              }
            }
          }
        }
      }

      const positions = ['Left Front', 'Right Front', 'Left Rear', 'Right Rear', 'Spare'];
      for (const pos of positions) {
        if (positionMap[pos]) {
          tireInfo.push(`${pos}: ${positionMap[pos]}`);
        }
      }

      console.log('scrapePage: Tire extraction complete - found', tireInfo.length, 'tires');
    } else {
      console.log('scrapePage: TIRES AND WHEELS section not found in body text');
    }

    // Only run additional methods if we didn't find enough tires
    if (tireInfo.length < 4) {
      console.log('scrapePage: Only found', tireInfo.length, 'tires, trying additional methods...');

      // Method 2: Search targeted elements for tire depth data
      console.log('scrapePage: Searching DOM for tire depth values...');

      const tireContainers = document.querySelectorAll(
        '[class*="tire" i], [class*="tread" i], [class*="wheel" i], ' +
        '[data-test*="tire" i], [data-test*="tread" i]'
      );
      const depthElements = [];

      // Search within tire-related containers first
      const searchScope = tireContainers.length > 0 ? tireContainers : [document.body];

      for (const container of searchScope) {
        const elements = container.querySelectorAll('*');
        for (const el of elements) {
          const text = el.textContent?.trim() || '';
          if (/^(\d+\/\d+"|n\/a)$/i.test(text) && text.length < 10) {
            depthElements.push({ element: el, text: text });
          }
        }
      }

      console.log('scrapePage: Found', depthElements.length, 'elements with depth values');

      if (depthElements.length >= 4) {
        const positions = ['Left Front', 'Right Front', 'Left Rear', 'Right Rear', 'Spare'];

        for (const pos of positions) {
          // Search within tire containers for position labels
          for (const container of searchScope) {
            const elements = container.querySelectorAll('*');
            for (const el of elements) {
              const text = el.textContent?.trim() || '';
              if (text.toLowerCase() === pos.toLowerCase() && text.length < 20) {
                const parent = el.parentElement;
                if (parent) {
                  const siblings = Array.from(parent.children);
                  const index = siblings.indexOf(el);

                  for (let i = index + 1; i < Math.min(index + 10, siblings.length); i++) {
                    const siblingText = siblings[i].textContent?.trim() || '';
                    const depthMatch = siblingText.match(/^(\d+\/\d+"|n\/a)$/i);
                    if (depthMatch) {
                      const entry = `${pos}: ${depthMatch[1]}`;
                      if (!tireInfo.includes(entry)) {
                        tireInfo.push(entry);
                        console.log('scrapePage: Found tire from DOM proximity:', entry);
                      }
                      break;
                    }
                  }
                }
              }
            }
          }
        }
      }

      // Method 3: Check for tire data in table format
      const allTables = document.querySelectorAll('table, [role="table"]');
      for (const table of allTables) {
        const tableText = table.textContent.toLowerCase();
        if (tableText.includes('tire') || tableText.includes('tread') || tableText.includes('wheel')) {
          console.log('scrapePage: Found tire-related table');

          const rows = table.querySelectorAll('tr, [role="row"]');
          for (const row of rows) {
            const cells = row.querySelectorAll('td, th, [role="cell"]');

            if (cells.length >= 3) {
              const cell1 = cells[0]?.textContent?.trim() || '';
              const cell2 = cells[1]?.textContent?.trim() || '';
              const cell3 = cells[2]?.textContent?.trim() || '';

              const cell1Lower = cell1.toLowerCase();
              const isTirePosition = (cell1Lower.includes('front') || cell1Lower.includes('rear') || cell1Lower.includes('spare')) &&
                                     (cell1Lower.includes('left') || cell1Lower.includes('right') || cell1Lower === 'spare');

              let depth = null;
              if (/\d+\/\d+"|n\/a/i.test(cell2)) depth = cell2;
              else if (/\d+\/\d+"|n\/a/i.test(cell3)) depth = cell3;

              if (isTirePosition && depth) {
                const entry = `${cell1}: ${depth}`;
                if (!tireInfo.includes(entry)) {
                  tireInfo.push(entry);
                  console.log('scrapePage: Found tire from table (3-col):', entry);
                }
              }
            } else if (cells.length >= 2) {
              const cell1 = cells[0]?.textContent?.trim() || '';
              const cell2 = cells[1]?.textContent?.trim() || '';

              const cell1Lower = cell1.toLowerCase();
              const isTirePosition = (cell1Lower.includes('front') || cell1Lower.includes('rear') || cell1Lower.includes('spare')) &&
                                     (cell1Lower.includes('left') || cell1Lower.includes('right') || cell1Lower === 'spare');

              if (isTirePosition && /\d+\/\d+|n\/a/i.test(cell2)) {
                const entry = `${cell1}: ${cell2}`;
                if (!tireInfo.includes(entry)) {
                  tireInfo.push(entry);
                  console.log('scrapePage: Found tire from table (2-col):', entry);
                }
              }
            }
          }
        }
      }
    }

    // Remove duplicates while preserving order
    data.tires = [...new Set(tireInfo)];
    console.log('scrapePage: Total tire entries found:', data.tires.length);
    console.log('scrapePage: Tire data:', data.tires);

  } catch (e) {
    console.error('scrapePage: Error extracting tire info:', e);
  }

  // Extract condition score
  try {
    const scorePattern = /(\d\.\d)\s*(Extra Clean|Clean|Average|Rough)/i;
    const scoreMatch = bodyText.match(scorePattern);
    if (scoreMatch) {
      data.conditionScore = scoreMatch[0];
      console.log('scrapePage: Found condition score:', data.conditionScore);
    }
  } catch (e) {
    console.error('scrapePage: Error extracting condition score:', e);
  }

  // Extract stock number
  try {
    const stockPattern = /(?:Stock|Stock #|Stock No)[:\s#]*([0-9A-Z-]+)/i;
    const stockMatch = bodyText.match(stockPattern);
    if (stockMatch) {
      data.stockNumber = stockMatch[1];
      console.log('scrapePage: Found stock number:', data.stockNumber);
    }
  } catch (e) {
    console.error('scrapePage: Error extracting stock number:', e);
  }

  // Extract damages from CONDITION DETAILS table (OVE format)
  try {
    console.log('scrapePage: Extracting condition details...');

    let foundStructured = false;

    // Method 1: Try to find ALL tables and rows in the document
    const allTables = document.querySelectorAll('table, tbody, [role="table"]');
    console.log('scrapePage: Found', allTables.length, 'tables in document');

    for (const table of allTables) {
      const rows = table.querySelectorAll('tr, [role="row"]');
      console.log('scrapePage: Checking table with', rows.length, 'rows');

      for (const row of rows) {
        const cells = row.querySelectorAll('td, th, [role="cell"], [role="columnheader"]');

        if (cells.length >= 2) {
          const description = cells[0]?.textContent?.trim() || '';
          const condition = cells[1]?.textContent?.trim() || '';

          // Skip headers and empty rows
          if (!description || !condition ||
              description.toLowerCase() === 'description' ||
              condition.toLowerCase() === 'condition' ||
              description.length < 3 ||
              condition.length < 2) {
            continue;
          }

          // Skip headers and section titles
          if (description.toLowerCase().includes('exterior') && description.length < 20) continue;
          if (description.toLowerCase().includes('interior') && description.length < 20) continue;
          if (description.toLowerCase().includes('other') && description.length < 20) continue;

          // Skip "No Announcements" type messages
          if (description.toLowerCase().includes('no announcement') ||
              description.toLowerCase().includes('no remark')) {
            continue;
          }

          // Look for damage-like patterns
          const damageWords = ['scratch', 'dent', 'worn', 'damage', 'paint', 'torn', 'stained',
                              'crack', 'rust', 'faded', 'depth', 'tread', 'tire',
                              'broken', 'missing', 'chipped', 'chip', 'curb', 'rash',
                              'scuff', 'repair', 'misalign', 'bent', 'gouge', 'peel'];
          const hasDescription = damageWords.some(word => description.toLowerCase().includes(word));
          const hasCondition = damageWords.some(word => condition.toLowerCase().includes(word));

          // Also accept car part names (including Manheim abbreviations)
          const carParts = ['hood', 'door', 'fender', 'bumper', 'panel', 'seat', 'quarter',
                           'roof', 'wheel', 'tire', 'grille', 'mirror', 'light', 'headlight',
                           'taillamp', 'headlamp', 'taillight', 'rocker', 'pillar', 'cover',
                           'molding', 'garnish', 'spoiler', 'valance', 'skirt', 'windshield',
                           'deck', 'lid', 'tow hook',
                           'window', 'trunk', 'tailgate', 'liftgate', 'running board',
                           'step', 'bedside', 'cab corner', 'a pillar', 'b pillar', 'c pillar'];
          const hasPart = carParts.some(part => description.toLowerCase().includes(part));

          if ((hasDescription || hasCondition || hasPart) && condition.toLowerCase() !== '--') {
            const damageStr = `${description}: ${condition}`;
            if (!data.damages.includes(damageStr)) {
              data.damages.push(damageStr);
              foundStructured = true;
              console.log('scrapePage: Found damage:', damageStr);
            }
          }
        }
      }
    }

    console.log('scrapePage: Structured extraction found:', data.damages.length, 'damages');

    // Method 2: Search body text for condition details patterns
    if (!foundStructured || data.damages.length < 3) {
      console.log('scrapePage: Trying text pattern extraction...');

      const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);

      let inConditionSection = false;
      let sectionCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineLower = line.toLowerCase();

        if (/^(exterior|interior|other)\s*\(\d+\)/i.test(line)) {
          inConditionSection = true;
          sectionCount++;
          console.log('scrapePage: Found section:', line);
          continue;
        }

        if (inConditionSection && (lineLower.includes('diagnostic') ||
                                    lineLower.includes('overview') ||
                                    lineLower.includes('equipment'))) {
          inConditionSection = false;
          continue;
        }

        if (inConditionSection && sectionCount > 0) {
          if (lineLower === 'description' || lineLower === 'condition' ||
              lineLower === 'status' || lineLower === 'image' ||
              lineLower === 'additional info' || lineLower === '--') {
            continue;
          }

          const carParts = ['hood', 'door', 'fender', 'bumper', 'panel', 'seat', 'quarter',
                           'roof', 'wheel', 'tire', 'grille', 'mirror', 'window', 'trunk',
                           'tailgate', 'headlight', 'taillamp', 'headlamp', 'light', 'cover',
                           'molding', 'garnish', 'spoiler', 'rocker', 'pillar', 'windshield',
                           'valance', 'skirt', 'running board', 'bedside', 'liftgate'];
          const hasPart = carParts.some(part => lineLower.includes(part));
          const hasPosition = lineLower.includes('driver') || lineLower.includes('passenger') ||
                             lineLower.includes('front') || lineLower.includes('rear') ||
                             lineLower.includes('left') || lineLower.includes('right') ||
                             /^[lr][fr]\s/i.test(line) || /^[fr]\s/i.test(line);

          if ((hasPart || hasPosition) && line.length > 3 && line.length < 80) {
            console.log(`scrapePage: Potential description line: "${line}"`);

            let nextValidLine = null;
            let nextIndex = -1;

            for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
              const candidateLine = lines[j].trim();
              if (candidateLine && candidateLine !== '--' &&
                  candidateLine.toLowerCase() !== 'status' &&
                  candidateLine.toLowerCase() !== 'image' &&
                  candidateLine.toLowerCase() !== 'additional info') {
                nextValidLine = candidateLine;
                nextIndex = j;
                break;
              }
            }

            if (nextValidLine) {
              const nextLower = nextValidLine.toLowerCase();

              const conditionWords = ['scratch', 'dent', 'worn', 'damage', 'paint', 'torn',
                                      'stained', 'crack', 'rust', 'faded', 'below', 'depth', 'small',
                                      'broken', 'missing', 'chipped', 'chip', 'curb', 'rash',
                                      'scuff', 'repair', 'misalign', 'bent', 'gouge', 'peel'];
              const isCondition = conditionWords.some(word => nextLower.includes(word)) ||
                                 /\d+\/\d+/.test(nextValidLine);

              if (isCondition && nextValidLine.length < 100) {
                const damageStr = `${line}: ${nextValidLine}`;
                if (!data.damages.includes(damageStr)) {
                  data.damages.push(damageStr);
                  foundStructured = true;
                  console.log('scrapePage: Found damage from text:', damageStr);
                  i = nextIndex;
                }
              }
            }
          }
        }
      }
    }

    console.log('scrapePage: After text extraction:', data.damages.length, 'damages');

    // Method 3: Try div-based layouts (not tables)
    if (!foundStructured) {
      console.log('scrapePage: Trying div-based extraction...');

      const allDivs = document.querySelectorAll('div[class*="row"], div[role="row"]');
      console.log('scrapePage: Found', allDivs.length, 'div rows');

      for (const row of allDivs) {
        const cells = row.querySelectorAll('div[class*="cell"], div[role="cell"], div[class*="col"]');

        if (cells.length >= 2) {
          const description = cells[0]?.textContent?.trim() || '';
          const condition = cells[1]?.textContent?.trim() || '';

          if (!description || !condition || description.length < 3 || condition.length < 2) {
            continue;
          }

          const damageWords = ['scratch', 'dent', 'worn', 'damage', 'paint', 'torn', 'stained',
                              'crack', 'rust', 'faded', 'depth', 'tread', 'tire', 'curb',
                              'chip', 'scuff', 'misalign', 'prev repair', 'broken', 'missing',
                              'bent', 'gouge', 'peel', 'repair', 'rash'];
          const carParts = ['hood', 'door', 'fender', 'bumper', 'panel', 'seat', 'quarter',
                           'roof', 'wheel', 'tire', 'grille', 'mirror', 'light', 'cover',
                           'molding', 'garnish', 'spoiler', 'rocker', 'pillar', 'windshield',
                           'tailgate', 'liftgate', 'headlamp', 'taillamp', 'trunk',
                           'deck', 'lid', 'tow hook'];

          const hasRelevantInfo = damageWords.some(word =>
            description.toLowerCase().includes(word) || condition.toLowerCase().includes(word)
          ) || carParts.some(part => description.toLowerCase().includes(part));

          if (hasRelevantInfo && condition.toLowerCase() !== '--') {
            const damageStr = `${description}: ${condition}`;
            if (!data.damages.includes(damageStr)) {
              data.damages.push(damageStr);
              foundStructured = true;
              console.log('scrapePage: Found damage in div:', damageStr);
            }
          }
        }
      }
    }

    console.log('scrapePage: Structured extraction found:', data.damages.length, 'damages');

    // Method 4: Fallback to keyword search if structured search found very few results
    if (!foundStructured || data.damages.length < 2) {
      console.log('scrapePage: Falling back to keyword search (found', data.damages.length, 'so far)...');

      const damageKeywords = [
        'worn', 'torn', 'stained', 'dent', 'scratch', 'crack', 'chip', 'chipped',
        'rust', 'damaged', 'broken', 'missing', 'check engine',
        'tpms', 'leak', 'noise', 'smoke', 'faded', 'scuffed',
        'curb rash', 'prev repair', 'misalign', 'bent', 'gouge', 'peel'
      ];

      const specKeywords = [
        'airbag', 'abs', 'anti-roll', 'shock absorber', 'gvwr', 'ratio',
        'disc brake', 'stability control', 'traction control', 'emissions',
        'child safety', 'side impact', 'dual stage', 'occupancy sensor',
        'parking brake', 'hill hold', 'brake assist', 'curtain', 'security',
        'electric', 'gas-pressurized', 'front and rear', 'safety',
        'noise cancellation', 'active noise', 'bose', 'premium audio',
        'navigation', 'bluetooth', 'heated seat', 'cooled seat',
        'sunroof', 'moonroof', 'backup camera', 'lane departure',
        'blind spot', 'adaptive cruise', 'keyless', 'remote start'
      ];

      const lines = document.body.innerText.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const lineLower = line.toLowerCase();

        if (line.length > 150) continue;

        const isSpec = specKeywords.some(spec => lineLower.includes(spec));
        if (isSpec) continue;

        for (const keyword of damageKeywords) {
          if (lineLower.includes(keyword)) {
            const hasLocation = /\b(front|rear|left|right|driver|passenger|hood|door|fender|bumper|panel|quarter|seat|interior|exterior)\b/i.test(line);

            if (hasLocation || line.length < 60) {
              if (!data.damages.some(d => d.toLowerCase().includes(lineLower))) {
                data.damages.push(line.substring(0, 150));
              }
            }
            break;
          }
        }
      }
    }

    // Remove duplicates and empty entries — normalize separators to catch
    // the same damage rendered with different delimiters (parentheses, pipe, dash)
    function normalizeDamage(str) {
      return str
        .replace(/\s*\(([^)]+)\)\s*/g, ' $1')   // "Panel (Dent)" → "Panel Dent"
        .replace(/\s*\|\s*/g, ' ')                // "Panel| Dent"  → "Panel Dent"
        .replace(/\s*-\s*/g, ' ')                 // "Panel- Dent"  → "Panel Dent"
        .replace(/\s*:\s*/g, ' ')                 // "Panel: Dent"  → "Panel Dent"
        .replace(/\s+/g, ' ')                     // collapse whitespace
        .trim()
        .toLowerCase();
    }

    const seenNormalized = new Set();
    data.damages = data.damages.filter(d => {
      if (!d || d.length <= 5) return false;
      const key = normalizeDamage(d);
      if (seenNormalized.has(key)) return false;
      seenNormalized.add(key);
      return true;
    });
    console.log('scrapePage: Total damages found (after dedup):', data.damages.length);
  } catch (e) {
    console.error('scrapePage: Error extracting damages:', e);
  }

  // Extract all images (focus on real vehicle photos only)
  try {
    console.log('scrapePage: Starting image extraction...');
    const seenKeys = new Set();

    // Normalize URL for dedup — strip resize/quality params so thumb + full-size
    // versions of the same image don't both get downloaded
    function normalizeForDedup(url) {
      try {
        const u = new URL(url);
        for (const p of ['w','h','width','height','quality','q','size','resize','fmt','format']) {
          u.searchParams.delete(p);
        }
        return u.origin + u.pathname;
      } catch { return url; }
    }

    // Reject junk URLs (icons, logos, tracking pixels, non-vehicle images)
    function isJunk(url) {
      if (!url || url.startsWith('data:') || url.startsWith('blob:')) return true;
      const lower = url.toLowerCase();
      const junk = [
        'icon', 'logo', 'sprite', 'avatar', 'badge', 'favicon',
        'tracking', 'pixel', 'analytics', 'beacon',
        '.svg', '.gif', 'spacer', 'blank', 'placeholder',
        'spinner', 'loading', 'google', 'facebook', 'twitter',
        'doubleclick', 'adsystem',
        'fyuse.com', 'strike-assets', 'ready_logistics',
        'arr-h.png', 'sv4.png', 'back.png'
      ];
      return junk.some(p => lower.includes(p));
    }

    function addImage(url, source) {
      if (!url || isJunk(url)) return false;
      try { url = new URL(url, window.location.href).href; } catch { return false; }

      // Strip thumbnail size params so we get full-size images from the CDN
      // e.g. ?size=w86h64 → removed → CDN returns original resolution
      try {
        const u = new URL(url);
        u.searchParams.delete('size');
        url = u.href;
      } catch {}

      const key = normalizeForDedup(url);
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      data.images.push({
        url: url,
        alt: `vehicle_image_${data.images.length + 1}`,
        index: data.images.length + 1
      });
      console.log(`scrapePage: [${source}] Added image #${data.images.length}: ${url.substring(0, 100)}`);
      return true;
    }

    // Collect all URLs from an <img> element (src, data-*, srcset)
    function collectFromImg(img, source) {
      // All possible src attributes
      const srcAttrs = ['src', 'data-src', 'data-lazy-src', 'data-original',
                        'data-full', 'data-large', 'data-zoom', 'data-hi-res'];
      for (const attr of srcAttrs) {
        const val = img.getAttribute(attr);
        if (val) addImage(val, source + '/' + attr);
      }
      // Also check .src property (resolves relative URLs)
      if (img.src) addImage(img.src, source + '/prop');

      // srcset — pick the largest variant
      const srcset = img.getAttribute('srcset');
      if (srcset) {
        let bestUrl = null;
        let bestWidth = 0;
        srcset.split(',').forEach(entry => {
          const parts = entry.trim().split(/\s+/);
          if (parts.length >= 1) {
            const w = parseInt((parts[1] || '0').replace('w', ''));
            if (!bestUrl || w > bestWidth) {
              bestUrl = parts[0];
              bestWidth = w;
            }
          }
        });
        if (bestUrl) addImage(bestUrl, source + '/srcset');
      }
    }

    // --- Method 1: Every <img> on the page (skip tiny ones) ---
    const allImgs = document.querySelectorAll('img');
    console.log('scrapePage: Found', allImgs.length, 'img elements total');
    allImgs.forEach(img => {
      // Skip images that are rendered very small (icons, thumbnails under 100px)
      if (img.naturalWidth > 0 && img.naturalWidth < 100 && img.naturalHeight < 100) return;
      collectFromImg(img, 'img');
    });

    // --- Method 2: <picture> > <source> elements ---
    const sources = document.querySelectorAll('picture source');
    sources.forEach((source) => {
      const srcset = source.getAttribute('srcset');
      if (srcset) {
        let bestUrl = null;
        let bestWidth = 0;
        srcset.split(',').forEach(entry => {
          const parts = entry.trim().split(/\s+/);
          if (parts.length >= 1) {
            const w = parseInt((parts[1] || '0').replace('w', ''));
            if (!bestUrl || w > bestWidth) {
              bestUrl = parts[0];
              bestWidth = w;
            }
          }
        });
        if (bestUrl) addImage(bestUrl, 'picture-source');
      }
    });

    // --- Method 3: CSS background-image on any element ---
    const allElements = document.querySelectorAll('div, span, a, li, figure, section');
    let bgCount = 0;
    allElements.forEach((el) => {
      const bg = el.style.backgroundImage || '';
      if (bg && bg !== 'none' && bg.includes('url(')) {
        const urlMatch = bg.match(/url\(["']?(.+?)["']?\)/);
        if (urlMatch) {
          if (addImage(urlMatch[1], 'bg-inline')) bgCount++;
        }
      }
    });
    console.log('scrapePage: Found', bgCount, 'background images');

    // --- Method 4: Scan all <a> links that point to image files ---
    const allLinks = document.querySelectorAll('a[href]');
    allLinks.forEach(a => {
      const href = a.href;
      if (!href) return;
      const lower = href.toLowerCase();
      if ((lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.png') || lower.includes('.webp')) &&
          !isJunk(href)) {
        addImage(href, 'a-href');
      }
    });

    // --- Method 5: Scan page source for image URL patterns ---
    // This catches URLs embedded in JS data/props that aren't in the DOM yet
    const pageHtml = document.documentElement.innerHTML;
    const urlRegex = /https?:\/\/[^\s"'<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/gi;
    let htmlMatch;
    let htmlUrlCount = 0;
    while ((htmlMatch = urlRegex.exec(pageHtml)) !== null) {
      if (addImage(htmlMatch[0], 'html-regex')) htmlUrlCount++;
    }
    console.log('scrapePage: Found', htmlUrlCount, 'images from HTML source scan');

    // Log final count + first few URLs for debugging
    console.log('scrapePage: Total unique vehicle images:', data.images.length);
    if (data.images.length > 0) {
      console.log('scrapePage: First 3 URLs:', data.images.slice(0, 3).map(i => i.url));
    } else {
      console.log('scrapePage: WARNING - No images found! Page might use iframes or shadow DOM.');
      // Last resort: check for iframes
      const iframes = document.querySelectorAll('iframe');
      console.log('scrapePage: Found', iframes.length, 'iframes on page');
      iframes.forEach((iframe, idx) => {
        console.log(`scrapePage: iframe[${idx}] src=${iframe.src?.substring(0, 100)}`);
      });
    }
  } catch (e) {
    console.error('scrapePage: Error extracting images:', e);
  }

  // Extract damages from page
  try {
    console.log('scrapePage: Extracting damages...');
    
    // Look for DAMAGES section in the page
    const damageSelectors = [
      '[class*="damage"]',
      '[class*="condition"]', 
      '[data-test*="damage"]',
      '[data-test*="condition"]'
    ];
    
    // First try to find damages in structured elements
    for (const selector of damageSelectors) {
      const elements = document.querySelectorAll(selector);
      console.log(`scrapePage: Checking damage selector "${selector}": found ${elements.length} elements`);
      
      elements.forEach(el => {
        const text = el.textContent.trim();
        // Look for pipe-separated damage format: "Location | Type"
        const pipeMatch = text.match(/^([A-Za-z\s]+[A-Za-z])\s*\|\s*([A-Za-z\s]+)$/);
        if (pipeMatch) {
          const location = pipeMatch[1].trim();
          const type = pipeMatch[2].trim();
          const damageStr = `${location} - ${type}`;
          if (!data.damages.includes(damageStr)) {
            data.damages.push(damageStr);
            console.log('scrapePage: Found damage in DOM:', damageStr);
          }
        }
      });
    }
    
    // Also scan body text for DAMAGES section
    const lines = bodyText.split('\n');
    let inDamagesSection = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Look for DAMAGES section header
      if (line.toLowerCase().includes('damages') || line.toLowerCase() === 'damages') {
        inDamagesSection = true;
        continue;
      }
      
      // Exit damages section if we hit another section
      if (inDamagesSection && line.match(/^(DISCLOSURES|SEATING|OPTIONS|ANNOUNCEMENTS|TIRES)/i)) {
        break;
      }
      
      // Extract damages in pipe format
      if (inDamagesSection) {
        const pipeMatch = line.match(/^([A-Za-z\s]+[A-Za-z])\s*\|\s*([A-Za-z\s]+)$/);
        if (pipeMatch) {
          const location = pipeMatch[1].trim();
          const type = pipeMatch[2].trim();
          
          // Check next line for severity
          let severity = '';
          if (i + 1 < lines.length) {
            const severityMatch = lines[i + 1].match(/severity[:\s]+(.+)/i);
            if (severityMatch) {
              severity = ` (${severityMatch[1].trim()})`;
            }
          }
          
          const damageStr = `${location} - ${type}${severity}`;
          if (!data.damages.includes(damageStr)) {
            data.damages.push(damageStr);
            console.log('scrapePage: Found damage in body text:', damageStr);
          }
        }
      }
    }
    
    console.log('scrapePage: Damage extraction complete - found', data.damages.length, 'damages');
  } catch (e) {
    console.error('scrapePage: Error extracting damages:', e);
  }

  // Extract announcements and remarks
  try {
    console.log('scrapePage: Extracting announcements...');

    // Targeted selectors — avoid overly broad ones like [class*="alert"]
    const announcementSelectors = [
      '[class*="announcement"]',
      '[class*="seller-remark"]',
      '[class*="seller-comment"]',
      '[class*="vehicle-notice"]',
      '[class*="listing-remark"]',
      '[data-test*="announcement"]',
      '[data-test*="remark"]'
    ];

    const seenAnnouncements = new Set();

    for (const selector of announcementSelectors) {
      const elements = document.querySelectorAll(selector);
      console.log(`scrapePage: Checking selector "${selector}": found ${elements.length} elements`);

      elements.forEach(el => {
        const text = el.textContent.trim();

        if (!text || text.length < 10 || text.length > 1000) return;

        const textLower = text.toLowerCase();
        if (textLower.includes('no announcement') ||
            textLower.includes('no remark') ||
            (textLower.includes('announcement') && textLower.includes('comment') && text.length < 30)) {
          return;
        }

        if (!seenAnnouncements.has(textLower)) {
          seenAnnouncements.add(textLower);
          data.announcements.push(text);
        }
      });
    }

    // Also search body text for announcement patterns
    const announcementPattern = /(?:Announcement|Remark|Notice|Comment):\s*(.{20,500})/gi;
    const matches = bodyText.matchAll(announcementPattern);

    for (const match of matches) {
      const text = match[1].trim();
      const textLower = text.toLowerCase();

      if (!textLower.includes('no announcement') &&
          !textLower.includes('no remark') &&
          !seenAnnouncements.has(textLower)) {
        seenAnnouncements.add(textLower);
        data.announcements.push(text);
      }
    }

    // Scan announcements for real mechanical/safety issues → add to damages
    const issuePatterns = [
      { pattern: /transmission\s*problem/i,   damage: 'Transmission: Problem Reported' },
      { pattern: /engine\s*problem/i,         damage: 'Engine: Problem Reported' },
      { pattern: /check\s*engine/i,           damage: 'Dashboard: Check Engine Light' },
      { pattern: /abs\s*(light|issue|warning)/i, damage: 'Dashboard: ABS Warning Light' },
      { pattern: /airbag\s*(light|issue|warning)/i, damage: 'Dashboard: Airbag Warning Light' },
      { pattern: /srs\s*(light|issue|warning)/i, damage: 'Dashboard: SRS Warning Light' },
      { pattern: /tpms\s*(light|issue|warning)/i, damage: 'Dashboard: TPMS Warning Light' },
      { pattern: /oil\s*leak/i,               damage: 'Engine: Oil Leak' },
      { pattern: /coolant\s*leak/i,           damage: 'Engine: Coolant Leak' },
      { pattern: /ac\s*(not|inop|broken|issue|problem)/i, damage: 'HVAC: AC Issue' },
      { pattern: /frame\s*damage/i,           damage: 'Frame: Damage Reported' },
      { pattern: /flood\s*damage/i,           damage: 'Vehicle: Flood Damage' },
      { pattern: /structural\s*damage/i,      damage: 'Frame: Structural Damage' },
      { pattern: /salvage/i,                  damage: 'Title: Salvage' },
      { pattern: /rebuilt/i,                  damage: 'Title: Rebuilt' },
      { pattern: /yellow\s*light/i,           damage: 'Announcement: Yellow Light' },
      { pattern: /red\s*light/i,              damage: 'Announcement: Red Light' },
    ];

    const allAnnouncementText = data.announcements.join(' ');
    for (const { pattern, damage } of issuePatterns) {
      if (pattern.test(allAnnouncementText)) {
        if (!data.damages.includes(damage)) {
          data.damages.push(damage);
          console.log('scrapePage: Found issue in announcements:', damage);
        }
      }
    }

    console.log('scrapePage: Found announcements:', data.announcements.length);
  } catch (e) {
    console.error('scrapePage: Error extracting announcements:', e);
  }

  console.log('scrapePage: Completed. Data:', {
    vin: data.vin,
    vehicle: data.vehicle,
    odometer: data.odometer,
    images: data.images.length,
    damages: data.damages.length,
    tires: data.tires.length,
    announcements: data.announcements.length
  });

  return data;
}
