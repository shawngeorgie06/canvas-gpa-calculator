/**
 * Canvas LMS API Wrapper
 * Handles all Canvas API interactions with proper authentication and error handling
 */

const CanvasAPI = {
  token: null,
  baseUrl: null,
  rateLimitRemaining: 700,
  rateLimitResetTime: null,

  /**
   * Initialize the API with token and base URL
   * @param {string} token - Canvas API access token
   * @param {string} baseUrl - Canvas instance URL (e.g., https://njit.instructure.com)
   */
  async init(token, baseUrl) {
    this.token = token;
    this.baseUrl = baseUrl?.replace(/\/$/, ''); // Remove trailing slash
  },

  /**
   * Make an authenticated API request
   * @param {string} endpoint - API endpoint (e.g., /api/v1/courses)
   * @param {object} options - Fetch options
   * @returns {Promise<object>} API response
   */
  async request(endpoint, options = {}) {
    if (!this.token) {
      throw new Error('Canvas API token not configured. Please set up your token in the extension settings.');
    }

    if (!this.baseUrl) {
      throw new Error('Canvas base URL not configured. Please set up your Canvas URL in the extension settings.');
    }

    // Check rate limiting
    if (this.rateLimitRemaining <= 10 && this.rateLimitResetTime) {
      const waitTime = this.rateLimitResetTime - Date.now();
      if (waitTime > 0) {
        await this.sleep(waitTime);
      }
    }

    const url = `${this.baseUrl}${endpoint}`;
    const fetchOptions = {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    };

    try {
      const response = await fetch(url, fetchOptions);

      // Update rate limit info from headers
      const remaining = response.headers.get('X-Rate-Limit-Remaining');
      if (remaining) {
        this.rateLimitRemaining = parseInt(remaining, 10);
      }

      // Handle different response statuses
      if (response.status === 401) {
        throw new Error('UNAUTHORIZED: Your Canvas API token is invalid or expired. Please generate a new token.');
      }

      if (response.status === 403) {
        throw new Error('FORBIDDEN: You do not have permission to access this resource.');
      }

      if (response.status === 404) {
        throw new Error('NOT_FOUND: The requested resource was not found.');
      }

      if (response.status === 429) {
        // Rate limited - implement exponential backoff
        const retryAfter = response.headers.get('Retry-After') || 60;
        this.rateLimitResetTime = Date.now() + (parseInt(retryAfter, 10) * 1000);
        throw new Error(`RATE_LIMITED: Too many requests. Please wait ${retryAfter} seconds.`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API_ERROR: ${response.status} - ${errorText}`);
      }

      // Handle empty responses
      const text = await response.text();
      if (!text) return null;

      return JSON.parse(text);
    } catch (error) {
      if (error.message.startsWith('UNAUTHORIZED') ||
          error.message.startsWith('FORBIDDEN') ||
          error.message.startsWith('NOT_FOUND') ||
          error.message.startsWith('RATE_LIMITED') ||
          error.message.startsWith('API_ERROR')) {
        throw error;
      }
      throw new Error(`NETWORK_ERROR: Failed to connect to Canvas. ${error.message}`);
    }
  },

  /**
   * Get paginated results from Canvas API
   * @param {string} endpoint - API endpoint
   * @param {object} params - Query parameters
   * @returns {Promise<array>} All results from all pages
   */
  async getPaginated(endpoint, params = {}) {
    const results = [];
    let url = endpoint;
    const queryParams = new URLSearchParams(params);

    if (queryParams.toString()) {
      url += `?${queryParams.toString()}`;
    }

    while (url) {
      const response = await fetch(`${this.baseUrl}${url}`, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API_ERROR: ${response.status}`);
      }

      const data = await response.json();
      results.push(...(Array.isArray(data) ? data : [data]));

      // Check for next page in Link header
      const linkHeader = response.headers.get('Link');
      url = this.parseNextLink(linkHeader);
    }

    return results;
  },

  /**
   * Parse the Link header to get next page URL
   * @param {string} linkHeader - Link header value
   * @returns {string|null} Next page URL or null
   */
  parseNextLink(linkHeader) {
    if (!linkHeader) return null;

    const links = linkHeader.split(',');
    for (const link of links) {
      const match = link.match(/<([^>]+)>;\s*rel="next"/);
      if (match) {
        // Extract just the path portion
        const url = new URL(match[1]);
        return url.pathname + url.search;
      }
    }
    return null;
  },

  /**
   * Sleep utility for rate limiting
   * @param {number} ms - Milliseconds to sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  // ===== Course Methods =====

  /**
   * Get ALL courses for the current user (including completed/concluded)
   * @returns {Promise<array>} List of all courses
   */
  async getCourses() {
    // Fetch ALL courses - active, completed, and concluded
    const allCourses = [];

    // Get active courses
    try {
      const active = await this.request(
        '/api/v1/courses?include[]=total_scores&include[]=term&include[]=concluded&include[]=total_students&state[]=available&per_page=100'
      );
      if (active) allCourses.push(...active);
    } catch (e) { console.warn('Error fetching active courses:', e); }

    // Get completed/concluded courses
    try {
      const completed = await this.request(
        '/api/v1/courses?include[]=total_scores&include[]=term&include[]=concluded&state[]=completed&per_page=100'
      );
      if (completed) allCourses.push(...completed);
    } catch (e) { console.warn('Error fetching completed courses:', e); }

    // Get unpublished courses (teacher may have hidden)
    try {
      const unpublished = await this.request(
        '/api/v1/courses?include[]=total_scores&include[]=term&state[]=unpublished&per_page=100'
      );
      if (unpublished) allCourses.push(...unpublished);
    } catch (e) { console.warn('Error fetching unpublished courses:', e); }

    // Remove duplicates by course ID
    const uniqueCourses = [];
    const seenIds = new Set();
    for (const course of allCourses) {
      if (!seenIds.has(course.id)) {
        seenIds.add(course.id);
        uniqueCourses.push(course);
      }
    }

    console.log('[Canvas API] Total courses found:', uniqueCourses.length);
    return uniqueCourses;
  },

  /**
   * Get a specific course by ID
   * @param {string} courseId - Course ID
   * @returns {Promise<object>} Course details
   */
  async getCourse(courseId) {
    return this.request(`/api/v1/courses/${courseId}?include[]=total_scores&include[]=term`);
  },

  // ===== Grading Standards Methods =====

  /**
   * Get grading standards for a course (CRITICAL for grading scale detection)
   * @param {string} courseId - Course ID
   * @returns {Promise<array>} Grading standards
   */
  async getGradingStandards(courseId) {
    try {
      const standards = await this.request(`/api/v1/courses/${courseId}/grading_standards`);
      return standards || [];
    } catch (error) {
      // Some courses may not have grading standards
      if (error.message.includes('NOT_FOUND') || error.message.includes('FORBIDDEN')) {
        return [];
      }
      throw error;
    }
  },

  /**
   * Get the active grading standard for a course
   * @param {string} courseId - Course ID
   * @returns {Promise<object|null>} Active grading standard or null
   */
  async getActiveGradingStandard(courseId) {
    try {
      // First try to get course settings to find active grading standard
      const course = await this.request(`/api/v1/courses/${courseId}?include[]=grading_standard`);

      if (course?.grading_standard_id) {
        const standards = await this.getGradingStandards(courseId);
        return standards.find(s => s.id === course.grading_standard_id) || null;
      }

      // If no specific standard, try to get any available standard
      const standards = await this.getGradingStandards(courseId);
      return standards.length > 0 ? standards[0] : null;
    } catch (error) {
      console.warn(`Could not get grading standard for course ${courseId}:`, error);
      return null;
    }
  },

  // ===== Assignment Methods =====

  /**
   * Get all assignments for a course
   * @param {string} courseId - Course ID
   * @returns {Promise<array>} List of assignments
   */
  async getAssignments(courseId) {
    return this.getPaginated(
      `/api/v1/courses/${courseId}/assignments`,
      { per_page: 100, include: ['submission'] }
    );
  },

  /**
   * Get assignment groups for a course (for weighted categories)
   * @param {string} courseId - Course ID
   * @returns {Promise<array>} Assignment groups with weights
   */
  async getAssignmentGroups(courseId) {
    return this.request(
      `/api/v1/courses/${courseId}/assignment_groups?include[]=assignments&include[]=submission`
    );
  },

  // ===== Submission Methods =====

  /**
   * Get all submissions for the current user in a course
   * @param {string} courseId - Course ID
   * @returns {Promise<array>} List of submissions
   */
  async getSubmissions(courseId) {
    try {
      return this.getPaginated(
        `/api/v1/courses/${courseId}/students/submissions`,
        { student_ids: ['self'], per_page: 100 }
      );
    } catch (error) {
      // Fallback: try getting submissions through assignments
      console.warn('Could not get bulk submissions, falling back to individual:', error);
      const assignments = await this.getAssignments(courseId);
      return assignments.map(a => a.submission).filter(Boolean);
    }
  },

  /**
   * Get enrollment info to get current grade
   * @param {string} courseId - Course ID
   * @returns {Promise<object>} Enrollment with grades
   */
  async getEnrollment(courseId) {
    const enrollments = await this.request(
      `/api/v1/courses/${courseId}/enrollments?user_id=self&include[]=current_grading_period_scores`
    );
    return enrollments?.[0] || null;
  },

  // ===== User Methods =====

  /**
   * Get current user profile
   * @returns {Promise<object>} User profile
   */
  async getCurrentUser() {
    return this.request('/api/v1/users/self');
  },

  /**
   * Verify the API token is valid
   * @returns {Promise<boolean>} True if valid
   */
  async verifyToken() {
    try {
      await this.getCurrentUser();
      return true;
    } catch (error) {
      return false;
    }
  },

  // ===== Comprehensive Data Fetching =====

  /**
   * Get complete course data including grades, assignments, and grading scale
   * @param {string} courseId - Course ID
   * @returns {Promise<object>} Complete course data
   */
  async getCompleteCourseData(courseId) {
    try {
      // Fetch all data in parallel for efficiency
      const [course, enrollment, assignmentGroups, gradingStandard] = await Promise.all([
        this.getCourse(courseId),
        this.getEnrollment(courseId),
        this.getAssignmentGroups(courseId),
        this.getActiveGradingStandard(courseId)
      ]);

      return {
        course,
        enrollment,
        assignmentGroups,
        gradingStandard,
        currentGrade: enrollment?.grades?.current_score || null,
        finalGrade: enrollment?.grades?.final_score || null
      };
    } catch (error) {
      console.error(`Error fetching complete data for course ${courseId}:`, error);
      throw error;
    }
  },

  /**
   * Get all courses with their grading data
   * @returns {Promise<array>} All courses with grades
   */
  async getAllCoursesWithGrades() {
    const courses = await this.getCourses();

    console.log('[Canvas API] Raw courses from API:', courses);

    const coursesWithGrades = await Promise.all(
      courses.map(async (course) => {
        try {
          const enrollment = await this.getEnrollment(course.id);
          const gradingStandard = await this.getActiveGradingStandard(course.id);

          // Try multiple ways to get term name
          let termName = null;
          if (course.term && course.term.name) {
            termName = course.term.name;
          } else if (course.enrollment_term_id) {
            termName = `Term ${course.enrollment_term_id}`;
          }

          // Try to extract term from course name (e.g., "CS 101 - Fall 2024")
          if (!termName) {
            const termMatch = course.name.match(/(Fall|Spring|Summer|Winter)\s*'?\d{2,4}/i);
            if (termMatch) {
              termName = termMatch[0];
            }
          }

          // Use FINAL grade if available (for completed courses), otherwise current grade
          // This matches what appears on transcript
          const finalScore = enrollment?.grades?.final_score;
          const currentScore = enrollment?.grades?.current_score;
          const finalLetterGrade = enrollment?.grades?.final_grade;
          const currentLetterGrade = enrollment?.grades?.current_grade;

          // Prefer final grade (transcript grade) over current grade
          const gradeScore = finalScore !== null ? finalScore : currentScore;
          const letterGrade = finalLetterGrade || currentLetterGrade;

          console.log('[Canvas API] Course:', course.name, '| Final:', finalLetterGrade, '| Current:', currentLetterGrade);

          return {
            id: course.id,
            name: course.name,
            code: course.course_code,
            term: termName,
            currentGrade: gradeScore,
            finalGrade: finalScore,
            letterGrade: letterGrade, // This is the transcript grade
            isCompleted: course.workflow_state === 'completed' || course.concluded,
            gradingStandard
          };
        } catch (error) {
          console.warn(`Error fetching grade data for course ${course.id}:`, error);
          return {
            id: course.id,
            name: course.name,
            code: course.course_code,
            term: course.term?.name,
            currentGrade: null,
            error: error.message
          };
        }
      })
    );

    return coursesWithGrades;
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CanvasAPI;
}
