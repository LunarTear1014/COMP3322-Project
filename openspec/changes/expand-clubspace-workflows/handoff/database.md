# Database schema and migration handoff

**Design only.** DDL below is a target definition, not a migration to paste into production. The implementer must create ordered, checksummed migrations and execute them against both a fresh database and a copy of Alpha. Never use destructive `schema.sql` as an upgrade.

## 1. Storage conventions and existing defect

MySQL8.4, InnoDB, utf8mb4_unicode_ci for user text. Business existing IDs stay INT to match current foreign keys; new append-only IDs BIGINT UNSIGNED but serialized as safe JSON numbers only while <=Number.MAX_SAFE_INTEGER (fail before overflow, or introduce a separately reviewed string-ID contract). DATETIME(6) is UTC by convention and connection timezone +00:00. Adapter session IDs and dedup/token fields use binary collation to preserve case. New tables retain records: no cascade deletion of event/history/job/audit through a public API.

Current fresh schema creates `idx_users_role` on `users.role`, which does not exist. Remove that statement when updating fresh setup; add an index on the actual new platform_role field. Do not recreate the obsolete role column or convert club committee rights into global roles.

## 2. Existing tables: exact target changes

| Table | Add/change | Constraints/backfill |
| --- | --- | --- |
| users | platform_role ENUM('student','venue_admin') NOT NULL DEFAULT 'student' | All existing users student; no automatic admin promotion. name remains VARCHAR255 storage, API max100. Hash stays VARCHAR255. Normalize email only after duplicate preflight |
| venues | is_active BOOLEAN NOT NULL DEFAULT TRUE | Existing capacity check>0 retained; target max500, abort on oversized legacy venues until reviewed |
| bookings | status ENUM('pending','confirmed','rejected','cancelled') NOT NULL DEFAULT 'pending'; version INT UNSIGNED NOT NULL DEFAULT1; requested_by INT NULL; decided_by INT NULL; decided_at DATETIME(6) NULL; decision_reason VARCHAR500 NULL; start_time/end_time ->DATETIME(6) UTC | Existing confirmed/cancelled retained. Actor NULL denotes legacy, never fabricated. Both actor FKs users.id RESTRICT. CHECK version>=1 and end>start |
| events | status ENUM('draft','published','cancelled') NOT NULL DEFAULT 'draft'; version INT UNSIGNED NOT NULL DEFAULT1; registration_closes_at DATETIME(6); created_by INT NULL; start_time/end_time ->DATETIME(6) UTC | Preserve existing statuses. Backfill closes_at=start_time; then NOT NULL and CHECK closes_at<=start_time. created_by FK users.id RESTRICT; existing NULL legacy. Capacity1..500 and<=venue enforced by service; event capacity<=venue cross-table preflight |
| participations | status extends ENUM('joined','left','waitlisted','cancelled'); last_registered_at DATETIME(6) NOT NULL; queued_at DATETIME(6) NULL; confirmed_at DATETIME(6) NULL; left_at ->DATETIME(6) NULL | Keep PK(user_id,event_id), existing joined_at as first registration timestamp. Backfill last_registered_at from joined_at; queued_at for waiting, confirmed_at for joined. queued_at retained through promotion; reset on a new waiting lifecycle. left_at cleared on rejoin and set on left/cancelled |
| memberships | existing schema retained | PK(user_id,club_id); role member/committee; do not erase existing committee |

CHECK timing allows historical deadlines in the past; future-only checks belong to create/publish services. Draft legacy actors NULL are permitted by schema, but new API writes must supply them. Rejection requires nonempty reason in service; decision actor/time required for new decisions, not retroactively for legacy confirmed rows.

Indexes to add or replace after preflight:
```sql
CREATE INDEX idx_users_platform_role ON users(platform_role);
CREATE INDEX idx_memberships_club_role ON memberships(club_id, role, user_id);
CREATE INDEX idx_bookings_venue_status_time ON bookings(venue_id, status, start_time, end_time);
CREATE INDEX idx_bookings_review ON bookings(status, created_at, id);
CREATE INDEX idx_events_club_status_start ON events(club_id, status, start_time, id);
CREATE INDEX idx_events_reminder ON events(status, start_time, id);
CREATE INDEX idx_participations_waitlist ON participations(event_id, status, queued_at, user_id);
CREATE INDEX idx_participations_user_status ON participations(user_id, status, event_id);
```
Review existing overlapping indexes with EXPLAIN before dropping any; do not add duplicate names on partially upgraded databases. Keep existing events.booking_id uniqueness, fk_events_booking_club and booking/event club FKs. After UTC backfill and equality validation, add UNIQUE bookings(id,club_id,start_time,end_time) and corresponding composite FK from events(booking_id,club_id,start_time,end_time) to enforce matched intervals. Keep named constraints consistent in fresh schema and upgrades. A future timing edit requires a different design; it is intentionally prohibited here.

