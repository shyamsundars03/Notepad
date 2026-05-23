import express from 'express';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';

dotenv.config({ path: '.env.local' });

const app = express();
const PORT = 3001;

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'notepad_app';
const collectionName = process.env.MONGODB_COLLECTION || 'demoNotes';

let cachedClient;

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: '✅ API Server Running', port: PORT });
});

async function getCollection() {
  if (!uri) {
    console.error('❌ MONGODB_URI is missing in .env.local');
    throw new Error('Missing MONGODB_URI environment variable');
  }

  if (!cachedClient) {
    try {
      console.log('🔗 Connecting to MongoDB...');
      cachedClient = new MongoClient(uri);
      await cachedClient.connect();
      console.log('✅ Connected to MongoDB successfully!');
    } catch (error) {
      console.error('❌ MongoDB Connection Failed:', error.message);
      cachedClient = null; // Reset so it retries next time
      throw error;
    }
  }

  return cachedClient.db(dbName).collection(collectionName);
}

function cleanNote(note) {
  return {
    noteID: note.noteID || note._id.toString(),
    heading: note.heading || note.title || '',
    notes: note.notes || note.body || '',
    created: note.created || note.createdAt,
    updated: note.updated || note.updatedAt,
  };
}

function noteFilter(id) {
  if (!id) return null;
  if (ObjectId.isValid(id)) {
    return { $or: [{ _id: new ObjectId(id) }, { noteID: id }] };
  }
  return { noteID: id };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function headingExists(collection, heading, ignoredNoteID = null) {
  const query = {
    heading: { $regex: `^${escapeRegExp(heading)}$`, $options: 'i' },
  };
  if (ignoredNoteID) {
    query.noteID = { $ne: ignoredNoteID };
  }
  return Boolean(await collection.findOne(query, { projection: { _id: 1 } }));
}

// GET all notes
app.get('/api/notes', async (req, res) => {
  try {
    const collection = await getCollection();
    const notes = await collection
      .find({})
      .sort({ updated: -1 })
      .limit(200)
      .toArray();
    res.json({ notes: notes.map(cleanNote) });
  } catch (error) {
    console.error('GET /api/notes error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// POST create new note
app.post('/api/notes', async (req, res) => {
  try {
    const collection = await getCollection();
    const rawHeading = String(req.body?.heading ?? req.body?.title ?? '');
    const heading = rawHeading.trim();
    const notes = String(req.body?.notes ?? req.body?.body ?? '').trim();

    if (!heading || !notes) {
      return res.status(400).json({ error: 'Heading and note content are required.' });
    }

    if (/^\s/.test(rawHeading)) {
      return res.status(400).json({ error: 'Heading cannot start with a space.' });
    }

    if (await headingExists(collection, heading)) {
      return res.status(409).json({ error: 'A note with this heading already exists.' });
    }

    if (notes.length > 50000) {
      return res.status(400).json({ error: 'Note content is too long.' });
    }

    const now = new Date().toISOString();
    const noteObjectId = new ObjectId();
    const note = {
      _id: noteObjectId,
      noteID: noteObjectId.toString(),
      heading,
      notes,
      created: now,
      updated: now,
    };

    await collection.insertOne(note);
    res.status(201).json({ note: cleanNote(note) });
  } catch (error) {
    console.error('POST /api/notes error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// PUT update note
app.put('/api/notes', async (req, res) => {
  try {
    const collection = await getCollection();
    const { id } = req.query;
    const filter = noteFilter(id);
    const rawHeading = String(req.body?.heading ?? req.body?.title ?? '');
    const heading = rawHeading.trim();
    const notes = String(req.body?.notes ?? req.body?.body ?? '').trim();

    if (!filter) return res.status(400).json({ error: 'Valid note id is required.' });
    if (!heading || !notes) {
      return res.status(400).json({ error: 'Heading and note content are required.' });
    }

    if (/^\s/.test(rawHeading)) {
      return res.status(400).json({ error: 'Heading cannot start with a space.' });
    }

    if (await headingExists(collection, heading, id)) {
      return res.status(409).json({ error: 'A note with this heading already exists.' });
    }

    if (notes.length > 50000) {
      return res.status(400).json({ error: 'Note content is too long.' });
    }

    const now = new Date().toISOString();
    const result = await collection.findOneAndUpdate(
      filter,
      { $set: { heading, notes, updated: now } },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ error: 'Note not found.' });
    res.json({ note: cleanNote(result) });
  } catch (error) {
    console.error('PUT /api/notes error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// DELETE note
app.delete('/api/notes', async (req, res) => {
  try {
    const collection = await getCollection();
    const { id } = req.query;
    const filter = noteFilter(id);

    if (!filter) return res.status(400).json({ error: 'Valid note id is required.' });

    await collection.deleteOne(filter);
    res.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/notes error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 API server running at http://localhost:${PORT}`);
});
