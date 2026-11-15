// Campus and club tags (beta-feedback.md, migration 012).
const OPTIONS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

const CAMPUS_TAGS = [
  ["academic", "Academic"], ["arts", "Arts"], ["career", "Career"], ["culture", "Culture"],
  ["free-food", "Free food"], ["music", "Music"], ["social", "Social"], ["sports", "Sports"],
  ["tech", "Tech"], ["volunteering", "Volunteering"],
];

export async function up(ctx) {
  await ctx.create_table("campus_tags", `CREATE TABLE campus_tags (
    id INT NOT NULL AUTO_INCREMENT,
    slug VARCHAR(32) NOT NULL,
    name VARCHAR(40) NOT NULL,
    retired_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_campus_tags_slug (slug)
  ) ${OPTIONS}`);

  await ctx.create_table("club_tags", `CREATE TABLE club_tags (
    id INT NOT NULL AUTO_INCREMENT,
    club_id INT NOT NULL,
    name VARCHAR(24) NOT NULL,
    name_key VARCHAR(24) AS (LOWER(name)) STORED,
    PRIMARY KEY (id),
    UNIQUE KEY uq_club_tags_name (club_id, name_key),
    CONSTRAINT fk_club_tags_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
  ) ${OPTIONS}`);

  await ctx.create_table("event_campus_tags", `CREATE TABLE event_campus_tags (
    event_id INT NOT NULL,
    campus_tag_id INT NOT NULL,
    PRIMARY KEY (event_id, campus_tag_id),
    INDEX idx_event_campus_tags_tag (campus_tag_id, event_id),
    CONSTRAINT fk_ect_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    CONSTRAINT fk_ect_tag FOREIGN KEY (campus_tag_id) REFERENCES campus_tags(id)
  ) ${OPTIONS}`);

  await ctx.create_table("event_club_tags", `CREATE TABLE event_club_tags (
    event_id INT NOT NULL,
    club_tag_id INT NOT NULL,
    PRIMARY KEY (event_id, club_tag_id),
    CONSTRAINT fk_eclt_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    CONSTRAINT fk_eclt_tag FOREIGN KEY (club_tag_id) REFERENCES club_tags(id) ON DELETE CASCADE
  ) ${OPTIONS}`);

  for (const [slug, name] of CAMPUS_TAGS) {
    await ctx.query("INSERT IGNORE INTO campus_tags (slug, name) VALUES (?, ?)", [slug, name]);
  }
  // Existing events get Social; INSERT IGNORE keeps reruns harmless.
  await ctx.query(
    `INSERT IGNORE INTO event_campus_tags (event_id, campus_tag_id)
     SELECT e.id, t.id FROM events e JOIN campus_tags t ON t.slug = 'social'`);
}