## 3. New tables: target DDL

```sql
CREATE TABLE sessions (
  session_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id),
  INDEX idx_sessions_expires (expires)
) ENGINE=InnoDB;

CREATE TABLE participation_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id INT NOT NULL,
  user_id INT NOT NULL,
  actor_user_id INT NULL,
  action_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action ENUM('joined','waitlisted','left','promoted','cancelled') NOT NULL,
  from_status ENUM('joined','waitlisted','left','cancelled') NULL,
  to_status ENUM('joined','waitlisted','left','cancelled') NOT NULL,
  reason VARCHAR(100) NULL,
  occurred_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_history_action_user (action_id,event_id,user_id),
  INDEX idx_history_event_time (event_id,occurred_at,id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  action_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_user_id INT NULL,
  entity_type ENUM('booking','event','membership') NOT NULL,
  entity_id INT NOT NULL,
  action VARCHAR(80) NOT NULL,
  details JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_audit_action (action_id),
  INDEX idx_audit_entity_time (entity_type,entity_id,created_at),
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  action_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  type ENUM('booking_requested','booking_decided','registration_changed',
    'event_changed','event_cancelled','event_reminder') NOT NULL,
  event_id INT NULL,
  booking_id INT NULL,
  payload JSON NOT NULL,
  status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  due_at DATETIME(6) NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  lock_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  locked_until DATETIME(6) NULL,
  last_error VARCHAR(1000) NULL,
  created_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jobs_action_key (action_key),
  INDEX idx_jobs_due (status,due_at,id),
  INDEX idx_jobs_lease (status,locked_until,id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CHECK (attempts<=5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  event_id INT NULL,
  booking_id INT NULL,
  type VARCHAR(40) NOT NULL,
  dedup_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME(6) NOT NULL,
  read_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notifications_recipient_key (user_id,dedup_key),
  INDEX idx_notifications_inbox (user_id,created_at,id),
  INDEX idx_notifications_unread (user_id,read_at,id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE worker_heartbeats (
  worker_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  last_seen_at DATETIME(6) NOT NULL,
  PRIMARY KEY (worker_id)
) ENGINE=InnoDB;

CREATE TABLE schema_metadata (
  metadata_key VARCHAR(64) NOT NULL,
  metadata_value VARCHAR(255) NOT NULL,
  PRIMARY KEY (metadata_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE schema_migrations (
  version VARCHAR(80) NOT NULL,
  checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  applied_at DATETIME(6) NOT NULL,
  PRIMARY KEY (version)
) ENGINE=InnoDB;
```
Audit entity_id is a polymorphic reference and has no cross-table FK; service verifies it exists. Membership audit uses club ID as entity_id and details.user_id to identify member. No physical delete endpoint exists. type values in notifications must be application-allowlisted to the job enum. Job payload is validated internally, bounded <=1500 recipient IDs, and never trusts API-supplied recipients. Retain completed jobs/history/audit for the project; storage cleanup is not part of this release.

## 4. Migration execution order

| Migration | Operations | Required verification |
| --- | --- | --- |
| 001_preflight_and_tracking | Create migration tracking; verify MySQL8.4/InnoDB, actual baseline columns/constraints, DB backup and schema version | Abort on unknown partial schema/checksum mismatch; do not guess |
| 002_add_workflow_columns | Add nullable actor/timing fields, versions/defaults and expanded enums; retain existing rows/statuses | Counts/IDs/FKs unchanged |
| 003_add_support_tables | Create sessions/history/jobs/notifications/audit/heartbeat/metadata | Correct collation, FKs and unique keys |
| 004_backfill_utc_and_defaults | Operator-approved timezone conversion, closes_at, participation metadata, normalize emails after conflict review | Event/booking intervals match, no double conversion, no new privilege |
| 005_enforce_constraints_indexes | NOT NULL/checks/indexes/composite interval FK | No conflicts/orphans, capacity valid, new EXPLAIN plans |
| 006_cutover_marker | Persist schema version and history_complete_from=UTC cutover; provision demo credentials separately | Both processes enforce version; no fabricated history |

