# COMP3322 Project

## Frontend

The Alpha React SPA is in `frontend/`.

```bash
cd frontend
npm install
npm run dev
```

It currently uses realistic mock data, so the frontend can be reviewed before
the Express backend is complete. The P0 student discovery, event detail/join,
and organizer event-creation flows are already represented.

To connect Express later, set these values in `frontend/.env`:

```text
VITE_USE_MOCK_API=false
VITE_API_BASE_URL=http://localhost:3000/api
```

The frontend expects these REST endpoints:

```text
GET  /events
GET  /events/:id
POST /events
POST /events/:id/registrations
GET  /venues
GET  /users/:userId/registrations
GET  /organizer/events
```
