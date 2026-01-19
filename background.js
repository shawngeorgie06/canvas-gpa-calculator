/**
 * Canvas Grade & GPA Calculator - Background Service Worker
 * Handles background tasks, alarms, and messaging
 */

// Initialize extension on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Canvas GPA] Extension installed/updated:', details.reason);

  // Initialize storage with defaults
  const defaults = {
    canvasApiToken: null,
    canvasBaseUrl: null,
    previousGPA: null,
    previousCredits: 0,
    currentSemester: { courses: [] },
    customGradingScales: {},
    settings: {
      showConfidenceIndicators: true,
      autoRefreshInterval: 15,
      enableNotifications: true
    },
    cache: {
      courses: null,
      coursesTimestamp: null,
      grades: {},
      gradesTimestamp: {}
    }
  };

  // Only set defaults for missing keys
  const existingData = await chrome.storage.local.get(null);
  const updates = {};

  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in existingData)) {
      updates[key] = value;
    }
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }

  // Set up periodic refresh alarm
  chrome.alarms.create('refreshGrades', {
    periodInMinutes: 15
  });
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'refreshGrades') {
    console.log('[Canvas GPA] Periodic grade refresh triggered');
    await refreshGradesInBackground();
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(response => sendResponse(response))
    .catch(error => sendResponse({ error: error.message }));

  // Return true to indicate async response
  return true;
});

/**
 * Handle incoming messages
 */
async function handleMessage(message, sender) {
  switch (message.type) {
    case 'GET_COURSES':
      return await getCourses();

    case 'GET_COURSE_GRADES':
      return await getCourseGrades(message.courseId);

    case 'GET_GRADING_SCALE':
      return await getGradingScale(message.courseId);

    case 'SET_CUSTOM_SCALE':
      return await setCustomScale(message.courseId, message.scale);

    case 'CALCULATE_GPA':
      return await calculateGPA();

    case 'REFRESH_DATA':
      return await refreshGradesInBackground();

    case 'VERIFY_TOKEN':
      return await verifyToken();

    default:
      return { error: 'Unknown message type' };
  }
}

/**
 * Refresh grades in background with auto-sync features
 */
