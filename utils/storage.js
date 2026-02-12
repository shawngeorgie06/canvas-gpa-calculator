/**
 * Storage utility for Chrome extension
 * Handles all chrome.storage.local operations with proper error handling
 * SECURITY: Sensitive data (tokens) is encrypted at rest using Web Crypto API
 */

// Security: Token encryption/decryption using Web Crypto API
const TokenEncryption = {
  /**
   * Derive a consistent encryption key using PBKDF2
   * Uses a fixed seed so the same key is derived every time
   * This allows tokens to be decrypted across sessions
   */
  async getOrCreateKey() {
    try {
      // SECURITY: Derive seed from extension ID instead of hardcoding
      // This ensures each extension instance has a unique encryption key
      const extensionId = chrome.runtime.id;
      const seed = `canvas-gpa-${extensionId}`;
      const encoder = new TextEncoder();
      const seedData = encoder.encode(seed);

      // Import seed as a key
      const baseKey = await crypto.subtle.importKey(
        'raw',
        seedData,
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );

      // Derive a consistent AES-GCM key from the base key
      const derivedKey = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          hash: 'SHA-256',
          salt: encoder.encode('canvas-gpa-salt'),
          iterations: 100000
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      return derivedKey;
    } catch (error) {
      console.error('[Canvas GPA] Key derivation failed:', error);
      throw new Error('Failed to derive encryption key');
    }
  },

  /**
   * Encrypt sensitive string
   */
  async encrypt(plaintext) {
    try {
      const key = await this.getOrCreateKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoder = new TextEncoder();
      const encoded = encoder.encode(plaintext);

      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encoded
      );

      // Combine IV + ciphertext for storage
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encrypted), iv.length);

      return btoa(String.fromCharCode.apply(null, combined));
    } catch (error) {
      console.error('[Canvas GPA] Encryption failed:', error.name);
      throw new Error('Failed to encrypt data');
    }
  },

  /**
   * Decrypt sensitive string
   */
  async decrypt(ciphertext) {
    try {
      const key = await this.getOrCreateKey();
      const combined = new Uint8Array(atob(ciphertext).split('').map(c => c.charCodeAt(0)));

      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encrypted
      );

      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error) {
      console.error('[Canvas GPA] Decryption failed:', error.name);
      throw new Error('Failed to decrypt data - token may be corrupted');
    }
  }
};

