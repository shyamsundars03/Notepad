# Dark Notepad

A Vite + React notepad app with a dark interface, large editor modal, local browser persistence, and MongoDB-backed Vercel API routes.

## Local setup

```bash
npm install
npm run dev
```

For MongoDB sync, create `.env.local` or set Vercel environment variables:

```bash
MONGODB_URI=mongodb+srv://YOUR_USER:YOUR_PASSWORD@YOUR_CLUSTER.mongodb.net/
MONGODB_DB=notepad_app
MONGODB_COLLECTION=demoNotes
```

MongoDB will store every note in the `demoNotes` collection with this shape:

```json
{
  "noteID": "mongodb-object-id-string",
  "heading": "Note heading",
  "notes": "Full note text",
  "created": "ISO date string",
  "updated": "ISO date string"
}
```

The browser also keeps a copy in `localStorage`, so notes stay visible after refresh even when the API is unavailable. To test the real MongoDB API locally, run the project through Vercel dev tooling instead of plain `npm run dev`, because Vite alone only serves the frontend.
