// Enhanced Error Handler for SmartAuction Extension
// Provides retry logic, error recovery, and user notifications

(function() {
  'use strict';

  const ErrorHandler = {
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
    
    // Error types and their handlers
    errorTypes: {
      NETWORK_ERROR: 'network',
      DOM_ERROR: 'dom',
      VALIDATION_ERROR: 'validation',
      API_ERROR: 'api',
      TIMEOUT_ERROR: 'timeout',
      PERMISSION_ERROR: 'permission'
    },

    // Wrap any async function with error handling and retry logic
    withRetry: async function(fn, options = {}) {
      const {
        maxRetries = this.MAX_RETRIES,
        retryDelay = this.RETRY_DELAY,
        onError = null,
        onRetry = null,
        context = 'Operation'
      } = options;

      let lastError;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`${context}: Attempt ${attempt}/${maxRetries}`);
          const result = await fn();
          
          if (attempt > 1) {
            console.log(`${context}: Succeeded after ${attempt} attempts`);
          }
          
          return result;
        } catch (error) {
          lastError = error;
          console.error(`${context}: Attempt ${attempt} failed:`, error);
          
          if (onError) {
            onError(error, attempt);
          }
          
          // Don't retry on validation errors
          if (this.getErrorType(error) === this.errorTypes.VALIDATION_ERROR) {
            throw error;
          }
          
          if (attempt < maxRetries) {
            if (onRetry) {
              onRetry(attempt, maxRetries);
            }
            
            // Exponential backoff
            const delay = retryDelay * Math.pow(1.5, attempt - 1);
            console.log(`${context}: Retrying in ${delay}ms...`);
            await this.sleep(delay);
          }
        }
      }
      
      // All attempts failed
      const enhancedError = new Error(`${context} failed after ${maxRetries} attempts: ${lastError.message}`);
      enhancedError.originalError = lastError;
      enhancedError.attempts = maxRetries;
      throw enhancedError;
    },

    // Wrap DOM operations with error handling
    safeDOMOperation: async function(selector, operation, options = {}) {
      const {
        timeout = 10000,
        required = true,
        context = 'DOM operation'
      } = options;

      return this.withRetry(async () => {
        const element = await this.waitForElement(selector, timeout);
        
        if (!element && required) {
          throw new Error(`Required element not found: ${selector}`);
        }
        
        if (element && operation) {
          return await operation(element);
        }
        
        return element;
      }, { context, maxRetries: 2 });
    },

    // Wait for element with timeout
    waitForElement: function(selector, timeout = 10000) {
      return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        const check = () => {
          const element = document.querySelector(selector);
          
          if (element) {
            resolve(element);
          } else if (Date.now() - startTime > timeout) {
            reject(new Error(`Timeout waiting for element: ${selector}`));
          } else {
            setTimeout(check, 100);
          }
        };
        
        check();
      });
    },

    // Safe form field operations
    safeSetValue: async function(selector, value, options = {}) {
      return this.safeDOMOperation(selector, (element) => {
        if (element.tagName === 'SELECT') {
          // Handle select elements
          const option = Array.from(element.options).find(opt => 
            opt.value === value || opt.textContent.trim() === value
          );
          
          if (option) {
            element.value = option.value;
            element.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (!options.allowMissing) {
            throw new Error(`Option "${value}" not found in select ${selector}`);
          }
        } else if (element.type === 'checkbox' || element.type === 'radio') {
          // Handle checkboxes and radios
          element.checked = Boolean(value);
          element.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          // Handle text inputs
          element.value = value || '';
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
        
        return element.value;
      }, { ...options, context: `Set value for ${selector}` });
    },

    // Safe click operation
    safeClick: async function(selector, options = {}) {
      return this.safeDOMOperation(selector, (element) => {
        if (element.disabled) {
          throw new Error(`Element ${selector} is disabled`);
        }
        
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.click();
        return true;
      }, { ...options, context: `Click ${selector}` });
    },

    // API call wrapper with error handling
    safeAPICall: async function(url, options = {}) {
      const {
        method = 'GET',
        body = null,
        headers = {},
        timeout = 30000
      } = options;

      return this.withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
          const response = await fetch(url, {
            method,
            body: body ? JSON.stringify(body) : null,
            headers: {
              'Content-Type': 'application/json',
              ...headers
            },
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            const error = new Error(`API error: ${response.status} ${response.statusText}`);
            error.status = response.status;
            error.response = await response.text();
            throw error;
          }
          
          return await response.json();
        } catch (error) {
          clearTimeout(timeoutId);
          
          if (error.name === 'AbortError') {
            throw new Error(`API call timeout after ${timeout}ms`);
          }
          
          throw error;
        }
      }, { context: `API call to ${url}` });
    },

    // Determine error type
    getErrorType: function(error) {
      if (error.message.includes('network') || error.message.includes('fetch')) {
        return this.errorTypes.NETWORK_ERROR;
      }
      if (error.message.includes('element') || error.message.includes('selector')) {
        return this.errorTypes.DOM_ERROR;
      }
      if (error.message.includes('timeout')) {
        return this.errorTypes.TIMEOUT_ERROR;
      }
      if (error.message.includes('validation') || error.message.includes('invalid')) {
        return this.errorTypes.VALIDATION_ERROR;
      }
      if (error.status && error.status >= 400) {
        return this.errorTypes.API_ERROR;
      }
      return 'unknown';
    },

    // User notification
    notify: function(message, type = 'info') {
      const notification = document.createElement('div');
      notification.className = `carz-notification carz-notification-${type}`;
      notification.textContent = message;
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6'};
        color: white;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        z-index: 10000;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        animation: slideIn 0.3s ease;
      `;
      
      document.body.appendChild(notification);
      
      setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
      }, 5000);
    },

    // Progress indicator
    showProgress: function(message) {
      let progress = document.getElementById('carz-progress');
      
      if (!progress) {
        progress = document.createElement('div');
        progress.id = 'carz-progress';
        progress.style.cssText = `
          position: fixed;
          bottom: 20px;
          right: 20px;
          padding: 15px 20px;
          background: #1e293b;
          color: #10b981;
          border: 2px solid #10b981;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          z-index: 10000;
          display: flex;
          align-items: center;
          gap: 10px;
        `;
        document.body.appendChild(progress);
      }
      
      progress.innerHTML = `
        <div class="spinner" style="
          width: 16px;
          height: 16px;
          border: 2px solid #10b981;
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        "></div>
        <span>${message}</span>
      `;
      
      return progress;
    },

    hideProgress: function() {
      const progress = document.getElementById('carz-progress');
      if (progress) {
        progress.remove();
      }
    },

    // Batch operation handler
    batchOperation: async function(items, operation, options = {}) {
      const {
        batchSize = 5,
        onProgress = null,
        stopOnError = false
      } = options;

      const results = [];
      const errors = [];
      
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchPromises = batch.map(async (item, index) => {
          try {
            const result = await operation(item, i + index);
            results.push({ success: true, item, result });
            return result;
          } catch (error) {
            console.error(`Batch operation failed for item ${i + index}:`, error);
            errors.push({ item, error });
            
            if (stopOnError) {
              throw error;
            }
            
            return null;
          }
        });
        
        await Promise.all(batchPromises);
        
        if (onProgress) {
          onProgress({
            completed: Math.min(i + batchSize, items.length),
            total: items.length,
            errors: errors.length
          });
        }
      }
      
      return { results, errors };
    },

    // Storage wrapper with error handling
    safeStorage: {
      get: async function(key) {
        try {
          return await chrome.storage.local.get(key);
        } catch (error) {
          console.error(`Storage get error for ${key}:`, error);
          return {};
        }
      },
      
      set: async function(data) {
        try {
          await chrome.storage.local.set(data);
          return true;
        } catch (error) {
          console.error('Storage set error:', error);
          
          // Try to clear some space if quota exceeded
          if (error.message.includes('quota')) {
            await chrome.storage.local.clear();
            await chrome.storage.local.set(data);
          }
          
          return false;
        }
      }
    },

    // Utility functions
    sleep: function(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },

    // Initialize error handler
    init: function() {
      // Add CSS for notifications
      const style = document.createElement('style');
      style.textContent = `
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
      
      // Global error handler
      window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection:', event.reason);
        this.notify(`Error: ${event.reason.message || 'Unknown error'}`, 'error');
      });
      
      console.log('ErrorHandler initialized');
    }
  };

  // Export for use in other scripts
  window.CarzErrorHandler = ErrorHandler;
  
  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ErrorHandler.init());
  } else {
    ErrorHandler.init();
  }
})();