async function refreshGradesInBackground() {
  try {
    const { canvasApiToken, canvasBaseUrl, settings, cache: oldCache } = await chrome.storage.local.get([
      'canvasApiToken',
      'canvasBaseUrl',
      'settings',
      'cache'
    ]);

    if (!canvasApiToken || !canvasBaseUrl) {
      return { success: false, reason: 'Not configured' };
    }

    // Fetch courses with term info
    const coursesResponse = await fetch(
      `${canvasBaseUrl}/api/v1/courses?enrollment_state=active&include[]=total_scores&include[]=term&per_page=50`,
      {
        headers: {
          'Authorization': `Bearer ${canvasApiToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!coursesResponse.ok) {
      throw new Error(`API error: ${coursesResponse.status}`);
    }

    const courses = await coursesResponse.json();

    // Auto-sync: Detect semesters and upcoming ones
    const semesterInfo = await autoDetectSemesters(courses);

    // Auto-sync: Auto-exclude upcoming semesters
    await autoExcludeUpcomingSemesters(semesterInfo.upcomingSemesters);

    // Auto-sync: Check for grade changes
    const gradeChanges = detectGradeChanges(oldCache?.courses, courses);

    // Update cache
    await chrome.storage.local.set({
      cache: {
        courses,
        coursesTimestamp: Date.now(),
        grades: oldCache?.grades || {},
        gradesTimestamp: oldCache?.gradesTimestamp || {}
      },
      lastSyncTime: Date.now(),
      detectedSemesters: semesterInfo.semesters,
      upcomingSemesters: semesterInfo.upcomingSemesters
    });

    // Notify if grades changed
    if (gradeChanges.length > 0 && settings?.enableNotifications) {
      await notifyGradeChanges(gradeChanges);
    }

    // Notify content scripts and popup
    chrome.runtime.sendMessage({
      type: 'DATA_REFRESHED',
      gradeChanges: gradeChanges,
      upcomingSemesters: semesterInfo.upcomingSemesters
    }).catch(() => {});

    // Notify any open Canvas tabs
    const tabs = await chrome.tabs.query({ url: '*://*.instructure.com/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'REFRESH_DATA' }).catch(() => {});
    }

    console.log('[Canvas GPA] Auto-sync completed:', {
      courseCount: courses.length,
      semesters: semesterInfo.semesters,
      upcoming: semesterInfo.upcomingSemesters,
      gradeChanges: gradeChanges.length
    });

    return {
      success: true,
      courseCount: courses.length,
      semesters: semesterInfo.semesters,
      upcomingSemesters: semesterInfo.upcomingSemesters,
      gradeChanges: gradeChanges.length
    };
  } catch (error) {
    console.error('[Canvas GPA] Background refresh error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Auto-detect semesters from courses and identify upcoming ones
 */
async function autoDetectSemesters(courses) {
  const semesterSet = new Map();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  for (const course of courses) {
    const termName = course.term?.name || 'Unknown Term';

    // Only process real semesters (Fall/Spring/Summer/Winter + Year)
    if (!isRealSemester(termName)) continue;

    if (!semesterSet.has(termName)) {
      const isUpcoming = isFutureSemester(termName, currentYear, currentMonth);
      semesterSet.set(termName, {
        name: termName,
        isUpcoming: isUpcoming,
        sortKey: getSemesterSortKey(termName)
      });
    }
  }

  // Sort by most recent first
  const allSemesters = Array.from(semesterSet.values())
    .sort((a, b) => b.sortKey - a.sortKey);

  return {
    semesters: allSemesters.map(s => s.name),
    upcomingSemesters: allSemesters.filter(s => s.isUpcoming).map(s => s.name)
  };
}

/**
 * Check if a term is a real semester (Fall/Spring/Summer/Winter + Year)
 */
function isRealSemester(name) {
  if (!name) return false;
  return /^(Fall|Spring|Summer|Winter)\s+\d{4}/i.test(name);
}

/**
 * Check if a semester is upcoming/in-progress (not yet completed)
 */
function isFutureSemester(termName, currentYear, currentMonth) {
  const match = termName.match(/(Spring|Summer|Fall|Winter)\s*'?(\d{2,4})/i);
  if (!match) return false;

  let year = parseInt(match[2]);
  if (year < 100) year += 2000;

  const season = match[1].toLowerCase();

  // Semester END months (when grades are finalized)
  const seasonEndMonth = {
    winter: 2,   // Winter ends ~February
    spring: 5,   // Spring ends ~May
    summer: 8,   // Summer ends ~August
    fall: 12     // Fall ends ~December
  };

  const semesterEndMonth = seasonEndMonth[season] ?? 12;

  // Future year = upcoming
  if (year > currentYear) return true;

  // Same year but semester hasn't ended yet = upcoming
  if (year === currentYear && semesterEndMonth > currentMonth) return true;

  return false;
}

/**
 * Get sort key for semester ordering
 */
function getSemesterSortKey(termName) {
  const match = termName.match(/(Spring|Summer|Fall|Winter)\s*(\d{2,4})/i);
  if (match) {
    let year = parseInt(match[2]);
    if (year < 100) year += 2000;

    const seasonOrder = { winter: 0, spring: 1, summer: 2, fall: 3 };
    const seasonValue = seasonOrder[match[1].toLowerCase()] || 0;

    return year * 10 + seasonValue;
  }
  return 0;
}

/**
 * Auto-exclude upcoming semesters from cumulative GPA
 */
async function autoExcludeUpcomingSemesters(upcomingSemesters) {
  if (!upcomingSemesters || upcomingSemesters.length === 0) return;

  const { excludedSemesters = [] } = await chrome.storage.local.get('excludedSemesters');

  // Merge with existing exclusions (don't remove user's manual exclusions)
  const allExcluded = [...new Set([...excludedSemesters, ...upcomingSemesters])];

  await chrome.storage.local.set({ excludedSemesters: allExcluded });

  console.log('[Canvas GPA] Auto-excluded upcoming semesters:', upcomingSemesters);
}

/**
 * Detect grade changes between old and new course data
 */
function detectGradeChanges(oldCourses, newCourses) {
  const changes = [];

  if (!oldCourses || !Array.isArray(oldCourses)) return changes;

  for (const newCourse of newCourses) {
    const oldCourse = oldCourses.find(c => c.id === newCourse.id);
    if (!oldCourse) continue;

    // Check for grade changes in enrollments
    const oldGrade = oldCourse.enrollments?.[0]?.computed_current_score;
    const newGrade = newCourse.enrollments?.[0]?.computed_current_score;

    if (oldGrade !== newGrade && newGrade != null) {
      changes.push({
        courseId: newCourse.id,
        courseName: newCourse.name,
        oldGrade: oldGrade,
        newGrade: newGrade,
        change: newGrade - (oldGrade || 0)
      });
    }
  }

  return changes;
}

/**
 * Send notification for grade changes
 */
async function notifyGradeChanges(changes) {
  if (changes.length === 0) return;

  // Create notification
  const message = changes.length === 1
    ? `${changes[0].courseName}: ${changes[0].oldGrade?.toFixed(1) || 'N/A'}% → ${changes[0].newGrade?.toFixed(1)}%`
    : `${changes.length} courses have grade updates`;

  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Canvas GPA - Grade Update',
      message: message
    });
  } catch (error) {
    console.log('[Canvas GPA] Could not create notification:', error);
  }
}

/**
 * Get courses from Canvas
 */
async function getCourses() {
  const { canvasApiToken, canvasBaseUrl, cache } = await chrome.storage.local.get([
    'canvasApiToken',
    'canvasBaseUrl',
    'cache'
  ]);

  if (!canvasApiToken || !canvasBaseUrl) {
    throw new Error('Extension not configured');
  }

  // Check cache first (1 hour)
  if (cache?.courses && cache?.coursesTimestamp) {
    const age = Date.now() - cache.coursesTimestamp;
    if (age < 60 * 60 * 1000) {
      return { courses: cache.courses, fromCache: true };
    }
  }

  // Fetch from API
  const response = await fetch(
    `${canvasBaseUrl}/api/v1/courses?enrollment_state=active&include[]=total_scores&include[]=term&per_page=50`,
    {
      headers: {
        'Authorization': `Bearer ${canvasApiToken}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const courses = await response.json();

  // Update cache
  await chrome.storage.local.set({
    cache: {
      ...cache,
      courses,
      coursesTimestamp: Date.now()
    }
  });

  return { courses, fromCache: false };
}

/**
 * Get grades for a specific course
 */
async function getCourseGrades(courseId) {
  const { canvasApiToken, canvasBaseUrl, cache } = await chrome.storage.local.get([
    'canvasApiToken',
    'canvasBaseUrl',
    'cache'
  ]);

  if (!canvasApiToken || !canvasBaseUrl) {
    throw new Error('Extension not configured');
  }

  // Check cache (15 minutes)
  if (cache?.grades?.[courseId] && cache?.gradesTimestamp?.[courseId]) {
    const age = Date.now() - cache.gradesTimestamp[courseId];
    if (age < 15 * 60 * 1000) {
      return { grades: cache.grades[courseId], fromCache: true };
    }
  }

  // Fetch enrollment for grades
  const enrollmentResponse = await fetch(
    `${canvasBaseUrl}/api/v1/courses/${courseId}/enrollments?user_id=self`,
    {
      headers: {
        'Authorization': `Bearer ${canvasApiToken}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!enrollmentResponse.ok) {
    throw new Error(`API error: ${enrollmentResponse.status}`);
  }

  const enrollments = await enrollmentResponse.json();
  const enrollment = enrollments[0];
  const grades = enrollment?.grades || {};

  // Update cache
  const updatedCache = {
    ...cache,
    grades: {
      ...cache?.grades,
      [courseId]: grades
    },
    gradesTimestamp: {
      ...cache?.gradesTimestamp,
      [courseId]: Date.now()
    }
  };
  await chrome.storage.local.set({ cache: updatedCache });

  return { grades, fromCache: false };
}

/**
 * Get grading scale for a course
 */
async function getGradingScale(courseId) {
  const { canvasApiToken, canvasBaseUrl, customGradingScales } = await chrome.storage.local.get([
    'canvasApiToken',
    'canvasBaseUrl',
    'customGradingScales'
  ]);

  // Check for custom scale first
  if (customGradingScales?.[courseId]) {
    return {
      scale: customGradingScales[courseId].scale,
      source: 'manual_override',
      confidence: 100
    };
  }

  if (!canvasApiToken || !canvasBaseUrl) {
    return getDefaultGradingScale();
  }

  // Try Canvas API
  try {
    const response = await fetch(
      `${canvasBaseUrl}/api/v1/courses/${courseId}/grading_standards`,
      {
        headers: {
          'Authorization': `Bearer ${canvasApiToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.ok) {
      const standards = await response.json();
      if (standards.length > 0 && standards[0].grading_scheme) {
        return {
          scale: convertCanvasScheme(standards[0].grading_scheme),
          source: 'canvas_api',
          confidence: 95,
          title: standards[0].title
        };
      }
    }
  } catch (error) {
    console.warn('[Canvas GPA] Could not fetch grading standard:', error);
  }

  return getDefaultGradingScale();
}

/**
 * Set custom grading scale
 */
async function setCustomScale(courseId, scale) {
  const { customGradingScales } = await chrome.storage.local.get('customGradingScales');

  const updatedScales = {
    ...customGradingScales,
    [courseId]: {
      scale,
      lastUpdated: new Date().toISOString()
    }
  };

  await chrome.storage.local.set({ customGradingScales: updatedScales });
  return { success: true };
}

/**
 * Calculate GPA from stored courses
 */
async function calculateGPA() {
  const { currentSemester, previousGPA, previousCredits } = await chrome.storage.local.get([
    'currentSemester',
    'previousGPA',
    'previousCredits'
  ]);

  const courses = currentSemester?.courses || [];

  // Calculate semester GPA
  let totalQualityPoints = 0;
  let totalCredits = 0;

  for (const course of courses) {
    if (course.gradePoints !== null && course.credits) {
      totalQualityPoints += course.gradePoints * course.credits;
      totalCredits += course.credits;
    }
  }

  const semesterGPA = totalCredits > 0 ? totalQualityPoints / totalCredits : null;

  // Calculate cumulative GPA
  let cumulativeGPA = semesterGPA;

  if (previousGPA !== null && previousCredits > 0) {
    const prevQualityPoints = previousGPA * previousCredits;
    const totalQP = prevQualityPoints + totalQualityPoints;
    const totalCr = previousCredits + totalCredits;
    cumulativeGPA = totalCr > 0 ? totalQP / totalCr : null;
  }

  return {
    semesterGPA: semesterGPA !== null ? Math.round(semesterGPA * 1000) / 1000 : null,
    semesterCredits: totalCredits,
    cumulativeGPA: cumulativeGPA !== null ? Math.round(cumulativeGPA * 1000) / 1000 : null,
    totalCredits: (previousCredits || 0) + totalCredits
  };
}

/**
 * Verify API token
 */
async function verifyToken() {
  const { canvasApiToken, canvasBaseUrl } = await chrome.storage.local.get([
    'canvasApiToken',
    'canvasBaseUrl'
  ]);

  if (!canvasApiToken || !canvasBaseUrl) {
    return { valid: false, reason: 'Not configured' };
  }

  try {
    const response = await fetch(`${canvasBaseUrl}/api/v1/users/self`, {
      headers: {
        'Authorization': `Bearer ${canvasApiToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const user = await response.json();
      return { valid: true, user: user.name };
    } else {
      return { valid: false, reason: `HTTP ${response.status}` };
    }
  } catch (error) {
    return { valid: false, reason: error.message };
  }
}

/**
 * Convert Canvas grading scheme format
 */
function convertCanvasScheme(canvasScheme) {
  const scale = {};
  const sortedScheme = [...canvasScheme].sort((a, b) => b.value - a.value);

  for (let i = 0; i < sortedScheme.length; i++) {
    const current = sortedScheme[i];
    const min = current.value * 100;
    const max = i === 0 ? 100 : (sortedScheme[i - 1].value * 100) - 0.01;

    scale[current.name] = {
      min: Math.round(min * 100) / 100,
      max: Math.round(max * 100) / 100
    };
  }

  return scale;
}

/**
 * Get default grading scale
 */
function getDefaultGradingScale() {
  return {
    scale: {
      'A': { min: 93, max: 100 },
      'A-': { min: 90, max: 92.99 },
      'B+': { min: 87, max: 89.99 },
      'B': { min: 83, max: 86.99 },
      'B-': { min: 80, max: 82.99 },
      'C+': { min: 77, max: 79.99 },
      'C': { min: 73, max: 76.99 },
      'C-': { min: 70, max: 72.99 },
      'D+': { min: 67, max: 69.99 },
      'D': { min: 63, max: 66.99 },
      'D-': { min: 60, max: 62.99 },
      'F': { min: 0, max: 59.99 }
    },
    source: 'default_fallback',
    confidence: 50,
    warning: 'Using default scale. Please verify with syllabus.'
  };
}

// Log when service worker starts
console.log('[Canvas GPA] Background service worker started');
