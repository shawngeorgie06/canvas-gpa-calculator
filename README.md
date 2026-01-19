# Canvas Grade & GPA Calculator

A Chrome extension for college students using Canvas LMS that provides accurate grade calculations with **course-specific grading scales**.

## Why This Matters

Different professors use different grading scales:
- Course 1: A = 93%+ → 91.5% = A- (3.7 GPA)
- Course 2: A = 90%+ → 91.5% = A (4.0 GPA)

**Same percentage, different scales = different GPAs.** This extension detects and uses the correct scale for each course.

## Features

### Core Features
- **Course-Specific Grading Scales**: Automatically detects grading scales from Canvas API
- **Manual Scale Override**: Set custom scales when auto-detection isn't available
- **Semester GPA Calculation**: Calculates GPA across all current courses
- **Cumulative GPA Tracking**: Input previous GPA/credits to track overall GPA
- **What-If Calculator**: See how scores affect your grade
- **Target GPA Planner**: Calculate what GPA you need to reach your goal

### Grading Scale Detection (Priority Order)
1. **Manual Override** (100% confidence) - Always takes precedence
2. **Canvas API** (95% confidence) - Detected from course settings
3. **Default Fallback** (50% confidence) - Standard plus/minus scale with warning

### Academic Standing
- Dean's List detection (3.5+ GPA)
- Good Standing indicator
- Academic Probation warnings

## Installation

### From Source (Developer Mode)
1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (top right toggle)
4. Click "Load unpacked"
5. Select the `canvas-gpa-calculator` folder

### Setup
1. Click the extension icon in Chrome
2. Go to the **Settings** tab
3. Enter your Canvas URL (e.g., `https://njit.instructure.com`)
4. Generate and enter your Canvas API token:
   - In Canvas: Account → Settings → + New Access Token
   - Copy the token and paste it in the extension
5. Click "Save & Connect"

## Usage

### Popup Dashboard
Click the extension icon to see:
- Semester GPA and credits
- Cumulative GPA
- Academic standing
- Course impact analysis
- Target GPA calculator

### On Canvas Pages
When viewing a Canvas course, a grade widget appears in the sidebar showing:
- Current grade with course-specific letter grade
- Grading scale source and confidence
- What-if calculator
- Target grade calculator

### Editing Grading Scales
If the default scale is shown (50% confidence), you can:
1. Click "Edit Scale" on any course
2. Enter the correct scale from your syllabus
3. Save - your override will always be used

## File Structure

```
canvas-gpa-calculator/
├── manifest.json           # Chrome extension manifest
├── background.js           # Service worker for background tasks
├── content.js              # Injects UI into Canvas pages
├── popup/
│   ├── popup.html          # Extension popup UI
│   ├── popup.js            # Popup logic
│   └── popup.css           # Popup styles
├── utils/
│   ├── storage.js          # Chrome storage wrapper
│   ├── canvas-api.js       # Canvas API client
│   ├── grading-scale-detector.js  # Scale detection logic
│   ├── grade-calculator.js # Grade calculation engine
│   └── gpa-calculator.js   # GPA calculation engine
├── ui/
│   ├── styles.css          # Content script styles
│   ├── dashboard.js        # Dashboard component
│   └── grading-scale-editor.js  # Scale editor modal
└── icons/
    └── icon.svg            # Extension icon source
```

## Privacy & Security

- **All data stored locally** in Chrome storage
- **No external servers** - all processing happens in your browser
- **No data collection** - your grades stay private
- API token stored securely in local storage

## Disclaimer

- Not affiliated with Canvas or Instructure
- For educational purposes only
- Always verify grades with official transcripts
- Always confirm grading scales with your syllabus

## Technical Notes

### Canvas API Endpoints Used
- `GET /api/v1/courses` - List courses
- `GET /api/v1/courses/:id/grading_standards` - Get grading scales
- `GET /api/v1/courses/:id/assignment_groups` - Get assignments with weights
- `GET /api/v1/courses/:id/enrollments` - Get current grades

### Caching
- Courses: 1 hour cache
- Grades: 15 minute cache
- Manual refresh available anytime

## Contributing

Contributions welcome! Please ensure any changes:
1. Maintain the course-specific grading scale feature
2. Keep all data local (no external servers)
3. Follow existing code style

## License

MIT License - See LICENSE file for details