const Storage = {
  // Default data structure - SINGLE SOURCE OF TRUTH for all storage keys
  defaults: {
    // API Configuration
    canvasApiToken: null,
    canvasBaseUrl: null,

    // User Data - Previous Semesters
    previousGPA: null,
    previousCredits: 0,

    // Current semester courses (legacy, may be deprecated)
    currentSemester: {
      courses: []
    },

    // Custom grading scales (per-course overrides)
    customGradingScales: {},

    // Assignment exclusions (per-course)
    excludedAssignments: {},

    // Widget visibility on Canvas pages
    widgetVisible: true,

    // Extension settings
    settings: {
      showConfidenceIndicators: true,
      autoRefreshInterval: 15,
      enableNotifications: true
    },

    // Cached data (encrypted for security)
    cache: {
      coursesEncrypted: null,
      courses: null, // Legacy, will be migrated
      coursesTimestamp: null,
      gradesEncrypted: {},
      grades: {}, // Legacy, will be migrated
      gradesTimestamp: {}
    },

    // UI Preferences
    darkMode: false,
    selectedGradingScale: 'njit',
    customGradingPoints: {},

    // Semester Management
    excludedSemesters: [],
    detectedSemesters: [],
    upcomingSemesters: [],

    // Custom Course Data (grades, credits entered by user)
    customCourseData: {},

    // Manual courses (from transcript, not Canvas)
    manualCourses: [],

    // Excluded courses (from GPA calculation)
    excludedCourses: [],

    // Semester-level overrides
    semesterGPAOverrides: {},
    semesterCreditOverrides: {},

    // Cumulative-level overrides
    cumulativeGPAOverride: null,
    cumulativeCreditOverride: null,

    // Sync tracking
    lastSyncTime: null
  },

  /**
   * Get data from storage
   * @param {string|string[]} keys - Key(s) to retrieve
   * @returns {Promise<object>} Retrieved data
   */
  async get(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    });
  },

  /**
   * Set data in storage
   * @param {object} data - Data to store
   * @returns {Promise<void>}
   */
  async set(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  },

  /**
   * Remove data from storage
   * @param {string|string[]} keys - Key(s) to remove
   * @returns {Promise<void>}
   */
  async remove(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  },

  /**
   * Clear all storage
   * @returns {Promise<void>}
   */
  async clear() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.clear(() => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  },

  /**
   * Initialize storage with defaults if empty
   * @returns {Promise<void>}
   */
  async initialize() {
    const data = await this.get(null);
    const updates = {};

    for (const [key, value] of Object.entries(this.defaults)) {
      if (!(key in data)) {
        updates[key] = value;
      }
    }

    if (Object.keys(updates).length > 0) {
      await this.set(updates);
    }
  },

  // Canvas API Token methods - ENCRYPTED at rest
  async getApiToken() {
    try {
      const { canvasApiToken, canvasApiTokenEncrypted } = await this.get(['canvasApiToken', 'canvasApiTokenEncrypted']);

      // If token is in old unencrypted format, migrate it
      if (canvasApiToken && !canvasApiTokenEncrypted) {
        console.warn('[Canvas GPA] Migrating token to encrypted format');
        await this.setApiToken(canvasApiToken);
        // Get the newly encrypted token
        const { canvasApiTokenEncrypted: encrypted } = await this.get('canvasApiTokenEncrypted');
        // Clear old unencrypted token
        await this.remove('canvasApiToken');
        return await TokenEncryption.decrypt(encrypted);
      }

      if (canvasApiTokenEncrypted) {
        return await TokenEncryption.decrypt(canvasApiTokenEncrypted);
      }

      return null;
    } catch (error) {
      console.error('[Canvas GPA] Failed to retrieve API token:', error.name);
      // If decryption fails, clear the corrupted token so user can re-enter
      console.warn('[Canvas GPA] Clearing corrupted token from storage');
      await this.remove(['canvasApiTokenEncrypted', 'canvasApiToken']);
      return null;
    }
  },

  async setApiToken(token) {
    try {
      if (!token) {
        await this.remove('canvasApiTokenEncrypted');
        return;
      }

      const encrypted = await TokenEncryption.encrypt(token);
      await this.set({ canvasApiTokenEncrypted: encrypted });
      // Ensure old unencrypted token is removed
      await this.remove('canvasApiToken');
    } catch (error) {
      console.error('[Canvas GPA] Failed to store API token:', error.name);
      throw error;
    }
  },

  async getBaseUrl() {
    const { canvasBaseUrl } = await this.get('canvasBaseUrl');
    return canvasBaseUrl;
  },

  async setBaseUrl(url) {
    await this.set({ canvasBaseUrl: url });
  },

  // Previous GPA methods
  async getPreviousGPA() {
    const { previousGPA, previousCredits } = await this.get(['previousGPA', 'previousCredits']);
    return { gpa: previousGPA, credits: previousCredits };
  },

  async setPreviousGPA(gpa, credits) {
    await this.set({ previousGPA: gpa, previousCredits: credits });
  },

  // Course data methods
  async getCourses() {
    const { currentSemester } = await this.get('currentSemester');
    return currentSemester?.courses || [];
  },

  async setCourses(courses) {
    await this.set({
      currentSemester: { courses }
    });
  },

  async updateCourse(courseId, updates) {
    const courses = await this.getCourses();
    const index = courses.findIndex(c => c.id === courseId);

    if (index !== -1) {
      courses[index] = { ...courses[index], ...updates };
      await this.setCourses(courses);
    }

    return courses;
  },

  // Custom grading scale methods
  async getCustomGradingScale(courseId) {
    const { customGradingScales } = await this.get('customGradingScales');
    return customGradingScales?.[courseId] || null;
  },

  async setCustomGradingScale(courseId, scale, userNotes = '') {
    const { customGradingScales } = await this.get('customGradingScales');
    const updatedScales = {
      ...customGradingScales,
      [courseId]: {
        scale,
        userNotes,
        lastUpdated: new Date().toISOString()
      }
    };
    await this.set({ customGradingScales: updatedScales });
  },

  async removeCustomGradingScale(courseId) {
    const { customGradingScales } = await this.get('customGradingScales');
    if (customGradingScales && customGradingScales[courseId]) {
      delete customGradingScales[courseId];
      await this.set({ customGradingScales });
    }
  },

  // Cache methods - with encryption for sensitive data
  async getCachedCourses() {
    const { cache } = await this.get('cache');
    if (!cache?.coursesEncrypted || !cache?.coursesTimestamp) return null;

    // Check if cache is expired (1 hour)
    const age = Date.now() - cache.coursesTimestamp;
    if (age > 60 * 60 * 1000) return null;

    try {
      // SECURITY: Decrypt cached courses
      const decrypted = await TokenEncryption.decrypt(cache.coursesEncrypted);
      return JSON.parse(decrypted);
    } catch (error) {
      console.warn('[Canvas GPA] Failed to decrypt cached courses:', error);
      return null;
    }
  },

  async setCachedCourses(courses) {
    const { cache } = await this.get('cache');
    try {
      // SECURITY: Encrypt courses before caching
      const encrypted = await TokenEncryption.encrypt(JSON.stringify(courses));
      await this.set({
        cache: {
          ...cache,
          coursesEncrypted: encrypted,
          courses: null, // Remove unencrypted version if it exists
          coursesTimestamp: Date.now()
        }
      });
    } catch (error) {
      console.error('[Canvas GPA] Failed to encrypt cache:', error);
    }
  },

  async getCachedGrades(courseId) {
    const { cache } = await this.get('cache');
    if (!cache?.gradesEncrypted?.[courseId] || !cache?.gradesTimestamp?.[courseId]) return null;

    // Check if cache is expired (15 minutes)
    const age = Date.now() - cache.gradesTimestamp[courseId];
    if (age > 15 * 60 * 1000) return null;

    try {
      // SECURITY: Decrypt cached grades
      const decrypted = await TokenEncryption.decrypt(cache.gradesEncrypted[courseId]);
      return JSON.parse(decrypted);
    } catch (error) {
      console.warn('[Canvas GPA] Failed to decrypt cached grades:', error);
      return null;
    }
  },

  async setCachedGrades(courseId, grades) {
    const { cache } = await this.get('cache');
    try {
      // SECURITY: Encrypt grades before caching
      const encrypted = await TokenEncryption.encrypt(JSON.stringify(grades));
      await this.set({
        cache: {
          ...cache,
          gradesEncrypted: {
            ...cache?.gradesEncrypted,
            [courseId]: encrypted
          },
          grades: {
            ...cache?.grades,
            [courseId]: null // Remove unencrypted version
          },
          gradesTimestamp: {
            ...cache?.gradesTimestamp,
            [courseId]: Date.now()
          }
        }
      });
    } catch (error) {
      console.error('[Canvas GPA] Failed to encrypt cache:', error);
    }
  },

  async clearCache() {
    await this.set({
      cache: {
        courses: null,
        coursesTimestamp: null,
        grades: {},
        gradesTimestamp: {}
      },
      // Also clear semester detection data to force re-detection
      detectedSemesters: [],
      upcomingSemesters: []
    });
  },

  // Settings methods
  async getSettings() {
    const { settings } = await this.get('settings');
    return settings || this.defaults.settings;
  },

  async updateSettings(updates) {
    const settings = await this.getSettings();
    await this.set({
      settings: { ...settings, ...updates }
    });
  },

  // Excluded assignments methods
  async getExcludedAssignments(courseId) {
    const { excludedAssignments } = await this.get('excludedAssignments');
    return excludedAssignments?.[courseId] || [];
  },

  async toggleAssignmentExclusion(courseId, assignmentId) {
    const { excludedAssignments = {} } = await this.get('excludedAssignments');
    const courseExclusions = excludedAssignments[courseId] || [];

    const index = courseExclusions.indexOf(assignmentId);
    if (index === -1) {
      // Add to exclusions
      courseExclusions.push(assignmentId);
    } else {
      // Remove from exclusions
      courseExclusions.splice(index, 1);
    }

    excludedAssignments[courseId] = courseExclusions;
    await this.set({ excludedAssignments });

    return index === -1; // Returns true if now excluded, false if now included
  },

  async isAssignmentExcluded(courseId, assignmentId) {
    const excluded = await this.getExcludedAssignments(courseId);
    return excluded.includes(assignmentId);
  },

  // Widget visibility methods
  async getWidgetVisible() {
    const { widgetVisible } = await this.get('widgetVisible');
    return widgetVisible !== false; // Default to true
  },

  async setWidgetVisible(visible) {
    await this.set({ widgetVisible: visible });
  },

  async toggleWidgetVisible() {
    const currentState = await this.getWidgetVisible();
    await this.setWidgetVisible(!currentState);
    return !currentState;
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Storage;
}
