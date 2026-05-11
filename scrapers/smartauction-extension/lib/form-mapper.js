// Form Mapper — 3-layer field discovery for SmartAuction forms
if (typeof FormMapper === 'undefined') {

'use strict';

var FormMapper = {
  // ── Layer 1: Known Selectors ──
  // These are specific selectors observed in SmartAuction's form pages.
  // Update as the site changes.
  KNOWN_SELECTORS: {
    // Vehicle Entry — Basic Information
    odometer:         '#Odometer, #odometer, input[name="Odometer"], input[name="odometer"]',
    odometerType:     '#OdometerType, select[name="OdometerType"]',
    exteriorColor:    '#ExteriorColor, select[name="ExteriorColor"], #exteriorColor',
    interiorColor:    '#InteriorColor, select[name="InteriorColor"], #interiorColor',
    vehicleType:      '#VehicleType, select[name="VehicleType"]',
    titleState:       '#TitleState, select[name="TitleState"]',
    titleStatus:      '#TitleStatus, select[name="TitleStatus"]',

    // Vehicle Entry — Pricing
    startingBid:      '#StartingBid, input[name="StartingBid"]',
    reservePrice:     '#ReservePrice, input[name="ReservePrice"]',
    buyNowPrice:      '#BuyNowPrice, input[name="BuyNowPrice"]',

    // Vehicle Entry — Description
    fullDescription:  '#FullDescription, textarea[name="FullDescription"], #description',
    sellerComments:   '#SellerComments, textarea[name="SellerComments"]',

    // Vehicle Entry — Disclosures
    frameRust:        '#FrameRust, select[name="FrameRust"]',
    frameDamage:      '#FrameDamage, select[name="FrameDamage"]',
    floodDamage:      '#FloodDamage, select[name="FloodDamage"]',
    odometerBrand:    '#OdometerBrand, select[name="OdometerBrand"]',
    airBags:          '#AirBags, select[name="AirBags"]',
    checkEngine:      '#CheckEngine, select[name="CheckEngine"]',
    absLight:         '#AbsLight, select[name="AbsLight"]',
    smoker:           '#Smoker, select[name="Smoker"]',

    // VIW/DirectInspect
    mileage:          '#Mileage, input[name="Mileage"], #mileage',
    inspectionGrade:  '#InspectionGrade, select[name="InspectionGrade"]',
    comments:         '#Comments, textarea[name="Comments"], #comments',

    // VIW — Damage modal fields
    damageType:       '#DamageType, select[name="DamageType"], select[name="damageType"]',
    damageLocation:   '#DamageLocation, select[name="DamageLocation"], select[name="damageLocation"]',
    damageDescription:'#DamageDescription, select[name="DamageDescription"], input[name="DamageDescription"]',
    damageChargeable: '#Chargeable, select[name="Chargeable"], input[name="Chargeable"]',
    damageCost:       '#DamageCost, input[name="DamageCost"], input[name="damageCost"]',
    damagePhoto:      '#DamagePhoto, input[name="DamagePhoto"][type="file"]',

    // VIW — Tire fields (positional — these are generic; real selectors depend on row context)
    tireMfr:          'input[name*="TireManufacturer"], input[name*="tireMfr"]',
    tireSize:         'input[name*="TireSize"], input[name*="tireSize"]',
    tireTread:        'select[name*="TreadDepth"], input[name*="treadDepth"]',
    tireDamage:       'select[name*="TireDamage"], select[name*="tireDamage"]'
  },

  // ── Layer 1: Find by known selector ──
  findBySelector(fieldName) {
    const selector = this.KNOWN_SELECTORS[fieldName];
    if (!selector) return null;
    return document.querySelector(selector);
  },

  // ── Layer 2: Find by label text ──
  findByLabel(labelText) {
    const normalizedTarget = labelText.toLowerCase().trim();

    // Method A: <label for="id">
    const labels = document.querySelectorAll('label');
    for (const label of labels) {
      const text = label.textContent.toLowerCase().trim();
      if (text.includes(normalizedTarget) || normalizedTarget.includes(text)) {
        if (label.htmlFor) {
          const el = document.getElementById(label.htmlFor);
          if (el) return el;
        }
        // Label wraps the input
        const input = label.querySelector('input, select, textarea');
        if (input) return input;
      }
    }

    // Method B: Nearby text node (aria-label, placeholder)
    const allInputs = document.querySelectorAll('input, select, textarea');
    for (const el of allInputs) {
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
      const title = (el.getAttribute('title') || '').toLowerCase();
      if (ariaLabel.includes(normalizedTarget) ||
          placeholder.includes(normalizedTarget) ||
          title.includes(normalizedTarget)) {
        return el;
      }
    }

    // Method C: Previous sibling or parent text
    for (const el of allInputs) {
      const parent = el.parentElement;
      if (!parent) continue;

      // Check preceding sibling text
      let prev = el.previousElementSibling;
      while (prev) {
        if (prev.textContent.toLowerCase().trim().includes(normalizedTarget)) {
          return el;
        }
        prev = prev.previousElementSibling;
      }

      // Check parent text (excluding the input's own text)
      const parentText = parent.textContent.toLowerCase().replace(el.value?.toLowerCase() || '', '').trim();
      if (parentText.includes(normalizedTarget) && parentText.length < 100) {
        return el;
      }
    }

    return null;
  },

  // ── Layer 3: Full DOM scan ──
  // Returns all form fields with context classification
  scanAllFields() {
    const results = [];
    document.querySelectorAll('input, select, textarea').forEach(el => {
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;

      const context = this._getFieldContext(el);
      results.push({
        element: el,
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        id: el.id || '',
        name: el.name || '',
        label: context.label,
        section: context.section,
        visible: el.offsetParent !== null
      });
    });
    return results;
  },

  // ── Smart Find: Tries all 3 layers ──
  find(fieldName, labelFallback) {
    // Layer 1
    let el = this.findBySelector(fieldName);
    if (el) return el;

    // Layer 2
    if (labelFallback) {
      el = this.findByLabel(labelFallback);
      if (el) return el;
    }

    // Layer 3: Search scanned fields
    const fields = this.scanAllFields();
    const target = (fieldName || labelFallback || '').toLowerCase();
    for (const f of fields) {
      if (f.label.toLowerCase().includes(target) || f.name.toLowerCase().includes(target)) {
        return f.element;
      }
    }

    return null;
  },

  // ── Set Value Helpers ──
  // Set input value with proper event dispatching
  setValue(el, value) {
    if (!el) return false;

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (el.tagName === 'TEXTAREA' && nativeTextareaValueSetter) {
      nativeTextareaValueSetter.call(el, value);
    } else if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    // For jQuery-based forms (SmartAuction uses jQuery in some areas)
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  },

  // Set select value — handles both native <select> and custom dropdowns
  setSelectValue(el, value) {
    if (!el) return false;

    if (el.tagName === 'SELECT') {
      // Try exact match first
      let found = false;
      for (const option of el.options) {
        if (option.value === value || option.textContent.trim() === value) {
          el.value = option.value;
          found = true;
          break;
        }
      }
      // Try case-insensitive partial match
      if (!found) {
        const lowerVal = value.toLowerCase();
        for (const option of el.options) {
          if (option.value.toLowerCase().includes(lowerVal) ||
              option.textContent.trim().toLowerCase().includes(lowerVal)) {
            el.value = option.value;
            found = true;
            break;
          }
        }
      }
      if (!found) return false;

      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    }

    // For custom dropdown widgets, try clicking the trigger and selecting the option
    return this.setValue(el, value);
  },

  // Set file input (for photo uploads)
  async setFileInput(el, dataUrl, filename) {
    if (!el || el.type !== 'file') return false;

    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], filename || 'photo.jpg', { type: blob.type });

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      el.files = dataTransfer.files;

      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (err) {
      console.error('setFileInput error:', err);
      return false;
    }
  },

  // ── Wait for Element ──
  waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null); // resolve null instead of rejecting — callers can check
      }, timeout);
    });
  },

  // ── Click and Wait ──
  async clickAndWait(el, waitSelector, timeout = 5000) {
    el.click();
    if (waitSelector) {
      return this.waitForElement(waitSelector, timeout);
    }
    return new Promise(resolve => setTimeout(resolve, 500));
  },

  // ── Private Helpers ──
  _getFieldContext(el) {
    let label = '';
    let section = '';

    // Try <label for="id">
    if (el.id) {
      const escapedId = CSS.escape(el.id);
      const labelEl = document.querySelector(`label[for="${escapedId}"]`);
      if (labelEl) label = labelEl.textContent.trim();
    }

    // Try aria-label
    if (!label) {
      label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    }

    // Try closest label
    if (!label) {
      const closestLabel = el.closest('label');
      if (closestLabel) label = closestLabel.textContent.trim();
    }

    // Try preceding text
    if (!label && el.previousElementSibling) {
      const prev = el.previousElementSibling;
      if (['LABEL', 'SPAN', 'DIV', 'P'].includes(prev.tagName)) {
        label = prev.textContent.trim();
      }
    }

    // Find section heading
    let parent = el.parentElement;
    for (let i = 0; i < 10 && parent; i++) {
      const heading = parent.querySelector('h1, h2, h3, h4, legend, .section-title');
      if (heading) {
        section = heading.textContent.trim();
        break;
      }
      parent = parent.parentElement;
    }

    return { label: label.substring(0, 100), section: section.substring(0, 100) };
  }
};

// Export
if (typeof window !== 'undefined') {
  window.FormMapper = FormMapper;
}
} // end guard
