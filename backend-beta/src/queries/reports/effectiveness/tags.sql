-- Campus tags per event.
SELECT ect.event_id, t.slug, t.name FROM event_campus_tags ect JOIN campus_tags t ON t.id = ect.campus_tag_id WHERE ect.event_id IN (?)
