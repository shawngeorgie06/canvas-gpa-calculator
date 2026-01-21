/**
 * Storage utility for Chrome extension
 * Handles all chrome.storage.local operations with proper error handling
 */

const Storage = {
  // Default data structure
  defaults: {
    canvasApiToken: null,
    canvasBaseUrl: null,
    previousGPA: null,
    previousCredits: 0,
    currentSemester: {
      courses: []
    },
    customGradingScales: {},
    excludedAssignments: {},  // { courseId: [assignmentId, ...] }
    widgetVisible: true,      // Whether the widget is shown or hidden
    settings: {
      showConfidenceIndicators: true,
      autoRefreshInterval: 15, // minutes
      enableNotifications: true
    },
    cache: {
      courses: null,
      coursesTimestamp: null,
      grades: {},
      gradesTimestamp: {}
    }
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

  // Canvas API Token methods
  async getApiToken() {
    const { canvasApiToken } = await this.get('canvasApiToken');
    return canvasApiToken;
  },

  async setApiToken(token) {
    await this.set({ canvasApiToken: token });
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

  // Cache methods
  async getCachedCourses() {
    const { cache } = await this.get('cache');
    if (!cache?.courses || !cache?.coursesTimestamp) return null;

    // Check if cache is expired (1 hour)
    const age = Date.now() - cache.coursesTimestamp;
    if (age > 60 * 60 * 1000) return null;

    return cache.courses;
  },

  async setCachedCourses(courses) {
    const { cache } = await this.get('cache');
    await this.set({
      cache: {
        ...cache,
        courses,
        coursesTimestamp: Date.now()
      }
    });
  },

  async getCachedGrades(courseId) {
    const { cache } = await this.get('cache');
    if (!cache?.grades?.[courseId] || !cache?.gradesTimestamp?.[courseId]) return null;

    // Check if cache is expired (15 minutes)
    const age = Date.now() - cache.gradesTimestamp[courseId];
    if (age > 15 * 60 * 1000) return null;

    return cache.grades[courseId];
  },

  async setCachedGrades(courseId, grades) {
    const { cache } = await this.get('cache');
    await this.set({
      cache: {
        ...cache,
        grades: {
          ...cache?.grades,
          [courseId]: grades
        },
        gradesTimestamp: {
          ...cache?.gradesTimestamp,
          [courseId]: Date.now()
        }
      }
    });
  },

  async clearCache() {
    await this.set({
      cache: {
        courses: null,
        coursesTimestamp: null,
        grades: {},
        gradesTimestamp: {}
      }
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
