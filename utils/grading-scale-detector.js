/**
 * Grading Scale Detector
 * CRITICAL: Each course has a different grading scale - this module detects the correct one
 * Priority: 1. Manual Override, 2. Canvas API, 3. Syllabus Parsing, 4. Default Fallback
 */

const GradingScaleDetector = {
  // Import from constants.js - single source of truth
  GRADE_POINTS: GRADE_POINTS_NJIT,

  // Default grading scale (common 10-point scale)
  DEFAULT_SCALE: {
    'A': { min: 90, max: 100 },
    'B': { min: 80, max: 89.99 },
    'C': { min: 70, max: 79.99 },
    'D': { min: 60, max: 69.99 },
    'F': { min: 0, max: 59.99 }
  },

  // NJIT grading scale
  DEFAULT_SCALE_PLUS_MINUS: {
    'A': { min: 90, max: 100 },
    'B+': { min: 85, max: 89.99 },
    'B': { min: 80, max: 84.99 },
    'C+': { min: 75, max: 79.99 },
    'C': { min: 70, max: 74.99 },
    'D': { min: 60, max: 69.99 },
    'F': { min: 0, max: 59.99 }
  },

  // Source identifiers
  SOURCES: {
    MANUAL_OVERRIDE: 'manual_override',
    CANVAS_API: 'canvas_api',
    SYLLABUS_PARSED: 'syllabus_parsed',
    DEFAULT_FALLBACK: 'default_fallback'
  },

  // Confidence levels
  CONFIDENCE: {
    MANUAL_OVERRIDE: 100,
    CANVAS_API: 95,
    SYLLABUS_PARSED: 85,
    DEFAULT_FALLBACK: 50
  },

  /**
   * Get the grading scale for a course (main entry point)
   * Priority: Manual Override > Canvas API > Syllabus > Default
   * @param {string} courseId - Course ID
   * @param {object} options - Options including Canvas API instance and storage
   * @returns {Promise<object>} Grading scale with source and confidence
   */
  async getGradingScale(courseId, options = {}) {
    const { canvasApi, storage, forceRefresh = false } = options;

    // 1. Check for manual override first (highest priority)
    if (storage) {
      const customScale = await storage.getCustomGradingScale(courseId);
      if (customScale) {
        return {
          scale: customScale.scale,
          source: this.SOURCES.MANUAL_OVERRIDE,
          confidence: this.CONFIDENCE.MANUAL_OVERRIDE,
          lastUpdated: customScale.lastUpdated,
          userNotes: customScale.userNotes
        };
      }
    }

    // 2. Try Canvas API (most reliable automated source)
    if (canvasApi && !forceRefresh) {
      try {
        const canvasScale = await this.detectFromCanvasAPI(courseId, canvasApi);
        if (canvasScale) {
          return canvasScale;
        }
      } catch (error) {
        console.warn(`Canvas API grading scale detection failed for course ${courseId}:`, error);
      }
    }

    // 3. Return default fallback with warning
    return {
      scale: this.DEFAULT_SCALE_PLUS_MINUS,
      source: this.SOURCES.DEFAULT_FALLBACK,
      confidence: this.CONFIDENCE.DEFAULT_FALLBACK,
      lastUpdated: new Date().toISOString(),
      warning: 'Using default grading scale. Please verify with your syllabus.'
    };
  },

  /**
   * Detect grading scale from Canvas API
   * @param {string} courseId - Course ID
   * @param {object} canvasApi - Canvas API instance
   * @returns {Promise<object|null>} Grading scale or null if not found
   */
  async detectFromCanvasAPI(courseId, canvasApi) {
    const gradingStandard = await canvasApi.getActiveGradingStandard(courseId);

    if (!gradingStandard || !gradingStandard.grading_scheme) {
      return null;
    }

    // Convert Canvas grading scheme format to our format
    // Canvas format: [{name: "A", value: 0.94}, {name: "A-", value: 0.9}, ...]
    // Our format: {"A": {min: 94, max: 100}, "A-": {min: 90, max: 93.99}, ...}
    const scale = this.convertCanvasScheme(gradingStandard.grading_scheme);

    return {
      scale,
      source: this.SOURCES.CANVAS_API,
      confidence: this.CONFIDENCE.CANVAS_API,
      lastUpdated: new Date().toISOString(),
      canvasStandardId: gradingStandard.id,
      canvasStandardTitle: gradingStandard.title
    };
  },

  /**
   * Convert Canvas grading scheme to our internal format
   * @param {array} canvasScheme - Canvas grading scheme array
   * @returns {object} Converted grading scale
   */
  convertCanvasScheme(canvasScheme) {
    // Canvas scheme is sorted from highest to lowest
    // [{name: "A", value: 0.94}, {name: "A-", value: 0.9}, ...]
    // value is the MINIMUM percentage (as decimal) for that grade

    const scale = {};
    const sortedScheme = [...canvasScheme].sort((a, b) => b.value - a.value);

    for (let i = 0; i < sortedScheme.length; i++) {
      const current = sortedScheme[i];
      const next = sortedScheme[i + 1];

      const min = current.value * 100;
      const max = i === 0 ? 100 : (sortedScheme[i - 1].value * 100) - 0.01;

      scale[current.name] = {
        min: Math.round(min * 100) / 100,
        max: Math.round(max * 100) / 100
      };
    }

    return scale;
  },

  /**
   * Parse grading scale from syllabus text using regex patterns
   * @param {string} syllabusText - Full text of syllabus
   * @returns {object|null} Parsed grading scale or null
   */
  parseFromSyllabus(syllabusText) {
    if (!syllabusText) return null;

    // Common patterns for grading scales in syllabi
    const patterns = [
      // "A: 93-100%", "A: 93% - 100%", "A = 93-100"
      /([A-F][+-]?)\s*[:=]\s*(\d{1,3}(?:\.\d+)?)\s*[-–—to]\s*(\d{1,3}(?:\.\d+)?)\s*%?/gi,

      // "A (93-100)", "A (93% to 100%)"
      /([A-F][+-]?)\s*\(\s*(\d{1,3}(?:\.\d+)?)\s*[-–—to]\s*(\d{1,3}(?:\.\d+)?)\s*%?\s*\)/gi,

      // "93-100 = A", "93%-100%: A"
      /(\d{1,3}(?:\.\d+)?)\s*[-–—to]\s*(\d{1,3}(?:\.\d+)?)\s*%?\s*[:=]\s*([A-F][+-]?)/gi,

      // "A 93+", "A: 93%+", "A >= 93"
      /([A-F][+-]?)\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)\s*%?\s*\+/gi,

      // "90% and above = A"
      /(\d{1,3}(?:\.\d+)?)\s*%?\s*(?:and\s+)?(?:above|or\s+higher|or\s+greater|\+)\s*[:=]\s*([A-F][+-]?)/gi
    ];

    const foundGrades = {};

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(syllabusText)) !== null) {
        // Pattern 1, 2: Grade first, then range
        if (match[0].match(/^[A-F]/i)) {
          const grade = match[1].toUpperCase();
          const min = parseFloat(match[2]);
          const max = match[3] ? parseFloat(match[3]) : 100;

          if (this.isValidGradeRange(min, max)) {
            foundGrades[grade] = { min, max };
          }
        }
        // Pattern 3: Range first, then grade
        else if (match[0].match(/^\d/)) {
          const min = parseFloat(match[1]);
          const max = parseFloat(match[2]);
          const grade = match[3].toUpperCase();

          if (this.isValidGradeRange(min, max)) {
            foundGrades[grade] = { min, max };
          }
        }
      }
    }

    // Check if we found a reasonable grading scale (at least A, B, C, D, F)
    const requiredGrades = ['A', 'B', 'C', 'D', 'F'];
    const hasBasicGrades = requiredGrades.every(g =>
      Object.keys(foundGrades).some(fg => fg.startsWith(g))
    );

    if (!hasBasicGrades || Object.keys(foundGrades).length < 4) {
      return null;
    }

    // Fill in gaps and normalize the scale
    return this.normalizeScale(foundGrades);
  },

  /**
   * Validate a grade range
   * @param {number} min - Minimum percentage
   * @param {number} max - Maximum percentage
   * @returns {boolean} True if valid
   */
  isValidGradeRange(min, max) {
    return min >= 0 && min <= 100 && max >= min && max <= 100;
  },

  /**
   * Normalize and fill gaps in a parsed grading scale
   * @param {object} scale - Partially parsed grading scale
   * @returns {object} Normalized grading scale
   */
  normalizeScale(scale) {
    const normalized = { ...scale };

    // Sort grades by minimum value (descending)
    const sortedGrades = Object.entries(normalized)
      .sort((a, b) => b[1].min - a[1].min);

    // Ensure max values connect properly
    for (let i = 0; i < sortedGrades.length - 1; i++) {
      const [currentGrade, currentRange] = sortedGrades[i];
      const [nextGrade, nextRange] = sortedGrades[i + 1];

      // Set max of next grade to be just below min of current grade
      if (nextRange.max >= currentRange.min) {
        normalized[nextGrade].max = currentRange.min - 0.01;
      }
    }

    // Ensure top grade goes to 100
    if (sortedGrades.length > 0) {
      const topGrade = sortedGrades[0][0];
      normalized[topGrade].max = 100;
    }

    // Ensure bottom grade goes to 0
    if (sortedGrades.length > 0) {
      const bottomGrade = sortedGrades[sortedGrades.length - 1][0];
      normalized[bottomGrade].min = 0;
    }

    return normalized;
  },

  /**
   * Create a grading scale result from syllabus parsing
   * @param {string} syllabusText - Syllabus text
   * @returns {object|null} Grading scale result or null
   */
  detectFromSyllabusText(syllabusText) {
    const scale = this.parseFromSyllabus(syllabusText);

    if (!scale) return null;

    return {
      scale,
      source: this.SOURCES.SYLLABUS_PARSED,
      confidence: this.CONFIDENCE.SYLLABUS_PARSED,
      lastUpdated: new Date().toISOString(),
      requiresConfirmation: true
    };
  },

  /**
   * Convert percentage to letter grade using a specific scale
   * @param {number} percentage - Grade percentage
   * @param {object} scale - Grading scale
   * @returns {string} Letter grade
   */
  percentageToLetterGrade(percentage, scale) {
    if (percentage === null || percentage === undefined) {
      return null;
    }

    // Sort grades by min value descending to check highest grades first
    const sortedGrades = Object.entries(scale)
      .sort((a, b) => b[1].min - a[1].min);

    for (const [letter, range] of sortedGrades) {
      if (percentage >= range.min && percentage <= range.max) {
        return letter;
      }
    }

    // If no match found (shouldn't happen with proper scale), return F
    return 'F';
  },

  /**
   * Convert letter grade to GPA points
   * @param {string} letterGrade - Letter grade
   * @returns {number} GPA points
   */
  letterGradeToGPA(letterGrade) {
    if (!letterGrade) return 0;

    // Normalize the letter grade
    const normalized = letterGrade.toUpperCase().trim();

    return this.GRADE_POINTS[normalized] ?? 0;
  },

  /**
   * Get grade info (letter + GPA) from percentage using course-specific scale
   * @param {number} percentage - Grade percentage
   * @param {object} gradingScale - Course grading scale result
   * @returns {object} Grade info
   */
  getGradeInfo(percentage, gradingScale) {
    const scale = gradingScale?.scale || this.DEFAULT_SCALE_PLUS_MINUS;
    const letterGrade = this.percentageToLetterGrade(percentage, scale);
    const gpaPoints = this.letterGradeToGPA(letterGrade);

    return {
      percentage,
      letterGrade,
      gpaPoints,
      source: gradingScale?.source || this.SOURCES.DEFAULT_FALLBACK,
      confidence: gradingScale?.confidence || this.CONFIDENCE.DEFAULT_FALLBACK
    };
  },

  /**
   * Format grading scale for display
   * @param {object} scale - Grading scale
   * @returns {string} Formatted string
   */
  formatScaleForDisplay(scale) {
    const sortedGrades = Object.entries(scale)
      .sort((a, b) => b[1].min - a[1].min);

    return sortedGrades
      .map(([letter, range]) => `${letter}: ${range.min}-${range.max}%`)
      .join(', ');
  },

  /**
   * Get source display info
   * @param {string} source - Source identifier
   * @param {number} confidence - Confidence level
   * @returns {object} Display info with icon and text
   */
  getSourceDisplayInfo(source, confidence) {
    const displays = {
      [this.SOURCES.MANUAL_OVERRIDE]: {
        icon: '✓',
        text: 'Manual Override',
        color: '#10b981', // green
        description: 'You set this grading scale manually'
      },
      [this.SOURCES.CANVAS_API]: {
        icon: '✅',
        text: 'Canvas API',
        color: '#10b981', // green
        description: 'Detected from Canvas course settings'
      },
      [this.SOURCES.SYLLABUS_PARSED]: {
        icon: '📄',
        text: 'Syllabus',
        color: '#f59e0b', // yellow
        description: 'Parsed from uploaded syllabus'
      },
      [this.SOURCES.DEFAULT_FALLBACK]: {
        icon: '⚠️',
        text: 'Default',
        color: '#ef4444', // red
        description: 'Using default scale - please verify with syllabus'
      }
    };

    return {
      ...displays[source] || displays[this.SOURCES.DEFAULT_FALLBACK],
      confidence: `${confidence}%`
    };
  },

  /**
   * Create an empty scale template for manual entry
   * @param {boolean} includePlusMinus - Include plus/minus grades
   * @returns {object} Empty scale template
   */
  createEmptyScaleTemplate(includePlusMinus = true) {
    if (includePlusMinus) {
      return {
        'A': { min: null, max: 100 },
        'A-': { min: null, max: null },
        'B+': { min: null, max: null },
        'B': { min: null, max: null },
        'B-': { min: null, max: null },
        'C+': { min: null, max: null },
        'C': { min: null, max: null },
        'C-': { min: null, max: null },
        'D+': { min: null, max: null },
        'D': { min: null, max: null },
        'D-': { min: null, max: null },
        'F': { min: 0, max: null }
      };
    }

    return {
      'A': { min: null, max: 100 },
      'B': { min: null, max: null },
      'C': { min: null, max: null },
      'D': { min: null, max: null },
      'F': { min: 0, max: null }
    };
  },

  /**
   * Validate a grading scale
   * @param {object} scale - Grading scale to validate
   * @returns {object} Validation result with isValid and errors
   */
  validateScale(scale) {
    const errors = [];

    if (!scale || typeof scale !== 'object') {
      return { isValid: false, errors: ['Scale must be an object'] };
    }

    // Check for required grades
    const hasAGrade = Object.keys(scale).some(g => g.startsWith('A'));
    const hasFGrade = Object.keys(scale).some(g => g === 'F');

    if (!hasAGrade) errors.push('Scale must include an A grade');
    if (!hasFGrade) errors.push('Scale must include an F grade');

    // Check that ranges are valid
    for (const [grade, range] of Object.entries(scale)) {
      if (range.min === null || range.max === null) {
        errors.push(`${grade} grade has incomplete range`);
        continue;
      }

      if (range.min < 0 || range.min > 100) {
        errors.push(`${grade} minimum must be between 0 and 100`);
      }

      if (range.max < 0 || range.max > 100) {
        errors.push(`${grade} maximum must be between 0 and 100`);
      }

      if (range.min > range.max) {
        errors.push(`${grade} minimum cannot be greater than maximum`);
      }
    }

    // Check for overlapping ranges
    const sortedGrades = Object.entries(scale)
      .filter(([, range]) => range.min !== null && range.max !== null)
      .sort((a, b) => b[1].min - a[1].min);

    for (let i = 0; i < sortedGrades.length - 1; i++) {
      const [currentGrade, currentRange] = sortedGrades[i];
      const [nextGrade, nextRange] = sortedGrades[i + 1];

      if (nextRange.max >= currentRange.min) {
        errors.push(`${currentGrade} and ${nextGrade} ranges overlap`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GradingScaleDetector;
}
