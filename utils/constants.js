/**
 * Constants for Canvas GPA Calculator extension
 */

const Constants = {
  // API Configuration
  API: {
    BASE_URL_PLACEHOLDER: 'https://njit.instructure.com',
    API_VERSION: 'v1',
    RATE_LIMIT_PER_SECOND: 10,
    REQUEST_TIMEOUT_MS: 30000
  },

  // Cache durations
  CACHE: {
    COURSES: 60 * 60 * 1000,        // 1 hour
    GRADES: 15 * 60 * 1000,          // 15 minutes
    ASSIGNMENT_GROUPS: 30 * 60 * 1000, // 30 minutes
    GRADING_STANDARDS: 60 * 60 * 1000  // 1 hour
  },

  // Refresh intervals
  REFRESH: {
    BACKGROUND_INTERVAL: 15 * 60 * 1000, // 15 minutes
    WIDGET_AUTO_REFRESH: 5 * 60 * 1000    // 5 minutes
  },

  // Storage keys
  STORAGE: {
    API_TOKEN: 'canvasApiToken',
    API_TOKEN_ENCRYPTED: 'canvasApiTokenEncrypted',
    BASE_URL: 'canvasBaseUrl',
    CACHE: 'cache',
    SETTINGS: 'settings',
    CUSTOM_SCALES: 'customGradingScales'
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Constants;
}
