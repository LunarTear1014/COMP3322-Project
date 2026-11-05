import { DATE_FORMAT, today, timeslot_bounds } from "../../shared/timeslots.js";

// Returns the first validation error message for a POST /api/events body,
// or null when the input is valid. The checks and their order mirror the
// original handler verbatim.
function validate_event_input({ club, title, description, date, venue, timeslot, visibility }) {
  if (typeof club !== "string" || club.trim() === "") {
    return "Club is required";
  }
  if (typeof title !== "string" || title.trim() === "") {
    return "Event title is required";
  }
  if (typeof description !== "string" || description.trim() === "") {
    return "Event description is required";
  }
  if (typeof date !== "string" || !DATE_FORMAT.test(date)) {
    return "Date must look like 2026-10-06";
  }
  if (date < today()) {
    return "The date cannot be in the past";
  }
  if (typeof venue !== "string" || venue.trim() === "") {
    return "Venue is required";
  }
  const bounds = timeslot_bounds(date, timeslot);
  if (!bounds) {
    return "Unknown timeslot";
  }
  if (!["Public", "Members only"].includes(visibility)) {
    return "Visibility must be Public or Members only";
  }
  return null;
}

function validate_event_edit_input({ title, description, date, venue, timeslot, visibility }) {
  if (typeof title !== "string" || title.trim() === "") {
    return "Event title is required";
  }
  if (typeof description !== "string" || description.trim() === "") {
    return "Event description is required";
  }
  if (typeof date !== "string" || !DATE_FORMAT.test(date)) {
    return "Date must look like 2026-10-06";
  }
  if (date < today()) {
    return "The date cannot be in the past";
  }
  if (typeof venue !== "string" || venue.trim() === "") {
    return "Venue is required";
  }
  if (!timeslot_bounds(date, timeslot)) {
    return "Unknown timeslot";
  }
  if (!["Public", "Members only"].includes(visibility)) {
    return "Visibility must be Public or Members only";
  }
  return null;
}

export { validate_event_input, validate_event_edit_input };
