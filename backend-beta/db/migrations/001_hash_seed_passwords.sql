UPDATE users
SET password_hash = '232c0fa173295bd8f6ebe22978c9fbe5:5ad08920e1c270163fdd5b410fbb966fc09ed3e4de4265e899738b8b64813d584c96d5683473e4f107dd0d6baf011bfa9af20bef3235786a181190be723063b3'
WHERE email = 'charlie@example.com'
  AND password_hash = 'alpha-demo-only';

UPDATE users
SET password_hash = '1d7fb7f0939660b36734642fddcd67a0:2ce7718aa8b020350a5496f1ed737b08507dc6d7bf5b7c49f4ac1f62d46ec8e66fe9775ebff31875bcee1c2600abc7608fe42d719c2ddc83b19687cadfb9c6be'
WHERE email = 'organizer@example.com'
  AND password_hash = 'alpha-demo-only';
