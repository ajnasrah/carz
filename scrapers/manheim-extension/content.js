// Content script runs on all auction site pages

console.log('Auto Auction Scraper extension loaded');

// Shared domain detection
function isAuctionSite(hostname) {
  return hostname.endsWith('manheim.com') ||
         hostname.endsWith('ove.com') ||
         hostname.endsWith('edgepipeline.com') ||
         hostname.endsWith('adesa.com') ||
         hostname.includes('marketplace.adesa') ||
         hostname.includes('simulcast') ||
         hostname.includes('crsimplified');
}

function getSiteType(hostname) {
  if (hostname.endsWith('manheim.com') || hostname.endsWith('ove.com')) return 'manheim';
  if (hostname.endsWith('edgepipeline.com') || hostname.includes('simulcast')) return 'edge';
  if (hostname.endsWith('adesa.com') || hostname.includes('marketplace.adesa')) return 'adesa';
  return 'unknown';
}

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkPage') {
    sendResponse({
      isAuctionSite: isAuctionSite(window.location.hostname),
      siteType: getSiteType(window.location.hostname),
      url: window.location.href
    });
  }
  
  if (request.action === 'scrapeAdesa') {
    scrapeAdesaPage().then(data => sendResponse(data));
    return true; // Will respond asynchronously
  }
  
  return true;
});

// ADESA-specific scraping function
async function scrapeAdesaPage() {
  const data = {
    success: false,
    vehicle: {},
    damages: [],
    images: [],
    error: null
  };
  
  try {
    // Extract VIN - look for it in multiple places
    // First try the copy button or VIN display element
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
    
    // Method 3: Check the copy button area (from screenshot)
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
    const titleElement = document.querySelector('h1, [class*="vehicle-title"], [class*="listing-title"]');
    if (titleElement) {
      const titleText = titleElement.textContent.trim();
      const titleMatch = titleText.match(/(\d{4})\s+(\w+)\s+(.*)/);
      if (titleMatch) {
        data.vehicle.year = titleMatch[1];
        data.vehicle.make = titleMatch[2];
        data.vehicle.model = titleMatch[3];
      }
      data.vehicle.title = titleText;
    }
    
    // Extract mileage - look for pattern like "116,894 mi"
    const mileageText = document.body.innerText.match(/([\d,]+)\s*mi(?:les)?(?:\s|$)/i);
    if (mileageText) {
      data.vehicle.mileage = mileageText[1].replace(/,/g, '');
    } else {
      // Fallback to looking for specific elements
      const mileageElement = document.querySelector('[class*="mileage"], [class*="odometer"]');
      if (mileageElement) {
        const text = mileageElement.textContent;
        const match = text.match(/([\d,]+)/);
        if (match) {
          data.vehicle.mileage = match[1].replace(/,/g, '');
        }
      }
    }
    
    // Extract location
    const locationElement = document.querySelector('[class*="location"], [class*="Lane"]');
    if (locationElement) {
      data.vehicle.location = locationElement.textContent.trim();
    }
    
    // Extract seller
    const sellerElement = document.querySelector('[class*="seller"], [class*="consignor"]');
    if (sellerElement) {
      data.vehicle.seller = sellerElement.textContent.trim();
    }
    
    // Extract price/bid information
    const priceElement = document.querySelector('[class*="price"], [class*="bid"], [class*="amount"]');
    if (priceElement) {
      const priceText = priceElement.textContent;
      const priceMatch = priceText.match(/\$?([\d,]+)/);
      if (priceMatch) {
        data.vehicle.currentBid = priceMatch[1].replace(/,/g, '');
      }
    }
    
    // Extract damage information - handle Edge Pipeline format
    const siteType = getSiteType(window.location.hostname);
    
    if (siteType === 'edge') {
      // Edge Pipeline format: "Part| Type" with severity on next line
      const damageSection = document.querySelector('section:has(> h2:first-child), div:has(> h2:first-child), [class*="damage"]');
      if (damageSection) {
        const damageElements = damageSection.querySelectorAll('div, p, span');
        let currentDamage = null;
        
        damageElements.forEach(el => {
          const text = el.textContent?.trim();
          if (text && text.includes('|')) {
            // This is a damage line like "RR Tail Lamp| Broken"
            const [part, type] = text.split('|').map(s => s.trim());
            currentDamage = { part, type, description: text };
          } else if (text && text.toLowerCase().includes('severity:') && currentDamage) {
            // This is the severity line
            currentDamage.severity = text.replace(/severity:/i, '').trim();
            data.damages.push(currentDamage);
            currentDamage = null;
          }
        });
      }
      
      // Alternative Edge Pipeline format - look for text patterns
      const allText = document.body.innerText;
      const damagePattern = /([^|\n]+)\|\s*([^|\n]+)\s*\n\s*severity:\s*([^\n]+)/gi;
      let match;
      while ((match = damagePattern.exec(allText)) !== null) {
        const [, part, type, severity] = match;
        const duplicate = data.damages.find(d => 
          d.part === part.trim() && d.type === type.trim()
        );
        if (!duplicate) {
          data.damages.push({
            part: part.trim(),
            type: type.trim(),
            severity: severity.trim(),
            description: `${type.trim()} on ${part.trim()}`
          });
        }
      }
    } else {
      // Original logic for Manheim/ADESA
      const damageRows = document.querySelectorAll('tr[class*="damage"], [data-damage-row], tbody tr');
      damageRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 3) {
          const part = cells[0]?.textContent?.trim();
          const type = cells[1]?.textContent?.trim();
          const severity = cells[2]?.textContent?.trim();
          
          if (part && type) {
            data.damages.push({
              part,
              type,
              severity,
              description: `${type} on ${part}`
            });
          }
        }
      });
    }
    
    // Extract images
    const imageElements = document.querySelectorAll('img[src*="vehicle"], img[src*="car"], img[class*="gallery"], img[class*="photo"]');
    imageElements.forEach(img => {
      if (img.src && !img.src.includes('logo') && !img.src.includes('icon')) {
        data.images.push(img.src);
      }
    });
    
    // Extract additional details from Overview section
    const overviewSection = document.querySelector('[class*="overview"], #overview');
    if (overviewSection) {
      // Standard Inspection
      const inspectionText = overviewSection.textContent;
      if (inspectionText.includes('Standard Inspection')) {
        data.vehicle.inspectionType = 'Standard Inspection';
      }
      
      // Announcements
      const announcementsMatch = inspectionText.match(/Announcements:\s*(.*?)(?:\n|$)/i);
      if (announcementsMatch) {
        data.vehicle.announcements = announcementsMatch[1].trim();
      }
    }
    
    // Extract mechanical issues
    const mechanicalSection = Array.from(document.querySelectorAll('*')).find(el => 
      el.textContent?.includes('Mechanical') && el.textContent?.includes('Warning Lights')
    );
    if (mechanicalSection) {
      data.vehicle.mechanicalIssues = mechanicalSection.textContent.trim();
    }
    
    // Extract exterior issues
    const exteriorSection = Array.from(document.querySelectorAll('*')).find(el => 
      el.textContent?.includes('Exterior') && el.textContent?.includes('Prior Paint')
    );
    if (exteriorSection) {
      data.vehicle.exteriorIssues = exteriorSection.textContent.trim();
    }
    
    // Extract interior condition
    const interiorSection = Array.from(document.querySelectorAll('*')).find(el => 
      el.textContent?.includes('Interior') && el.textContent?.includes('Unverified Items')
    );
    if (interiorSection) {
      data.vehicle.interiorCondition = interiorSection.textContent.trim();
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
