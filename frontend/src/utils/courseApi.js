// frontend/src/utils/courseApi.js
// Wrapper for opengolfapi.org — no key required

const BASE = 'https://api.opengolfapi.org/v1';

// Search courses by name — returns array of course summaries
export async function searchCourses(query) {
  if (!query || query.trim().length < 2) return [];
  try {
    const res = await fetch(`${BASE}/courses/search?q=${encodeURIComponent(query.trim())}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.courses || [];
  } catch { return []; }
}

// Get tees for a course — returns array of tee objects with slope/rating
export async function getCourseTees(courseId) {
  try {
    const res = await fetch(`${BASE}/courses/${courseId}/tees`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.tees || [];
  } catch { return []; }
}
