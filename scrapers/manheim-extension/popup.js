// Shared domain detection — single source of truth
function isAuctionSite(urlOrHostname) {
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
         hostname.endsWith('adesa.com') ||
         hostname.includes('marketplace.adesa') ||
         hostname.includes('simulcast') ||
         hostname.includes('crsimplified');
}

function getSiteType(hostname) {
  hostname = hostname.toLowerCase();
  if (hostname.endsWith('manheim.com') || hostname.endsWith('ove.com')) return 'manheim';
  if (hostname.endsWith('edgepipeline.com') || hostname.includes('simulcast')) return 'edge';
  if (hostname.endsWith('adesa.com') || hostname.includes('marketplace.adesa')) return 'adesa';
  return 'unknown';
}

function getSiteName(type) {
  switch(type) {
    case 'manheim': return 'Manheim/OVE';
    case 'edge': return 'Edge Pipeline';
    case 'adesa': return 'ADESA';
    default: return 'Unknown Site';
  }
}

document.addEventListener('DOMContentLoaded', async function() {
  const scrapeBtn = document.getElementById('scrapeBtn');
  const pdfUpload = document.getElementById('pdfUpload');
  const statusDiv = document.getElementById('status');
  const resultsDiv = document.getElementById('results');
  const siteInfoDiv = document.getElementById('siteInfo');

  // Show current page info
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.url) {
      const hostname = new URL(tab.url).hostname;
      const siteType = getSiteType(hostname);

      if (isAuctionSite(hostname)) {
        siteInfoDiv.className = `site-info ${siteType}`;
        siteInfoDiv.textContent = `Connected to ${getSiteName(siteType)}`;
        statusDiv.className = 'status success';
        statusDiv.textContent = `Ready to scrape`;
      } else {
        siteInfoDiv.className = 'site-info unknown';
        siteInfoDiv.textContent = `Current site: ${hostname}`;
        statusDiv.className = 'status error';
        statusDiv.textContent = `Not on a supported auction site`;
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

      const hostname = new URL(tab.url).hostname;
      const siteType = getSiteType(hostname);
      
      if (!isAuctionSite(tab.url)) {
        throw new Error(`Not on a supported auction site. Current: ${hostname}`);
      }

      statusDiv.textContent = 'Extracting data from page...';
      console.log('Step 2: Injecting scraper script...');

      // Use different scraping function based on site type
      let scrapeFunction;
      if (siteType === 'adesa') {
        // For ADESA, inject and run the scraping function directly
        console.log('Detected ADESA site, injecting scraper...');
        
        // Inject the ADESA scraping function
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: scrapeAdesaDirectly,
          // Stamp the build into the page's own console. Chrome serves the
          // extension it last loaded, so an edit on disk is not the code that
          // runs until you reload it — a fix looked broken for an hour because
          // the console it was judged by belonged to the previous build.
          args: [chrome.runtime.getManifest().version]
        });
        
        if (!results || !results[0]) {
          throw new Error('ADESA script execution returned no results');
        }
        
        const response = results[0].result;
        
        if (!response || !response.success) {
          throw new Error(response?.error || 'ADESA scraping failed');
        }
        
        const data = response;
        console.log('ADESA scraped data:', data);
        
        if (!data.vehicle?.vin) {
          throw new Error('Could not extract VIN from ADESA page');
        }
        
        // Format data to match expected structure
        let vehicleDescription = data.vehicle.title;
        if (!vehicleDescription && data.vehicle.year && data.vehicle.make && data.vehicle.model) {
          vehicleDescription = `${data.vehicle.year} ${data.vehicle.make} ${data.vehicle.model}`;
        } else if (!vehicleDescription) {
          // Try to extract from page title or any text containing the VIN
          vehicleDescription = document.title || 'Vehicle';
        }
        
        const formattedData = {
          vin: data.vehicle.vin,
          vehicle: vehicleDescription,
          odometer: data.vehicle.mileage,
          images: data.images || [],  // Already in correct format from scrapeAdesaDirectly
          damages: data.damages || [],
          tires: [],
          // The scraper records which page it read; without carrying it across,
          // every ADESA JSON saved source_url: "" and there was no way back to
          // the listing from the folder.
          url: data.url || '',
          ...data.vehicle
        };
        
        statusDiv.textContent = 'Sending to download...';
        await downloadData(formattedData);
        
        statusDiv.className = 'status success';
        statusDiv.textContent = 'ADESA scrape complete!';
        
        resultsDiv.innerHTML = `
          <div><strong>VIN:</strong> ${formattedData.vin}</div>
          <div><strong>Vehicle:</strong> ${formattedData.vehicle || 'N/A'}</div>
          <div><strong>Odometer:</strong> ${formattedData.odometer || 'N/A'}</div>
          <div><strong>Images:</strong> ${formattedData.images.length}</div>
          <div><strong>Damages:</strong> ${formattedData.damages.length}</div>
          <div style="margin-top: 10px; color: #666;">Downloads saving to: ${formattedData.vin}/</div>
        `;
        
        return; // Exit early for ADESA
      }

      // For Manheim/Edge, inject and execute the scraping script
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
  await new Promise(resolve => setTimeout(resolve, 200));

  // Auto-navigate through image gallery to load all images
  console.log('scrapePage: Looking for gallery navigation...');
  
  // Collection for gallery images found during navigation
  const galleryImageUrls = new Set();
  
  // Helper to find and capture the main gallery image
  function captureCurrentImage() {
    // Find the largest image on the page - that's likely the main gallery image
    let largestImg = null;
    let maxSize = 0;
    
    document.querySelectorAll('img').forEach(img => {
      if (img.offsetWidth > 400 && img.src && !img.src.includes('logo') && !img.src.includes('icon')) {
        const size = img.offsetWidth * img.offsetHeight;
        if (size > maxSize) {
          maxSize = size;
          largestImg = img;
        }
      }
    });
    
    if (largestImg && largestImg.src) {
      // Clean the URL
      let cleanUrl = largestImg.src;
      if (cleanUrl.includes('?')) {
        cleanUrl = cleanUrl.split('?')[0];
      }
      
      if (!galleryImageUrls.has(cleanUrl)) {
        galleryImageUrls.add(cleanUrl);
        console.log(`scrapePage: Found image #${galleryImageUrls.size}: ${cleanUrl}`);
        return true;
      }
    }
    
    // Also check all Manheim CDN images
    document.querySelectorAll('img[src*="images.cdn.manheim.com"]').forEach(img => {
      if (img.offsetWidth > 100) {
        let cleanUrl = img.src;
        if (cleanUrl.includes('?')) {
          cleanUrl = cleanUrl.split('?')[0];
        }
        
        if (!galleryImageUrls.has(cleanUrl)) {
          galleryImageUrls.add(cleanUrl);
          console.log(`scrapePage: Found Manheim image #${galleryImageUrls.size}: ${cleanUrl}`);
        }
      }
    });
    
    return false;
  }
  
  // Capture initial images
  console.log('scrapePage: Capturing initial images...');
  captureCurrentImage();
  
  // First try to click all thumbnail images to load full-size versions
  const thumbnailSelectors = [
    'img[class*="thumb"]',
    'img[class*="thumbnail"]',
    '[class*="thumbnail"] img',
    '[class*="thumb"] img',
    '[class*="gallery"] img[width]',
    '[class*="carousel"] img',
    '[role="button"] img',
    'button img',
    '[data-test*="thumbnail"] img',
    '.image-gallery-thumbnail img',
    '.gallery-thumb img'
  ];
  
  console.log('scrapePage: Looking for thumbnail images to click...');
  let thumbnailsClicked = false;
  
  for (const selector of thumbnailSelectors) {
    const thumbnails = document.querySelectorAll(selector);
    if (thumbnails.length > 3) { // Only if we find multiple thumbnails
      console.log(`scrapePage: Found ${thumbnails.length} thumbnails with selector: ${selector}`);
      
      for (let i = 0; i < thumbnails.length; i++) {
        try {
          const thumb = thumbnails[i];
          // Click the thumbnail or its parent if it's wrapped in a button/link
          const clickTarget = thumb.closest('button, a, [role="button"]') || thumb;
          
          console.log(`scrapePage: Clicking thumbnail ${i + 1}/${thumbnails.length}`);
          clickTarget.click();
          
          // Much shorter wait - just enough for src to update
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Capture the current image
          captureCurrentImage();
          
          thumbnailsClicked = true;
        } catch (e) {
          console.log(`scrapePage: Error clicking thumbnail ${i}:`, e.message);
        }
      }
      
      if (thumbnailsClicked) {
        console.log('scrapePage: Finished clicking through thumbnails');
        console.log(`scrapePage: Captured ${galleryImageUrls.size} unique gallery images`);
        break; // Don't try other selectors if we already clicked thumbnails
      }
    }
  }

  // If thumbnail clicking didn't work, try the next/forward button approach
  if (!thumbnailsClicked) {
    console.log('scrapePage: No thumbnails found, trying next button navigation...');
  }
  
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
    
    // Capture initial image before clicking
    captureCurrentImage();
    
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

        // Much shorter wait
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Capture the current image
        captureCurrentImage();

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
    console.log(`scrapePage: Captured ${galleryImageUrls.size} unique gallery images during navigation`);
  } else {
    console.log('scrapePage: No next button found');
  }

  const originalScroll = window.scrollY;

  // Quick scroll to trigger lazy loading
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise(resolve => setTimeout(resolve, 200));
  
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

    // Method 1b: CR Simplified layout. The heading is just "TIRES" and the
    // corners are abbreviated — LF / RF / LR / RR / SPARE — each followed by
    // brand, size, wheel type and tread ('7/32"'). Method 1 only knows Manheim's
    // wording ("TIRES AND WHEELS" + "Left Front"), so on a CR page it matched
    // nothing and every scrape came back with tires: [] even though the report
    // had a full set of tread depths on it.
    if (tireInfo.length === 0) {
      const CORNERS = {
        LF: 'Left Front', RF: 'Right Front', LR: 'Left Rear',
        RR: 'Right Rear', SPARE: 'Spare',
      };
      const headingIdx = bodyText.search(/^[ \t]*TIRES[ \t]*$/m);
      if (headingIdx !== -1) {
        const lines = bodyText.substring(headingIdx, headingIdx + 1500)
          .split('\n').map(l => l.trim()).filter(Boolean);
        for (let i = 0; i < lines.length; i++) {
          const corner = CORNERS[lines[i].toUpperCase()];
          if (!corner) continue;
          // Everything up to the next corner label belongs to this one.
          const fields = [];
          for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
            if (CORNERS[lines[j].toUpperCase()]) break;
            fields.push(lines[j]);
          }
          // Placeholders on an unrecorded spare read '--size--' / '-'.
          const tread = fields.find((f) => /^\d+\/\d+"?$/.test(f));
          const size = fields.find((f) => /^[PLT]{0,2}\d{3}\/\d{2}[A-Z]*R?\d{2}/i.test(f));
          tireInfo.push(`${corner}: ${tread || '--'}${size ? ` (${size})` : ''}`);
        }
        console.log('scrapePage: CR Simplified tire grid — found', tireInfo.length, 'tires');
      }
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

  // === Manheim INSIGHT/MABEL chargeables parser =========================
  // Scoped to Manheim's condition report (table#charges / summary="charges").
  // Those ids exist ONLY on Manheim MABEL pages, so every other auction
  // (ADESA, OVE, SmartAuction, etc.) leaves manheimHandled = false and runs
  // the original extraction logic below completely untouched.
  //
  // Why this exists: Manheim rows lead with an IMAGE cell, so the generic
  // table-walker reads cells[0] (the empty thumbnail) as the description and
  // skips every real row — then the keyword fallback scoops up layout
  // sections (abbreviation glossary, address, OPTIONS...) as bogus "damages".
  // The real line items are the left-aligned mainfont cells:
  //   [Description, Condition, Severity, Suggested Repair]   (cost is right-aligned)
  let manheimHandled = false;
  try {
    const chargesTable = document.querySelector('table#charges, table[summary="charges"]');
    if (chargesTable) {
      console.log('scrapePage: Manheim charges table detected — parsing line items');
      // Header / totals / section-label rows to ignore (matched on the description cell)
      const sectionRe = /^(TOTALS?|NON-CHARGEABLES?|CHARGEABLES?|DESCRIPTION|ITEM|RECON|ADDITIONAL)\b/i;
      // `tr` traversal is recursive and the table nests an additional-images block
      // and the recon-charges block — strip those so only real condition items remain.
      const imageRowRe = /Picture#|Overall Picture/i;   // additional-images rows
      const dateRowRe = /^\d{1,2}\/\d{1,2}\/\d{2,4}/;    // recon-charge rows (start with a date)
      const found = [];

      chargesTable.querySelectorAll('tr').forEach(row => {
        // Real line items: left-aligned data cells = [Desc, Condition, Severity, Suggested Repair].
        // Header rows use mainfontbold/mainfontheading and never match `td.mainfont`.
        const dataCells = Array.from(row.querySelectorAll('td.mainfont[align="left"]'))
          .map(td => (td.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim());

        if (dataCells.length < 2) return; // needs at least Description + Condition
        const [description, condition = '', severity = '', repair = ''] = dataCells;
        if (!description || sectionRe.test(description)) return;
        if (imageRowRe.test(description) || imageRowRe.test(condition)) return; // additional images
        if (dateRowRe.test(description)) return;                                // recon-charge rows

        // Cost is the right-aligned mainfont cell (last one in the row, e.g. "$.00")
        const rightCells = Array.from(row.querySelectorAll('td.mainfont[align="right"]'))
          .map(td => (td.textContent || '').replace(/ /g, ' ').trim());
        const cost = rightCells.length ? rightCells[rightCells.length - 1] : '';

        let damageStr = description;
        if (condition) damageStr += `: ${condition}`;
        if (severity && severity !== '--') damageStr += ` (${severity})`;
        if (repair && repair !== '--') damageStr += ` — ${repair}`;
        if (cost && cost !== '$.00' && cost !== '.00') damageStr += ` [${cost}]`;

        if (!found.includes(damageStr)) found.push(damageStr);
      });

      // Authoritative for Manheim: a charges table is the ground truth. Even when
      // it has zero line items (genuinely clean car), mark it handled so the
      // garbage keyword fallback can't manufacture phantom damages.
      data.damages = found;
      manheimHandled = true;
      console.log(`scrapePage: Manheim parser captured ${found.length} damage line item(s)`);
    }
  } catch (e) {
    console.error('scrapePage: Manheim charges parser error:', e);
  }

  // Extract damages from CONDITION DETAILS table (OVE format)
  if (!manheimHandled) try {
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

  // Quick final wait and capture
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // Do a final capture
  captureCurrentImage();
  
  // Add all captured images to data.images (works for all auction sites)
  console.log(`scrapePage: Total unique images found: ${galleryImageUrls.size}`);
  let vehicleImageCount = 0;
  for (const url of galleryImageUrls) {
    // Skip only data: and blob: URLs, include everything else
    // This works for Manheim, OVE, Edge Pipeline, CRS, fyuse, and any other auction site
    if (!url.startsWith('data:') && !url.startsWith('blob:')) {
      // Skip obvious non-vehicle images
      if (url.includes('logo') || url.includes('icon') || url.includes('sprite') || 
          url.includes('badge') || url.includes('button') || url.includes('.svg')) {
        continue;
      }
      
      data.images.push({
        url: url,
        alt: `vehicle_image_${data.images.length + 1}`,
        index: data.images.length + 1
      });
      vehicleImageCount++;
    }
  }
  console.log(`scrapePage: Added ${vehicleImageCount} vehicle images to download queue`);
  
  // Extract all images (focus on real vehicle photos only)
  try {
    console.log('scrapePage: Starting general image extraction...');
    const seenKeys = new Set([...galleryImageUrls]); // Start with gallery URLs as seen

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

      // Not an image at all. The CR's own page (…/inspection/<id>/cr.html) was
      // being queued as a photo: Chrome saved it as .html while the manifest
      // recorded it as _image_N.jpg, leaving a broken reference in data.json and
      // a web page sitting in the middle of the photo set.
      const path = lower.split('?')[0].split('#')[0];
      const ext = path.includes('.') ? path.split('.').pop() : '';
      if (ext && !['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext)) return true;

      // Site chrome lives under /static/ — that's where CRSimplified_large.png
      // (the report's own letterhead) comes from, and it carries no junk keyword.
      if (path.includes('/static/')) return true;

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

    // --- Method 0: Manheim-specific selectors ---
    // Try to find images in Manheim's specific gallery structure
    const manheimSelectors = [
      '[class*="image-gallery-image"] img',
      '[class*="gallery-main"] img',
      '[class*="main-image"] img',
      '[class*="vehicle-image"] img',
      '[class*="carousel-inner"] img',
      '.slick-slide img',
      '[data-test*="vehicle-image"] img'
    ];
    
    console.log('scrapePage: Trying Manheim-specific selectors...');
    for (const selector of manheimSelectors) {
      const imgs = document.querySelectorAll(selector);
      if (imgs.length > 0) {
        console.log(`scrapePage: Found ${imgs.length} images with selector: ${selector}`);
        imgs.forEach(img => collectFromImg(img, 'manheim-specific'));
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
  if (!manheimHandled) try {
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

// ADESA-specific scraping function that runs directly in the page context
async function scrapeAdesaDirectly(buildVersion) {
  const data = {
    success: false,
    vehicle: {},
    damages: [],
    images: [],
    error: null
  };
  
  // Wait a bit for dynamic content to load
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  try {
    // Extract VIN - look for it in multiple places
    let vin = null;
    
    // Method 1: Look for VIN in text with pattern
    const vinMatches = document.body.innerText.match(/VIN[:\s]+([A-Z0-9]{17})/i);
    if (vinMatches) {
      vin = vinMatches[1];
    }
    
    // Method 2: Look in specific elements
    if (!vin) {
      const vinElement = document.querySelector('[data-test-id="vin"], [class*="vin"], input[id*="vin"], input[name*="vin"]');
      if (vinElement) {
        vin = vinElement.value || vinElement.textContent?.trim();
        // Extract just the VIN if it's in a longer string
        const vinMatch = vin?.match(/([A-Z0-9]{17})/i);
        if (vinMatch) vin = vinMatch[1];
      }
    }
    
    // Method 3: Check the copy button area
    if (!vin) {
      const copyElements = Array.from(document.querySelectorAll('button, span')).filter(el => 
        el.textContent?.includes('Copy') || el.className?.includes('copy')
      );
      for (const el of copyElements) {
        const nearbyText = el.parentElement?.textContent || '';
        const vinMatch = nearbyText.match(/([A-Z0-9]{17})/i);
        if (vinMatch) {
          vin = vinMatch[1];
          break;
        }
      }
    }
    
    data.vehicle.vin = vin;
    
    // Extract vehicle title (Year Make Model)
    // First try to find it in the h1 or main title
    const titleElement = document.querySelector('h1, [class*="vehicle-title"], [class*="listing-title"]');
    if (titleElement) {
      const titleText = titleElement.textContent.trim();
      data.vehicle.title = titleText;
      
      // Try to parse year/make/model from title
      const titleMatch = titleText.match(/(\d{4})\s+(\w+)\s+(.*)/);
      if (titleMatch) {
        data.vehicle.year = titleMatch[1];
        data.vehicle.make = titleMatch[2];
        data.vehicle.model = titleMatch[3].trim();
      }
    }
    
    // If we couldn't parse from title, look for the pattern in body text
    if (!data.vehicle.year) {
      // Look for pattern like "2019 GMC Sierra 1500"
      const vehicleMatch = document.body.innerText.match(/\b(20\d{2})\s+(GMC|Chevrolet|Ford|Toyota|Honda|Nissan|Dodge|Ram|Jeep|BMW|Mercedes|Audi|Volkswagen|Mazda|Hyundai|Kia|Subaru|Lexus|Infiniti|Acura|Cadillac|Lincoln|Buick|Chrysler|Mitsubishi|Volvo|Land Rover|Porsche|Tesla)\s+([A-Z][A-Za-z0-9\s\-]+)/i);
      if (vehicleMatch) {
        data.vehicle.year = vehicleMatch[1];
        data.vehicle.make = vehicleMatch[2];
        data.vehicle.model = vehicleMatch[3].trim();
        data.vehicle.title = `${vehicleMatch[1]} ${vehicleMatch[2]} ${vehicleMatch[3].trim()}`;
      }
    }
    
    // Extract mileage
    const mileageText = document.body.innerText.match(/([\d,]+)\s*mi(?:les)?(?:\s|$)/i);
    if (mileageText) {
      data.vehicle.mileage = mileageText[1].replace(/,/g, '');
    } else {
      const mileageElement = document.querySelector('[class*="mileage"], [class*="odometer"]');
      if (mileageElement) {
        const text = mileageElement.textContent;
        const match = text.match(/([\d,]+)/);
        if (match) {
          data.vehicle.mileage = match[1].replace(/,/g, '');
        }
      }
    }
    
    // Extract location (Lane B, Run 62, etc.)
    const locationText = document.body.innerText.match(/Lane\s+[A-Z]\s*•?\s*Run\s+\d+/i);
    if (locationText) {
      data.vehicle.location = locationText[0];
    }
    
    // Extract seller (e.g., "Seller: CARZ SALE & LEASE INC")
    const sellerText = document.body.innerText.match(/Seller[:\s]+([^\n]+)/i);
    if (sellerText) {
      data.vehicle.seller = sellerText[1].trim();
    }
    
    // Extract sale info
    const saleText = document.body.innerText.match(/Sale\s+Lane\s+B\s*•?\s*Run\s+\d+/i);
    if (saleText) {
      data.vehicle.saleInfo = saleText[0];
    }
    
    // Extract price/bid information (e.g., "$25,401")
    const priceText = document.body.innerText.match(/\$\s?([\d,]+)/);
    if (priceText) {
      data.vehicle.currentBid = priceText[1].replace(/,/g, '');
    }
    
    // ── Damages ─────────────────────────────────────────────────────────────
    //
    // There is not one <table>, <tr> or <td> anywhere on an ADESA detail page.
    // The condition report is an AG Grid: div[role="row"] holding
    // div[role="gridcell"][col-id="part"|"type"|"severity"|"note"]. The old
    // extractor hunted for tables, found none, and fell through to a generic
    // "any container with about three children" scan that read cells out of the
    // equipment grid — that is where "Heated Seats - Front Only on Driver Airbag
    // - Front" and "N/A on N/A" came from, while real rows went missing.
    //
    // There is one grid per tab (All / Mechanical / Exterior / Interior / Other)
    // and they overlap, so read every grid and dedupe on part + type.
    console.log('=== ADESA scraper build ' + (buildVersion || '?') + ' ===');
    console.log('=== DAMAGE EXTRACTION START ===');

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const damageMap = new Map();

    // Returns how many data rows were present, not how many were new — the
    // per-grid count is what tells us whether virtualisation hid any.
    function readGrid(grid) {
      let seen = 0;
      grid.querySelectorAll('[role="row"]').forEach(row => {
        if (row.querySelector('[role="columnheader"]')) return;   // header row
        const cellText = (id) => {
          const c = row.querySelector('[role="gridcell"][col-id="' + id + '"]');
          return c ? c.textContent.trim() : '';
        };
        const part = cellText('part');
        const type = cellText('type');
        if (!part || !type || part === 'N/A') return;
        seen++;
        const key = part.toLowerCase() + '|' + type.toLowerCase();
        if (damageMap.has(key)) return;
        const severity = cellText('severity');
        damageMap.set(key, {
          part: part,
          type: type,
          severity: severity,
          note: cellText('note'),
          description: type + ' on ' + part,
          panel: part,
          damageType: type,
          chargeable: /required|unacceptable/i.test(severity) ? 'Yes' : 'No'
        });
      });
      return seen;
    }

    const GRID_SELECTOR = '.ag-root[role="treegrid"], .ag-root[role="grid"]';
    const hasRows = () => Array.from(document.querySelectorAll(GRID_SELECTOR))
      .some(g => g.querySelector('[role="gridcell"][col-id="part"]'));

    // The condition report sits well below the fold and its grid does not mount
    // until it is scrolled into view. The extractor this replaced only ever
    // found it by accident: a thousand lines of walking `document.querySelectorAll('*')`
    // took long enough for the page to catch up. Reading the DOM straight away
    // is fast enough to arrive before the grid exists and come back with zero
    // damages, so scroll the report into view and wait for it on purpose.
    // Finding the heading is what makes this work on a page that scrolls its
    // right-hand pane rather than the window: scrollIntoView walks up and moves
    // whichever ancestor actually scrolls. window.scrollTo moved nothing here,
    // the report stayed off-screen, and AG Grid rendered no rows into it —
    // one grid found, not a cell in it.
    const leafText = (el) => (el.children.length === 0 ? (el.textContent || '').trim() : '');

    // Deepest element whose text carries the phrase. Matching a whole leaf does
    // not work here: the label renders as sibling spans, "All Damages" and
    // "(8)", so no single node reads "All Damages (8)" even though the page
    // plainly does. The earlier exact-leaf match found nothing, so nothing was
    // ever scrolled and the section stayed unmounted.
    const deepestMatching = (re) => {
      const hits = Array.from(document.querySelectorAll('h1,h2,h3,h4,p,span,div,button,a'))
        .filter(el => re.test(el.textContent || ''));
      hits.sort((a, b) => a.getElementsByTagName('*').length - b.getElementsByTagName('*').length);
      return hits[0] || null;
    };
    const damagesHeading = () => deepestMatching(/All\s+Damages/i) || deepestMatching(/\bDamages\b/i);

    if (!hasRows()) {
      // Keep pulling it back into view while waiting: the section mounts on
      // becoming visible, and the layout shifts under us as it does.
      for (let i = 0; i < 20 && !hasRows(); i++) {
        const heading = damagesHeading();
        if (!heading) break;
        heading.scrollIntoView({ block: 'center' });
        await wait(250);
      }

      // Collapsed section — the heading carries a Hide/Show toggle, and when it
      // reads "Show" the grid is not merely off-screen, it is unmounted.
      if (!hasRows()) {
        const showToggle = Array.from(document.querySelectorAll('button, a, span, div'))
          .find(el => /^show$/i.test(leafText(el)) &&
                      /damage/i.test(el.closest('section, div[class]')?.textContent || ''));
        if (showToggle) {
          console.log('Damages section was collapsed — opening it');
          showToggle.click();
          await wait(700);
        }
      }

      // Still nothing: walk whatever the page actually scrolls, a screen at a
      // time, in case the report is lazier than one scrollIntoView allows for.
      if (!hasRows()) {
        const panes = Array.from(document.querySelectorAll('div, main, section'))
          .filter(el => el.scrollHeight > el.clientHeight + 200)
          .sort((a, b) => b.scrollHeight - a.scrollHeight)
          .slice(0, 3);
        panes.push(document.scrollingElement || document.body);
        for (let i = 0; i < 12 && !hasRows(); i++) {
          panes.forEach(el => { el.scrollTop += Math.max(200, el.clientHeight - 60); });
          await wait(250);
        }
        for (let i = 0; i < 8 && !hasRows(); i++) {
          const again = damagesHeading();
          if (!again) break;
          again.scrollIntoView({ block: 'center' });
          await wait(300);
        }
      }
    }

    // What the page says it has, so a silent zero can't pass for "clean car".
    const claimed = document.body.innerText.match(/All\s+Damages\s*\((\d+)\)/i);
    const claimedCount = claimed ? parseInt(claimed[1], 10) : null;

    const grids = document.querySelectorAll(GRID_SELECTOR);
    console.log('Found ' + grids.length + ' condition grids' +
                (claimedCount === null ? '' : '; page claims ' + claimedCount + ' damages'));

    for (const grid of grids) {
      // aria-rowcount counts the header row along with the data rows
      const expected = Math.max(0, (parseInt(grid.getAttribute('aria-rowcount'), 10) || 1) - 1);
      let seen = readGrid(grid);

      // AG Grid keeps only the visible rows in the DOM, so a report taller than
      // its box has to be scrolled to be read in full. The old code "waited" for
      // the newly rendered rows with `while (Date.now() < end) {}` — a spin that
      // blocks the very thread the grid renders on, so nothing new ever turned
      // up. Awaiting a real timeout is what makes the rest of the rows appear.
      const viewport = grid.querySelector('.ag-body-viewport');
      if (viewport && viewport.scrollHeight > viewport.clientHeight + 4) {
        const savedScroll = viewport.scrollTop;
        const step = Math.max(40, viewport.clientHeight - 40);
        for (let pos = 0; pos <= viewport.scrollHeight && seen < expected; pos += step) {
          viewport.scrollTop = pos;
          await wait(120);
          seen = Math.max(seen, readGrid(grid));
        }
        viewport.scrollTop = savedScroll;
        await wait(60);
      }

      if (expected && seen < expected) {
        console.warn('Grid claims ' + expected + ' rows but only ' + seen + ' could be read');
      }
    }

    data.damages = Array.from(damageMap.values());

    // Came back empty: record WHY into the data, not just the console. Console
    // output has to be noticed, kept, and pasted somewhere before it helps, and
    // by the time a scrape is being looked at, the tab that logged it is usually
    // gone. This rides along in the JSON and the summary that get saved anyway.
    if (!data.damages.length) {
      const colIds = new Set();
      grids.forEach(g => g.querySelectorAll('[col-id]').forEach(c => colIds.add(c.getAttribute('col-id'))));
      data.vehicle.damageDiag = {
        build: buildVersion || '?',
        gridsFound: grids.length,
        colIdsSeen: Array.from(colIds).sort().join(',') || 'none',
        agRootsAnyRole: document.querySelectorAll('.ag-root').length,
        rowEls: document.querySelectorAll('[role="row"]').length,
        cellEls: document.querySelectorAll('[role="gridcell"]').length,
        partCells: document.querySelectorAll('[role="gridcell"][col-id="part"]').length,
        headingFound: !!damagesHeading(),
        pageClaims: claimedCount,
        readyState: document.readyState,
        firstGrid: grids.length ? grids[0].outerHTML.slice(0, 800) : null,
      };
      console.warn('Damage diagnostic:', data.vehicle.damageDiag);
    }

    if (claimedCount !== null && data.damages.length !== claimedCount) {
      // Goes into the JSON and the summary, not just the console — nobody has
      // devtools open while scraping a run list, and a quiet undercount here
      // reads as a clean car.
      data.vehicle.damageWarning =
        'page shows ' + claimedCount + ' damages, scraper read ' + data.damages.length;
      console.warn(data.vehicle.damageWarning);
    }
    console.log('=== DAMAGE EXTRACTION END === ' + data.damages.length + ' damages');

    // ── Photos ──────────────────────────────────────────────────────────────
    //
    // Every ADESA photo comes from vexgateway.fastly.carvana.io on a per-vehicle
    // path: /vex-<id>/details/feature-<n>.jpg?...&width=<w>. The page also
    // carries a "Similar Vehicles You Might Like" carousel — ten other cars —
    // and taking every <img> on the page swept those in, which is why a scrape
    // of an IONIQ 5 came back leading with Teslas and a Jeep.
    //
    // The listing's own vex id is the one the page leans on: its gallery and
    // every damage thumbnail point at it, while each carousel car contributes
    // only a handful of URLs. Count them, take the winner, keep nothing else.
    const vexCounts = new Map();
    document.querySelectorAll('img[src*="/vex-"]').forEach(img => {
      const m = img.src.match(/\/(vex-\d+)\//);
      if (m) vexCounts.set(m[1], (vexCounts.get(m[1]) || 0) + 1);
    });
    let listingVex = '';
    let bestVexCount = 0;
    vexCounts.forEach((n, id) => { if (n > bestVexCount) { bestVexCount = n; listingVex = id; } });
    console.log('Listing vehicle ' + (listingVex || 'unknown') + '; ' + vexCounts.size + ' vehicles pictured on this page');

    // Width is a resize parameter on the CDN, not a different file, so every
    // photo is asked for at one usable size. Without this the damage-grid
    // thumbnails come down at their on-screen 40px and land as 2KB files.
    const PHOTO_WIDTH = 1280;
    const photoMap = new Map();   // feature id -> url

    function collectPhotos() {
      document.querySelectorAll('img[src*="/vex-"]').forEach(img => {
        if (listingVex && img.src.indexOf('/' + listingVex + '/') === -1) return;
        const feature = img.src.match(/feature-(\d+)/);
        if (!feature) return;
        if (photoMap.has(feature[1])) return;
        photoMap.set(feature[1], img.src.replace(/([?&]width=)\d+/, '$1' + PHOTO_WIDTH));
      });
    }

    collectPhotos();
    const photosWhileClosed = photoMap.size;

    // The full set only exists in the DOM once the photo viewer is open: the
    // page renders a hero and six thumbnails and hides the rest behind a
    // "+23 more" tile. Scraping without opening it returned 10 photos out of 40
    // and left whoever was scraping to remember the extra step, so open it here.
    const moreTile = Array.from(document.querySelectorAll('[data-qa="thumbnail"] div, [data-qa="thumbnail"], button'))
      .find(el => /^\+\d+\s*more$/i.test((el.textContent || '').replace(/\s+/g, ' ').trim()));

    if (moreTile) {
      const hidden = parseInt((moreTile.textContent.match(/\+(\d+)/) || [0, 0])[1], 10) || 0;
      console.log('Opening photo viewer for ' + hidden + ' more photos');
      (moreTile.closest('[data-qa="thumbnail"]') || moreTile).click();
      await wait(800);
      collectPhotos();

      // The viewer lazy-loads as it scrolls and its container has no stable
      // class name, so pick out whatever is actually scrollable once, then
      // scroll those until two passes running turn up nothing new.
      const scrollers = Array.from(document.querySelectorAll('div'))
        .filter(el => el.scrollHeight > el.clientHeight + 200)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)
        .slice(0, 3);
      scrollers.push(document.scrollingElement || document.body);

      let idlePasses = 0;
      for (let pass = 0; pass < 30 && idlePasses < 2 && photoMap.size < photosWhileClosed + hidden; pass++) {
        const before = photoMap.size;
        scrollers.forEach(el => { el.scrollTop += Math.max(200, el.clientHeight - 60); });
        await wait(300);
        collectPhotos();
        idlePasses = photoMap.size > before ? 0 : idlePasses + 1;
      }

      // Put the page back the way it was found, so the next scrape on the next
      // car starts from a closed viewer rather than someone else's leftovers.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      await wait(200);
    }

    const photoUrls = Array.from(photoMap.values()).slice(0, 60);
    console.log('Photos: ' + photoUrls.length + ' for ' + listingVex + ' (' + photosWhileClosed + ' before opening the viewer)');
    data.images = photoUrls.map(url => ({ url }));
    
    // Extract additional details from tabs/sections
    const tabs = ['Overview', 'Mechanical', 'Exterior', 'Interior', 'History'];
    tabs.forEach(tabName => {
      const tabContent = Array.from(document.querySelectorAll('*')).find(el => 
        el.textContent?.includes(tabName) && el.textContent?.length < 1000
      );
      if (tabContent) {
        data.vehicle[tabName.toLowerCase()] = tabContent.textContent.substring(0, 500);
      }
    });
    
    // Extract inspection type
    if (document.body.innerText.includes('Standard Inspection')) {
      data.vehicle.inspectionType = 'Standard Inspection';
    }
    
    // Extract announcements
    const announcementsText = document.body.innerText.match(/Announcements:\s*([^\n]+)/i);
    if (announcementsText) {
      data.vehicle.announcements = announcementsText[1].includes('No Announcements') ? 
        'None' : announcementsText[1].trim();
    }
    
    data.success = true;
    data.url = window.location.href;
    data.timestamp = new Date().toISOString();
    
  } catch (error) {
    data.error = error.message;
    console.error('ADESA scraping error:', error);
  }
  
  return data;
}
