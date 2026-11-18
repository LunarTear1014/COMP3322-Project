import { readFile } from "node:fs/promises";
import { with_transaction } from "../db/transaction.js";
import { delete_cover_files, store_cover } from "../features/covers/cover_service.js";
import { audit, to_db } from "../api_v1/common.js";
import { CLUBS, EVENTS } from "./demo_seed.js";

// Cover images for the demo events (db/demo-images/event-*.jpg, generated
// for ClubSpace). attach_demo_covers gives each demo event its image when the
// event has no cover yet, so it never replaces a cover someone uploaded and a
// second run changes nothing. Events are matched by title within the demo
// club of the same name; covers go through the same pipeline as uploads
// (two WebP renditions on COVER_DIR) and are audited as the club president.

const IMAGE_DIR = new URL("../../db/demo-images/", import.meta.url);

const DEMO_COVERS = {
  "Golden Hour Photo Walk": ["event-golden-hour-photo-walk.jpg", "Students photographing the harbour skyline from a campus terrace at sunset"],
  "Hong Kong New Wave Screening": ["event-hong-kong-new-wave-screening.jpg", "Students in red cinema seats watching a Hong Kong New Wave film"],
  "Intro to British Parliamentary Debate": ["event-intro-british-parliamentary-debate.jpg", "A student explains debate notes to classmates around a seminar table"],
  "Dragon's Back Trail Briefing": ["event-dragons-back-trail-briefing.jpg", "Hikers studying a trail map on a table before a hike"],
  "Line-Follower Robot Workshop": ["event-line-follower-robot-workshop.jpg", "Students adjusting a small robot that follows a black line on a mat"],
  "Portrait Lighting Basics": ["event-portrait-lighting-basics.jpg", "A student photographs a classmate lit by a studio flash and umbrella"],
  "Night Photography on the Harbourfront": ["event-night-photography.jpg", "Students with cameras on tripods shooting the lit-up harbour skyline at night"],
  "Short Film Pitch Night": ["event-film-pitch.jpg", "Students presenting a short film idea on a cinema stage to an audience"],
  "Debate Social: Pizza and Motions": ["event-debate-social.jpg", "Students chatting over pizza at an outdoor table on campus"],
  "Lion Rock Sunrise Hike": ["event-lion-rock.jpg", "Hikers resting on the rocks of Lion Rock as the sun rises over the city"],
  "Robot Sumo Tournament": ["event-robot-sumo.jpg", "Two small robots pushing each other in a sumo ring while students cheer"],
  "Film Camera Swap Meet": ["event-film-camera-swap-meet.jpg", "Students browsing vintage film cameras laid out on a market table"],
  "Members' Screening: Classic Noir": ["event-classic-noir-screening.jpg", "An audience watching a black-and-white noir film in a cinema"],
  "Inter-Hall Debate Trials": ["event-inter-hall-debate-trials.jpg", "A debater speaking at a podium in a wood-panelled debate chamber"],
  "MacLehose Stage 2 Day Hike": ["event-maclehose-stage-2-day-hike.jpg", "Hikers on a coastal trail above a white sand beach and blue sea"],
  "Arduino for Beginners": ["event-arduino-for-beginners.jpg", "Students wiring an Arduino breadboard next to a laptop"],
  "Photo Critique Circle": ["event-photo-critique-circle.jpg", "Students discussing printed photographs spread across a table"],
  "Screenwriting Workshop": ["event-screenwriting-workshop.jpg", "Students working on scripts together around a table with laptops"],
  "Public Speaking Bootcamp": ["event-public-speaking-bootcamp.jpg", "A student speaking to a seated group in a bright hall"],
  "Robotics Lab Open Day": ["event-robotics-lab-open-day.jpg", "Visitors gathered around robots on display tables at an open day"],
  "Volunteer Trail Clean-up": ["event-volunteer-trail-cleanup.jpg", "Volunteers in gloves collecting litter into bags along a hillside trail"],
  "Exhibition Planning Meeting": ["event-exhibition-planning-meeting.jpg", "Students choosing prints for an exhibition around a large table"],
  "Animation Night": ["event-animation-night.jpg", "An audience smiling at a colourful animated film in a cinema"],
  "Debate Workshop: Rebuttals": ["event-debate-workshop-rebuttals.jpg", "A student standing to make a point to classmates in a seminar room"],
  "Drone Racing Demo": ["event-drone-racing-demo.jpg", "Pilots in FPV goggles flying a drone through a lit-up racing gate"],
};

async function attach_demo_covers({ pool, cover_dir, now = new Date(), log = console.log }) {
  const club_names = Object.fromEntries(CLUBS.map((club) => [club.key, club.name]));
  const result = { attached: 0, already: 0, missing: 0 };
  for (const spec of EVENTS) {
    const [file, alt] = DEMO_COVERS[spec.title] ?? [];
    if (!file) continue;
    const [rows] = await pool.query(
      `SELECT e.id, e.cover_key FROM events e JOIN clubs c ON c.id = e.club_id
       WHERE e.title = ? AND c.name = ? ORDER BY e.id`,
      [spec.title, club_names[spec.club]]);
    if (!rows.length) { result.missing += 1; continue; }
    const image = await readFile(new URL(file, IMAGE_DIR));
    for (const row of rows) {
      if (row.cover_key) { result.already += 1; continue; }
      const { key } = await store_cover(cover_dir, image);
      const updated = await with_transaction(pool, async (conn) => {
        const [update] = await conn.query(
          "UPDATE events SET cover_key = ?, cover_alt = ?, cover_updated_at = ?, version = version + 1 WHERE id = ? AND cover_key IS NULL",
          [key, alt, to_db(now), row.id]);
        if (!update.affectedRows) return false;
        const [[president]] = await conn.query(
          "SELECT m.user_id FROM events e JOIN memberships m ON m.club_id = e.club_id AND m.role = 'president' WHERE e.id = ?", [row.id]);
        await audit(conn, { actor: president?.user_id, entity_type: "event", entity_id: row.id, action: "event.cover_set", details: { source: "demo_covers" }, now });
        return true;
      }).catch(async (error) => {
        await delete_cover_files(cover_dir, key);
        throw error;
      });
      if (updated) result.attached += 1;
      else { await delete_cover_files(cover_dir, key); result.already += 1; }
    }
  }
  log?.(`Demo covers: ${result.attached} attached, ${result.already} already had a cover, ${result.missing} demo events not found.`);
  return result;
}

export { DEMO_COVERS, attach_demo_covers };
