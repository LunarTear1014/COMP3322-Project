## ADDED Requirements

### Requirement: Upload an event cover

The API SHALL provide `PUT /api/v1/events/:id/cover`, accepting `multipart/form-data` with fields `file`, `alt` (1–200 characters) and `expected_version`. Only committee members of the event's club SHALL be allowed to upload, for events in the draft or published state. Origin and CSRF checks SHALL apply as for other mutations. A successful upload SHALL return 200 with the updated Event and increment its version.

#### Scenario: Committee member uploads a valid cover
- **WHEN** a committee member of the event's club uploads a 1600×1067 JPEG with alt text and the current `expected_version`
- **THEN** the response is 200 with `cover` populated and a new `version`

#### Scenario: Non-committee user attempts an upload
- **WHEN** a user who is not on the club's committee uploads a cover for a visible event
- **THEN** the response is 403 FORBIDDEN and no file is stored

#### Scenario: Stale version
- **WHEN** the upload's `expected_version` is older than the event's version
- **THEN** the response is 409 STALE_VERSION and no file is stored

#### Scenario: Cancelled event
- **WHEN** a committee member uploads a cover for a cancelled event
- **THEN** the response is 409 INVALID_STATE

### Requirement: Validate cover uploads

The API SHALL reject request bodies over 5 MB with 413 PAYLOAD_TOO_LARGE before parsing the image. It SHALL decode the image to determine its format, without trusting the file name or declared type, and SHALL accept only JPEG and WebP. It SHALL reject images smaller than 1200×800 with 422 VALIDATION_FAILED and a field error on `file`.

#### Scenario: Wrong type renamed as JPEG
- **WHEN** a PNG or a non-image file is uploaded with a `.jpg` name and `image/jpeg` type
- **THEN** the response is 415 UNSUPPORTED_MEDIA_TYPE and no file is stored

#### Scenario: Image too small
- **WHEN** an 800×600 JPEG is uploaded
- **THEN** the response is 422 VALIDATION_FAILED with `fields.file` explaining the minimum size

### Requirement: Sanitize stored covers

Stored renditions SHALL have all metadata removed (including GPS), SHALL be auto-oriented and centre-cropped to 3:2, and SHALL be saved as WebP at 600×400 (`card`) and 1200×800 (`full`) under random names that contain no user input.

#### Scenario: Location metadata removed
- **WHEN** a JPEG containing EXIF GPS coordinates is uploaded
- **THEN** neither stored rendition contains EXIF, XMP or GPS metadata

### Requirement: Replace and remove a cover

Uploading a new cover SHALL replace the previous one. `DELETE /api/v1/events/:id/cover` with `{expected_version}` SHALL remove it, with the same permissions as upload. Files of a replaced or removed cover SHALL be deleted after the database change commits. Files with no referencing event SHALL be removed by a scheduled sweep.

#### Scenario: Replace a cover
- **WHEN** a committee member uploads a new cover for an event that already has one
- **THEN** the event references only the new files, and the old files are deleted

#### Scenario: Remove a cover
- **WHEN** a committee member deletes the cover with the current version
- **THEN** the response is 200 with `cover: null`, and the event shows the fallback cover

### Requirement: Serve covers with event visibility

The API SHALL serve renditions through `GET /api/v1/events/:id/cover/:size`, with `size` being `card` or `full`. It SHALL apply the same visibility rules as `GET /api/v1/events/:id`, returning 404 NOT_FOUND when the event is hidden from the viewer or has no cover. Responses SHALL be `image/webp` with `Cache-Control: private, max-age=86400` and an ETag that changes when the cover changes.

#### Scenario: Student views a published event's cover
- **WHEN** a signed-in student requests the `card` cover of a published event they can see
- **THEN** the response is 200 `image/webp` with private caching headers

#### Scenario: Cover of another club's draft
- **WHEN** a user who cannot see a draft event requests its cover
- **THEN** the response is 404 NOT_FOUND, exactly as for the event itself

### Requirement: Expose covers on event responses

Event and EventSummary DTOs SHALL include `cover`, which is either `null` or `{card_url, full_url, alt, width: 1200, height: 800, updated_at}`. The URLs SHALL point to the serving route and change when the cover changes.

#### Scenario: List events with covers
- **WHEN** a student lists events and one has a cover
- **THEN** that EventSummary's `cover.card_url` and `cover.alt` are present, and events without covers have `cover: null`
