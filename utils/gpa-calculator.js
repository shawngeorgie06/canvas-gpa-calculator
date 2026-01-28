/**
 * GPA Calculator
 * Calculates semester GPA, cumulative GPA, target GPA, and academic standing
 * CRITICAL: Uses course-specific grading scales for accurate calculations
 */

const GPACalculator = {
  // NJIT GPA points for letter grades
  GRADE_POINTS: {
    'A': 4.0,
    'B+': 3.5,
    'B': 3.0,
    'C+': 2.5,
    'C': 2.0,
    'D': 1.0,
    'F': 0.0
  },

  // Academic standing thresholds
  ACADEMIC_STANDING: {
    DEANS_LIST: 3.5,
    HONORS: 3.0,
    GOOD_STANDING: 2.0,
    PROBATION: 2.0,
    LATIN_HONORS: {
      SUMMA_CUM_LAUDE: 3.9,
      MAGNA_CUM_LAUDE: 3.7,
      CUM_LAUDE: 3.5
    }
  },

  /**
   * Calculate semester GPA from courses
   * Uses pre-calculated gradePoints on each course (from Canvas letter grade or user override)
   * @param {array} courses - Array of course objects with grades and grading scales
   * @returns {object} Semester GPA calculation result
   */
  calculateSemesterGPA(courses) {
    if (!courses || courses.length === 0) {
      return {
        gpa: null,
        totalCredits: 0,
        totalQualityPoints: 0,
        courseBreakdown: [],
        error: 'No courses provided'
      };
    }

    let totalQualityPoints = 0;
    let totalCredits = 0;
    const courseBreakdown = [];

    for (const course of courses) {
      const credits = course.credits || 0;

      // Skip courses without credits
      if (credits <= 0) {
        courseBreakdown.push({
          ...course,
          qualityPoints: null,
          status: 'no_credits'
        });
        continue;
      }

      // Use pre-calculated gradePoints (from Canvas letter grade, custom override, or calculated)
      // This is set in popup.js when processing courses
      let gradePoints = course.gradePoints;
      let letterGrade = course.letterGrade;

      // Skip courses with N/A letter grade - these should NOT affect GPA calculation
      if (letterGrade === 'N/A' || letterGrade === 'NA') {
        courseBreakdown.push({
          ...course,
          qualityPoints: null,
          status: 'na_grade'
        });
        continue;
      }

      // If no pre-calculated grade points, try to calculate from percentage
      if (gradePoints === null || gradePoints === undefined) {
        if (course.currentGrade !== null && course.currentGrade !== undefined) {
          const gradingScale = course.gradingScale?.scale || this.getDefaultScale();
          letterGrade = this.percentageToLetterGrade(course.currentGrade, gradingScale);
          gradePoints = this.GRADE_POINTS[letterGrade] ?? 0;
        } else {
          // No grade data available
          courseBreakdown.push({
            ...course,
            qualityPoints: null,
            status: 'no_grade'
          });
          continue;
        }
      }

      const qualityPoints = gradePoints * credits;

      totalQualityPoints += qualityPoints;
      totalCredits += credits;

      courseBreakdown.push({
        id: course.id,
        name: course.name,
        credits,
        currentGrade: course.currentGrade,
        letterGrade,
        gradePoints,
        qualityPoints,
        gradingScaleSource: course.gradingScale?.source || 'default',
        gradingScaleConfidence: course.gradingScale?.confidence || 50,
        status: 'included'
      });
    }

    const gpa = totalCredits > 0
      ? Math.round((totalQualityPoints / totalCredits) * 1000) / 1000
      : null;

    return {
      gpa,
      totalCredits,
      totalQualityPoints,
      courseBreakdown,
      coursesIncluded: courseBreakdown.filter(c => c.status === 'included').length,
      coursesExcluded: courseBreakdown.filter(c => c.status !== 'included').length
    };
  },

  /**
   * Calculate cumulative GPA including previous semesters
   * @param {number} previousGPA - Previous cumulative GPA
   * @param {number} previousCredits - Previous total credits
   * @param {number} currentGPA - Current semester GPA
   * @param {number} currentCredits - Current semester credits
   * @returns {object} Cumulative GPA calculation result
   */
  calculateCumulativeGPA(previousGPA, previousCredits, currentGPA, currentCredits) {
    if (previousGPA === null && currentGPA === null) {
      return {
        cumulativeGPA: null,
        totalCredits: 0,
        error: 'No GPA data available'
      };
    }

    // If no previous GPA, cumulative = current
    if (previousGPA === null || previousCredits === 0) {
      return {
        cumulativeGPA: currentGPA,
        totalCredits: currentCredits,
        previousGPA: null,
        previousCredits: 0,
        currentGPA,
        currentCredits
      };
    }

    // If no current GPA, cumulative = previous
    if (currentGPA === null || currentCredits === 0) {
      return {
        cumulativeGPA: previousGPA,
        totalCredits: previousCredits,
        previousGPA,
        previousCredits,
        currentGPA: null,
        currentCredits: 0
      };
    }

    // Calculate weighted average
    const previousQualityPoints = previousGPA * previousCredits;
    const currentQualityPoints = currentGPA * currentCredits;
    const totalCredits = previousCredits + currentCredits;
    const cumulativeGPA = (previousQualityPoints + currentQualityPoints) / totalCredits;

    return {
      cumulativeGPA: Math.round(cumulativeGPA * 1000) / 1000,
      totalCredits,
      previousGPA,
      previousCredits,
      previousQualityPoints,
      currentGPA,
      currentCredits,
      currentQualityPoints
    };
  },

  /**
   * Calculate required GPA to achieve target cumulative GPA
   * @param {number} targetGPA - Target cumulative GPA
   * @param {number} currentCumulativeGPA - Current cumulative GPA
   * @param {number} currentTotalCredits - Current total credits
   * @param {number} semesterCredits - Credits for upcoming semester
   * @returns {object} Required GPA calculation
   */
  calculateRequiredGPA(targetGPA, currentCumulativeGPA, currentTotalCredits, semesterCredits) {
    if (semesterCredits <= 0) {
      return {
        possible: false,
        reason: 'No semester credits specified'
      };
    }

    // If no prior GPA, required = target
    if (currentCumulativeGPA === null || currentTotalCredits === 0) {
      return {
        requiredGPA: targetGPA,
        possible: targetGPA <= 4.0,
        targetGPA,
        semesterCredits,
        explanation: `Need ${targetGPA.toFixed(2)} GPA this semester`
      };
    }

    // Calculate required GPA
    // targetGPA = (currentQP + requiredQP) / (currentCredits + semesterCredits)
    // requiredQP = targetGPA * (currentCredits + semesterCredits) - currentQP
    // requiredGPA = requiredQP / semesterCredits

    const currentQualityPoints = currentCumulativeGPA * currentTotalCredits;
    const totalCreditsAfter = currentTotalCredits + semesterCredits;
    const targetQualityPoints = targetGPA * totalCreditsAfter;
    const requiredQualityPoints = targetQualityPoints - currentQualityPoints;
    const requiredGPA = requiredQualityPoints / semesterCredits;

    const isPossible = requiredGPA <= 4.0 && requiredGPA >= 0;
    const isImpossible = requiredGPA > 4.0;
    const alreadyAchieved = requiredGPA < 0;

    // Calculate maximum achievable GPA
    const maxNewQP = 4.0 * semesterCredits;
    const maxCumulativeGPA = (currentQualityPoints + maxNewQP) / totalCreditsAfter;

    return {
      requiredGPA: Math.round(requiredGPA * 1000) / 1000,
      possible: isPossible,
      isImpossible,
      alreadyAchieved,
      targetGPA,
      currentCumulativeGPA,
      currentTotalCredits,
      semesterCredits,
      maxAchievableGPA: Math.round(maxCumulativeGPA * 1000) / 1000,
      explanation: alreadyAchieved
        ? `You've already exceeded your target! Any GPA this semester will meet your goal.`
        : isImpossible
          ? `Target requires ${requiredGPA.toFixed(2)} GPA, which exceeds 4.0. Maximum achievable: ${maxCumulativeGPA.toFixed(2)}`
          : `Need ${requiredGPA.toFixed(2)} GPA this semester (${semesterCredits} credits) to reach ${targetGPA.toFixed(2)} cumulative`
    };
  },

  /**
   * Calculate impact of changing a course grade on GPA
   * @param {array} courses - Current courses
   * @param {string} courseId - Course to change
   * @param {number} newPercentage - New grade percentage
   * @returns {object} Impact calculation
   */
  calculateGradeImpact(courses, courseId, newPercentage) {
    // Calculate current GPA
    const currentResult = this.calculateSemesterGPA(courses);

    // Create modified courses array
    const modifiedCourses = courses.map(course => {
      if (course.id === courseId) {
        return { ...course, currentGrade: newPercentage };
      }
      return course;
    });

    // Calculate new GPA
    const newResult = this.calculateSemesterGPA(modifiedCourses);

    const targetCourse = courses.find(c => c.id === courseId);
    const modifiedCourse = newResult.courseBreakdown.find(c => c.id === courseId);
    const originalCourse = currentResult.courseBreakdown.find(c => c.id === courseId);

    return {
      courseName: targetCourse?.name,
      courseCredits: targetCourse?.credits,
      originalGrade: {
        percentage: targetCourse?.currentGrade,
        letter: originalCourse?.letterGrade,
        gpaPoints: originalCourse?.gradePoints
      },
      newGrade: {
        percentage: newPercentage,
        letter: modifiedCourse?.letterGrade,
        gpaPoints: modifiedCourse?.gradePoints
      },
      currentSemesterGPA: currentResult.gpa,
      newSemesterGPA: newResult.gpa,
      gpaChange: newResult.gpa !== null && currentResult.gpa !== null
        ? Math.round((newResult.gpa - currentResult.gpa) * 1000) / 1000
        : null
    };
  },

  /**
   * Get academic standing based on GPA
   * @param {number} gpa - GPA to evaluate
   * @returns {object} Academic standing information
   */
  getAcademicStanding(gpa) {
    if (gpa === null) {
      return { status: 'unknown', description: 'GPA not available' };
    }

    const standings = [];

    // Check for Latin honors (typically for cumulative GPA at graduation)
    if (gpa >= this.ACADEMIC_STANDING.LATIN_HONORS.SUMMA_CUM_LAUDE) {
      standings.push({
        type: 'latin_honor',
        name: 'Summa Cum Laude',
        icon: '🎓',
        description: 'Highest Latin honor'
      });
    } else if (gpa >= this.ACADEMIC_STANDING.LATIN_HONORS.MAGNA_CUM_LAUDE) {
      standings.push({
        type: 'latin_honor',
        name: 'Magna Cum Laude',
        icon: '🎓',
        description: 'High Latin honor'
      });
    } else if (gpa >= this.ACADEMIC_STANDING.LATIN_HONORS.CUM_LAUDE) {
      standings.push({
        type: 'latin_honor',
        name: 'Cum Laude',
        icon: '🎓',
        description: 'Latin honor'
      });
    }

    // Check for Dean's List
    if (gpa >= this.ACADEMIC_STANDING.DEANS_LIST) {
      standings.push({
        type: 'deans_list',
        name: "Dean's List",
        icon: '✅',
        description: `GPA of ${this.ACADEMIC_STANDING.DEANS_LIST}+ qualifies for Dean's List`
      });
    }

    // Check for Honors
    if (gpa >= this.ACADEMIC_STANDING.HONORS && gpa < this.ACADEMIC_STANDING.DEANS_LIST) {
      standings.push({
        type: 'honors',
        name: 'Honors',
        icon: '⭐',
        description: `GPA of ${this.ACADEMIC_STANDING.HONORS}+ qualifies for Honors`
      });
    }

    // Check for Good Standing
    if (gpa >= this.ACADEMIC_STANDING.GOOD_STANDING) {
      standings.push({
        type: 'good_standing',
        name: 'Good Standing',
        icon: '✓',
        description: 'Meeting minimum academic requirements'
      });
    } else {
      standings.push({
        type: 'probation',
        name: 'Academic Probation',
        icon: '⚠️',
        description: `GPA below ${this.ACADEMIC_STANDING.PROBATION} - at risk of academic probation`
      });
    }

    return {
      gpa,
      standings,
      primaryStanding: standings[0],
      isDeansList: gpa >= this.ACADEMIC_STANDING.DEANS_LIST,
      isHonors: gpa >= this.ACADEMIC_STANDING.HONORS,
      isGoodStanding: gpa >= this.ACADEMIC_STANDING.GOOD_STANDING,
      isProbation: gpa < this.ACADEMIC_STANDING.PROBATION
    };
  },

  /**
   * Calculate GPA by category (major, electives, etc.)
   * @param {array} courses - Courses with category tags
   * @param {object} categories - Category definitions {categoryName: [courseIds]}
   * @returns {object} GPA breakdown by category
   */
  calculateGPAByCategory(courses, categories) {
    const results = {};

    for (const [categoryName, courseIds] of Object.entries(categories)) {
      const categoryCourses = courses.filter(c => courseIds.includes(c.id));
      const categoryGPA = this.calculateSemesterGPA(categoryCourses);

      results[categoryName] = {
        gpa: categoryGPA.gpa,
        totalCredits: categoryGPA.totalCredits,
        courseCount: categoryCourses.length,
        courses: categoryGPA.courseBreakdown
      };
    }

    return results;
  },

  /**
   * Project future GPA based on planned courses
   * @param {number} currentGPA - Current cumulative GPA
   * @param {number} currentCredits - Current total credits
   * @param {array} plannedSemesters - Array of {credits, expectedGPA}
   * @returns {object} GPA projection
   */
  projectGPA(currentGPA, currentCredits, plannedSemesters) {
    let projectedGPA = currentGPA || 0;
    let projectedCredits = currentCredits || 0;
    const projections = [];

    for (let i = 0; i < plannedSemesters.length; i++) {
      const semester = plannedSemesters[i];
      const semesterCredits = semester.credits || 0;
      const semesterGPA = semester.expectedGPA || 0;

      if (semesterCredits > 0) {
        const newQualityPoints = (projectedGPA * projectedCredits) + (semesterGPA * semesterCredits);
        projectedCredits += semesterCredits;
        projectedGPA = newQualityPoints / projectedCredits;

        projections.push({
          semester: i + 1,
          semesterCredits,
          semesterGPA,
          cumulativeGPA: Math.round(projectedGPA * 1000) / 1000,
          totalCredits: projectedCredits
        });
      }
    }

    return {
      startingGPA: currentGPA,
      startingCredits: currentCredits,
      projectedFinalGPA: Math.round(projectedGPA * 1000) / 1000,
      projectedFinalCredits: projectedCredits,
      semesterProjections: projections
    };
  },

  /**
   * Convert percentage to letter grade using a grading scale
   * @param {number} percentage - Grade percentage
   * @param {object} scale - Grading scale
   * @returns {string} Letter grade
   */
  percentageToLetterGrade(percentage, scale) {
    if (percentage === null || percentage === undefined) {
      return null;
    }

    // Sort grades by min value descending
    const sortedGrades = Object.entries(scale)
      .sort((a, b) => b[1].min - a[1].min);

    for (const [letter, range] of sortedGrades) {
      if (percentage >= range.min && percentage <= range.max) {
        return letter;
      }
    }

    return 'F';
  },

  /**
   * Get default grading scale (NJIT)
   * @returns {object} Default grading scale
   */
  getDefaultScale() {
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
   * Format GPA for display
   * @param {number} gpa - GPA value
   * @param {number} decimals - Number of decimal places
   * @returns {string} Formatted GPA
   */
  formatGPA(gpa, decimals = 2) {
    if (gpa === null || gpa === undefined) {
      return 'N/A';
    }
    return gpa.toFixed(decimals);
  },

  /**
   * Get GPA trend direction
   * @param {number} currentGPA - Current GPA
   * @param {number} previousGPA - Previous GPA
   * @returns {object} Trend information
   */
  getGPATrend(currentGPA, previousGPA) {
    if (currentGPA === null || previousGPA === null) {
      return { direction: 'unknown', change: null };
    }

    const change = currentGPA - previousGPA;

    return {
      direction: change > 0.01 ? 'up' : change < -0.01 ? 'down' : 'stable',
      change: Math.round(change * 1000) / 1000,
      icon: change > 0.01 ? '📈' : change < -0.01 ? '📉' : '➡️'
    };
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GPACalculator;
}