Migration IDs are targets, not scripts included/executed here. Runner acquires MySQL advisory lock for this database before inspecting/applying migrations, verifies checksum, and records a version only after its entire intended step succeeds. DDL can commit implicitly: rerun must inspect exact schema to resume safely after partial DDL; it cannot assume rollback removed CREATE/ALTER work. Test injected mid-migration failures. Never use blanket FOREIGN_KEY_CHECKS=0 to force invalid production data through.

## 5. Preflight/backfill decisions

- Check orphaned event/booking/participation links; mismatched club or interval; confirmed booking overlaps; event capacity>venue capacity; venue/event capacity>500; existing queue>500; duplicate normalized emails/student IDs. Abort and produce a repair report; never silently delete conflicting bookings or choose a winner.
- Obtain explicit `LEGACY_DATETIME_TIMEZONE` from operator. Alpha start_time/end_time are DATETIME, not self-identifying instants. If confirmed Hong Kong-local, convert once by -08:00; if UTC, no conversion. Track completion in migration version. Do not shift existing TIMESTAMP created_at/joined_at again; read with UTC session timezone when backfilling DATETIME columns.
- Existing confirmed/published pairs stay confirmed/published; cancelled pairs remain cancelled. Reject impossible lifecycle combinations for operator repair. created_by/requested_by/decided_by remain NULL for legacy entries. Do not claim old approvals were made by a newly created admin.
- Keep memberships. Set every existing platform_role student; explicitly provision a separate venue_admin with secure password outside committed seed data. Existing alpha-demo-only hash must not authenticate. Seed development accounts via an environment-supplied password and normal hasher; never ship a fixed public production admin password.
- Existing participation state populates current counts, but do not invent daily history dates from current state. Set history_complete_from to migration cutover. History action time on actual future mutations is server UTC now.
- Existing events may be past: their closes_at=start is valid. New API writes enforce future rules; migration does not move dates to make examples pass.

## 6. Cross-table invariants and operational rollout

No SQL CHECK can compare event capacity to venue or prevent arbitrary interval overlaps across rows here. Services enforce those under sentinel locks. Current counts are derived from participation rows; no counter column to drift. Confirmed requests must not overlap for a venue. Event and booking times/club match. Published requires confirmed booking; cancellation changes the linked records together.

Maintenance release: stop writes/API+worker, backup and test restore, run migrations with dedicated privileged migration account, provision roles/passwords, deploy matching API/frontend/worker, verify schema version and health, then reopen traffic. Runtime DB account has DML only, not migration DDL privileges. Do not remove all user data through fresh schema setup.

Rollback before new writes: restore tested full snapshot and old application together. After new writes: prefer forward fix; snapshot restore loses those writes and requires explicit operational decision. A DROP-column down script or application-only rollback is not a safe promised recovery. Document DB/server versions, backup identifier, migration checksums and verification evidence in release notes.

## 7. Fresh-install baseline and exact mutation metadata

Use one canonical migration chain: fresh setup creates the corrected Alpha base (without the nonexistent-role index), then migrations001-006. Alternatively a generated final schema snapshot may be distributed, but it must insert the matching migration checksums/version and prove structural equivalence to that chain. Never create the final tables and blindly reapply ALTER ADD migrations. `schema.sql` reset remains explicitly development-only and must not be run by production startup.

Retain existing TIMESTAMP created_at/updated_at/first joined_at with connection timezone UTC; only the explicitly listed business DATETIME fields are converted/backfilled. New DATETIME audit/job timestamps use server application UTC clock/UTC_TIMESTAMP(6), consistently. Set participation.left_at on both withdrawal and cancellation; new joined lifecycle clears queued_at, while promotion preserves original queued_at for traceability. Rejoin resets last_registered_at/queue metadata and does not mutate historical rows.

Store schema_metadata.history_complete_from and schema_metadata.schema_version at cutover. Session cleanup is adapter-controlled; migrations do not backfill sessions. Worker uses stable per-process worker_id for heartbeat and excludes stale historical workers from active-process checks. Operator requeue of a failed job resets attempts/lease/due_at and appends an audit/operator record before processing; no public requeue API. The runtime queue limit cannot be bypassed by incrementing attempts beyond the CHECK.
