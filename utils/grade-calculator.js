/**
 * Grade Calculator
 * Calculates grades with support for weighted categories, dropped assignments, and what-if scenarios
 */

const GradeCalculator = {
  /**
   * Calculate the current grade for a course
   * @param {array} assignmentGroups - Assignment groups with assignments and submissions
   * @param {object} options - Calculation options
   * @returns {object} Grade calculation result
   */
  calculateCourseGrade(assignmentGroups, options = {}) {
    const { includeUngraded = false } = options;

    // Check if course uses weighted categories
    const totalWeight = assignmentGroups.reduce((sum, group) => sum + (group.group_weight || 0), 0);
    const isWeighted = totalWeight > 0;

    if (isWeighted) {
      return this.calculateWeightedGrade(assignmentGroups, options);
    } else {
      return this.calculatePointsBasedGrade(assignmentGroups, options);
    }
  },

  /**
   * Calculate grade using weighted categories
   * @param {array} assignmentGroups - Assignment groups
   * @param {object} options - Calculation options
   * @returns {object} Weighted grade result
   */
  calculateWeightedGrade(assignmentGroups, options = {}) {
    let totalWeightedScore = 0;
    let totalWeight = 0;
    const groupBreakdown = [];

    for (const group of assignmentGroups) {
      const groupWeight = group.group_weight || 0;
      const { earnedPoints, possiblePoints, gradedCount, totalCount, excludedCount, droppedAssignments } =
        this.calculateGroupScore(group, options);

      if (possiblePoints > 0) {
        const groupPercentage = (earnedPoints / possiblePoints) * 100;
        const weightedContribution = (groupPercentage / 100) * groupWeight;

        totalWeightedScore += weightedContribution;
        totalWeight += groupWeight;

        groupBreakdown.push({
          name: group.name,
          id: group.id,
          weight: groupWeight,
          percentage: groupPercentage,
          weightedContribution,
          earnedPoints,
          possiblePoints,
          gradedCount,
          totalCount,
          excludedCount,
          droppedAssignments
        });
      } else if (groupWeight > 0) {
        // Track groups with no grades yet
        groupBreakdown.push({
          name: group.name,
          id: group.id,
          weight: groupWeight,
          percentage: null,
          weightedContribution: 0,
          earnedPoints: 0,
          possiblePoints: 0,
          gradedCount: 0,
          totalCount: group.assignments?.length || 0,
          excludedCount: excludedCount || 0,
          droppedAssignments: []
        });
      }
    }

    // Calculate final percentage
    // If not all weights are accounted for, scale to 100%
    const currentPercentage = totalWeight > 0
      ? (totalWeightedScore / totalWeight) * 100
      : null;

    return {
      percentage: currentPercentage,
      method: 'weighted',
      totalWeight,
      weightedScore: totalWeightedScore,
      groupBreakdown,
      isComplete: totalWeight >= 99 // Account for rounding
    };
  },

  /**
   * Calculate grade using points-based system
   * @param {array} assignmentGroups - Assignment groups
   * @param {object} options - Calculation options
   * @returns {object} Points-based grade result
   */
  calculatePointsBasedGrade(assignmentGroups, options = {}) {
    let totalEarned = 0;
    let totalPossible = 0;
    const groupBreakdown = [];

    for (const group of assignmentGroups) {
      const { earnedPoints, possiblePoints, gradedCount, totalCount, excludedCount, droppedAssignments } =
        this.calculateGroupScore(group, options);

      totalEarned += earnedPoints;
      totalPossible += possiblePoints;

      groupBreakdown.push({
        name: group.name,
        id: group.id,
        earnedPoints,
        possiblePoints,
        percentage: possiblePoints > 0 ? (earnedPoints / possiblePoints) * 100 : null,
        gradedCount,
        totalCount,
        excludedCount,
        droppedAssignments
      });
    }

    const percentage = totalPossible > 0
      ? (totalEarned / totalPossible) * 100
      : null;

    return {
      percentage,
      method: 'points',
      totalEarned,
      totalPossible,
      groupBreakdown,
      isComplete: true
    };
  },

  /**
   * Calculate score for a single assignment group
   * @param {object} group - Assignment group
   * @param {object} options - Calculation options
   * @param {array} options.excludedAssignments - Array of assignment IDs to exclude
   * @returns {object} Group score details
   */
  calculateGroupScore(group, options = {}) {
    const { includeUngraded = false, excludedAssignments = [] } = options;
    const assignments = group.assignments || [];
    const rules = group.rules || {};

    // Create a Set for faster lookup of excluded assignments
    const excludedSet = new Set(excludedAssignments.map(id => id.toString()));

    // Get graded assignments (excluding user-excluded ones)
    let gradedAssignments = assignments.filter(a => {
      // Skip excluded assignments
      if (excludedSet.has(a.id.toString())) {
        return false;
      }
      const submission = a.submission;
      return submission &&
             submission.score !== null &&
             submission.score !== undefined &&
             !submission.excused;
    });

    // Sort by score percentage for drop calculations
    gradedAssignments = gradedAssignments.map(a => ({
      ...a,
      percentage: a.points_possible > 0
        ? (a.submission.score / a.points_possible) * 100
        : 100
    }));

    // Handle dropped assignments
    const droppedAssignments = [];

    // Drop lowest scores
    if (rules.drop_lowest && rules.drop_lowest > 0) {
      gradedAssignments.sort((a, b) => a.percentage - b.percentage);
      const toDrop = gradedAssignments.splice(0, Math.min(rules.drop_lowest, gradedAssignments.length - 1));
      droppedAssignments.push(...toDrop.map(a => ({ ...a, reason: 'lowest' })));
    }

    // Drop highest scores
    if (rules.drop_highest && rules.drop_highest > 0) {
      gradedAssignments.sort((a, b) => b.percentage - a.percentage);
      const toDrop = gradedAssignments.splice(0, Math.min(rules.drop_highest, gradedAssignments.length - 1));
      droppedAssignments.push(...toDrop.map(a => ({ ...a, reason: 'highest' })));
    }

    // Handle "never drop" rules
    if (rules.never_drop && Array.isArray(rules.never_drop)) {
      // Move never-drop assignments back if they were dropped
      const neverDropIds = new Set(rules.never_drop);
      const movedBack = droppedAssignments.filter(a => neverDropIds.has(a.id));
      droppedAssignments.splice(0, droppedAssignments.length,
        ...droppedAssignments.filter(a => !neverDropIds.has(a.id)));
      gradedAssignments.push(...movedBack);
    }

    // Calculate totals
    let earnedPoints = 0;
    let possiblePoints = 0;

    for (const assignment of gradedAssignments) {
      earnedPoints += assignment.submission.score;
      possiblePoints += assignment.points_possible;
    }

    // Include ungraded if requested (but not excluded ones)
    if (includeUngraded) {
      const ungradedAssignments = assignments.filter(a => {
        if (excludedSet.has(a.id.toString())) {
          return false;
        }
        return !a.submission || a.submission.score === null || a.submission.score === undefined;
      });

      for (const assignment of ungradedAssignments) {
        if (assignment.points_possible > 0) {
          possiblePoints += assignment.points_possible;
        }
      }
    }

    // Count excluded assignments in this group
    const excludedCount = assignments.filter(a => excludedSet.has(a.id.toString())).length;

    return {
      earnedPoints,
      possiblePoints,
      gradedCount: gradedAssignments.length,
      totalCount: assignments.length,
      excludedCount,
      droppedAssignments
    };
  },

  /**
   * Calculate what-if grade with hypothetical scores
   * @param {array} assignmentGroups - Assignment groups
   * @param {array} whatIfScores - Array of {assignmentId, score} objects
   * @param {object} options - Calculation options
   * @returns {object} What-if grade result
   */
  calculateWhatIfGrade(assignmentGroups, whatIfScores, options = {}) {
    // Create a deep copy of assignment groups
    const modifiedGroups = JSON.parse(JSON.stringify(assignmentGroups));

    // Apply what-if scores
    const whatIfMap = new Map(whatIfScores.map(w => [w.assignmentId, w.score]));

    for (const group of modifiedGroups) {
      for (const assignment of group.assignments || []) {
        if (whatIfMap.has(assignment.id)) {
          const whatIfScore = whatIfMap.get(assignment.id);
          if (!assignment.submission) {
            assignment.submission = {};
          }
          assignment.submission.score = whatIfScore;
        }
      }
    }

    const result = this.calculateCourseGrade(modifiedGroups, options);
    return {
      ...result,
      isWhatIf: true,
      appliedScores: whatIfScores
    };
  },

  /**
   * Calculate what grade is needed on remaining assignments to achieve target
   * @param {array} assignmentGroups - Assignment groups
   * @param {number} targetPercentage - Target grade percentage
   * @param {string} targetAssignmentId - Assignment to calculate for (optional)
   * @returns {object} Required score information
   */
  calculateRequiredScore(assignmentGroups, targetPercentage, targetAssignmentId = null) {
    // Get current grade state
    const currentResult = this.calculateCourseGrade(assignmentGroups, { includeUngraded: false });

    // Find ungraded assignments
    const ungradedAssignments = [];
    for (const group of assignmentGroups) {
      for (const assignment of group.assignments || []) {
        if (!assignment.submission || assignment.submission.score === null || assignment.submission.score === undefined) {
          if (assignment.points_possible > 0) {
            ungradedAssignments.push({
              ...assignment,
              groupName: group.name,
              groupWeight: group.group_weight || 0
            });
          }
        }
      }
    }

    if (ungradedAssignments.length === 0) {
      return {
        possible: false,
        reason: 'No ungraded assignments remaining',
        currentPercentage: currentResult.percentage
      };
    }

    // If targeting a specific assignment
    if (targetAssignmentId) {
      const targetAssignment = ungradedAssignments.find(a => a.id === targetAssignmentId);
      if (!targetAssignment) {
        return {
          possible: false,
          reason: 'Target assignment not found or already graded'
        };
      }

      return this.calculateRequiredScoreForAssignment(
        assignmentGroups,
        targetAssignment,
        targetPercentage,
        currentResult
      );
    }

    // Calculate for all remaining assignments
    return this.calculateRequiredScoreForRemaining(
      assignmentGroups,
      ungradedAssignments,
      targetPercentage,
      currentResult
    );
  },

  /**
   * Calculate required score for a specific assignment
   * @param {array} assignmentGroups - Assignment groups
   * @param {object} targetAssignment - Target assignment
   * @param {number} targetPercentage - Target grade
   * @param {object} currentResult - Current grade calculation
   * @returns {object} Required score details
   */
  calculateRequiredScoreForAssignment(assignmentGroups, targetAssignment, targetPercentage, currentResult) {
    const isWeighted = currentResult.method === 'weighted';

    if (isWeighted) {
      // Complex weighted calculation
      const group = currentResult.groupBreakdown.find(g =>
        assignmentGroups.find(ag => ag.id === g.id)?.assignments?.some(a => a.id === targetAssignment.id)
      );

      if (!group) {
        return { possible: false, reason: 'Could not find assignment group' };
      }

      // Calculate what score is needed
      // Target = (currentWeightedScore + newContribution) / totalWeight * 100
      // newContribution = ((earned + X) / (possible + points)) * weight
      // Solve for X

      const currentGroupEarned = group.earnedPoints;
      const currentGroupPossible = group.possiblePoints;
      const assignmentPoints = targetAssignment.points_possible;
      const groupWeight = group.weight;
      const otherGroupsContribution = currentResult.weightedScore - group.weightedContribution;
      const totalWeight = currentResult.totalWeight;

      // (targetPercentage/100) * totalWeight = otherGroupsContribution + ((currentGroupEarned + X) / (currentGroupPossible + assignmentPoints)) * groupWeight
      // Solve for X:
      const targetWeightedScore = (targetPercentage / 100) * totalWeight;
      const neededFromGroup = targetWeightedScore - otherGroupsContribution;
      const neededGroupPercentage = (neededFromGroup / groupWeight) * 100;
      const neededScore = (neededGroupPercentage / 100) * (currentGroupPossible + assignmentPoints) - currentGroupEarned;

      const percentageNeeded = (neededScore / assignmentPoints) * 100;

      return {
        possible: percentageNeeded <= 100,
        assignmentName: targetAssignment.name,
        assignmentId: targetAssignment.id,
        pointsPossible: assignmentPoints,
        scoreNeeded: Math.max(0, neededScore),
        percentageNeeded: Math.max(0, percentageNeeded),
        targetGrade: targetPercentage,
        isExtraCredit: percentageNeeded > 100,
        explanation: percentageNeeded <= 100
          ? `Score ${neededScore.toFixed(1)}/${assignmentPoints} (${percentageNeeded.toFixed(1)}%) to get ${targetPercentage}%`
          : `Not possible without extra credit - maximum achievable grade calculated`
      };
    } else {
      // Points-based calculation
      const assignmentPoints = targetAssignment.points_possible;
      const currentEarned = currentResult.totalEarned;
      const currentPossible = currentResult.totalPossible;

      // (currentEarned + X) / (currentPossible + assignmentPoints) = targetPercentage / 100
      const neededScore = (targetPercentage / 100) * (currentPossible + assignmentPoints) - currentEarned;
      const percentageNeeded = (neededScore / assignmentPoints) * 100;

      return {
        possible: percentageNeeded <= 100 && percentageNeeded >= 0,
        assignmentName: targetAssignment.name,
        assignmentId: targetAssignment.id,
        pointsPossible: assignmentPoints,
        scoreNeeded: Math.max(0, neededScore),
        percentageNeeded: Math.max(0, percentageNeeded),
        targetGrade: targetPercentage,
        isExtraCredit: percentageNeeded > 100
      };
    }
  },

  /**
   * Calculate required average score on all remaining assignments
   * @param {array} assignmentGroups - Assignment groups
   * @param {array} ungradedAssignments - Ungraded assignments
   * @param {number} targetPercentage - Target grade
   * @param {object} currentResult - Current grade calculation
   * @returns {object} Required average score
   */
  calculateRequiredScoreForRemaining(assignmentGroups, ungradedAssignments, targetPercentage, currentResult) {
    const totalUngradedPoints = ungradedAssignments.reduce((sum, a) => sum + a.points_possible, 0);

    if (currentResult.method === 'points') {
      const currentEarned = currentResult.totalEarned;
      const currentPossible = currentResult.totalPossible;
      const totalPossible = currentPossible + totalUngradedPoints;

      const neededTotalEarned = (targetPercentage / 100) * totalPossible;
      const neededFromRemaining = neededTotalEarned - currentEarned;
      const averageNeeded = (neededFromRemaining / totalUngradedPoints) * 100;

      return {
        possible: averageNeeded <= 100 && averageNeeded >= 0,
        remainingAssignments: ungradedAssignments.length,
        totalRemainingPoints: totalUngradedPoints,
        averagePercentageNeeded: Math.max(0, averageNeeded),
        targetGrade: targetPercentage,
        currentGrade: currentResult.percentage
      };
    } else {
      // For weighted, this is more complex - provide estimate
      return {
        possible: null, // Cannot easily determine
        remainingAssignments: ungradedAssignments.length,
        totalRemainingPoints: totalUngradedPoints,
        note: 'Weighted grading - use individual assignment calculator for accurate results',
        targetGrade: targetPercentage,
        currentGrade: currentResult.percentage
      };
    }
  },

  /**
   * Get assignment breakdown for a course
   * @param {array} assignmentGroups - Assignment groups
   * @returns {array} Flat list of assignments with details
   */
  getAssignmentBreakdown(assignmentGroups) {
    const assignments = [];

    for (const group of assignmentGroups) {
      for (const assignment of group.assignments || []) {
        const submission = assignment.submission || {};
        const isGraded = submission.score !== null && submission.score !== undefined;

        assignments.push({
          id: assignment.id,
          name: assignment.name,
          groupName: group.name,
          groupId: group.id,
          groupWeight: group.group_weight || null,
          pointsPossible: assignment.points_possible,
          score: isGraded ? submission.score : null,
          percentage: isGraded && assignment.points_possible > 0
            ? (submission.score / assignment.points_possible) * 100
            : null,
          isGraded,
          isExcused: submission.excused || false,
          dueDate: assignment.due_at,
          submittedAt: submission.submitted_at
        });
      }
    }

    return assignments.sort((a, b) => {
      // Sort by due date, then by name
      if (a.dueDate && b.dueDate) {
        return new Date(a.dueDate) - new Date(b.dueDate);
      }
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return a.name.localeCompare(b.name);
    });
  },

  /**
   * Calculate statistics for a course
   * @param {array} assignmentGroups - Assignment groups
   * @returns {object} Course statistics
   */
  calculateStatistics(assignmentGroups) {
    const assignments = this.getAssignmentBreakdown(assignmentGroups);
    const gradedAssignments = assignments.filter(a => a.isGraded && !a.isExcused);

    if (gradedAssignments.length === 0) {
      return {
        totalAssignments: assignments.length,
        gradedAssignments: 0,
        averageScore: null,
        highestScore: null,
        lowestScore: null,
        totalPointsEarned: 0,
        totalPointsPossible: 0
      };
    }

    const percentages = gradedAssignments.map(a => a.percentage).filter(p => p !== null);
    const totalPointsEarned = gradedAssignments.reduce((sum, a) => sum + (a.score || 0), 0);
    const totalPointsPossible = gradedAssignments.reduce((sum, a) => sum + (a.pointsPossible || 0), 0);

    return {
      totalAssignments: assignments.length,
      gradedAssignments: gradedAssignments.length,
      averageScore: percentages.length > 0
        ? percentages.reduce((a, b) => a + b, 0) / percentages.length
        : null,
      highestScore: percentages.length > 0 ? Math.max(...percentages) : null,
      lowestScore: percentages.length > 0 ? Math.min(...percentages) : null,
      totalPointsEarned,
      totalPointsPossible,
      completionRate: (gradedAssignments.length / assignments.length) * 100
    };
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GradeCalculator;
}
