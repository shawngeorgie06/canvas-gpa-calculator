/**
 * Grading Scales utility
 * Provides methods for converting Canvas grading schemes and getting default scales
 */

const GradingScales = {
  /**
   * Get default grading scale
   */
  getDefault() {
    return {
      'A': { min: 90, max: 100 },
      'B+': { min: 85, max: 89.99 },
      'B': { min: 80, max: 84.99 },
      'C+': { min: 75, max: 79.99 },
      'C': { min: 70, max: 74.99 },
      'D': { min: 60, max: 69.99 },
      'F': { min: 0, max: 59.99 }
    };
  },

  /**
   * Convert Canvas grading scheme to our internal format
   * Canvas scheme is sorted from highest to lowest
   * [{name: "A", value: 0.94}, {name: "A-", value: 0.9}, ...]
   * value is the MINIMUM percentage (as decimal) for that grade
   */
  convertCanvasScheme(canvasScheme) {
    if (!Array.isArray(canvasScheme) || canvasScheme.length === 0) {
      return this.getDefault();
    }

    const scale = {};
    const sortedScheme = [...canvasScheme].sort((a, b) => b.value - a.value);

    for (let i = 0; i < sortedScheme.length; i++) {
      const current = sortedScheme[i];
      const max = i === 0 ? 100 : (sortedScheme[i - 1].value * 100) - 0.01;
      const min = current.value * 100;

      scale[current.name] = {
        min: Math.round(min * 100) / 100,
        max: Math.round(max * 100) / 100
      };
    }

    return scale;
  },

  /**
   * Validate a grading scale
   * Returns array of error messages (empty if valid)
   */
  validateScale(scale) {
    const errors = [];

    if (!scale || typeof scale !== 'object') {
      return ['Scale must be an object'];
    }

    if (Object.keys(scale).length === 0) {
      return ['Scale must have at least one grade'];
    }

    // Check that ranges are valid
    for (const [grade, range] of Object.entries(scale)) {
      if (range.min === null || range.min === undefined || range.max === null || range.max === undefined) {
        // Allow empty entries - user might not fill all grades
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

    return errors;
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GradingScales;
}
