import { MongoClient, ObjectId } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'notepad_app';
const collectionName = process.env.MONGODB_COLLECTION || 'demoNotes';

let cachedClient;
let cachedClientPromise;

async function getCollection() {
  if (!uri) {
    throw new Error('Missing MONGODB_URI environment variable');
  }

  if (!cachedClient) {
    cachedClient = new MongoClient(uri);
    cachedClientPromise = cachedClient.connect();
  }

  try {
    await cachedClientPromise;
    await cachedClient.db('admin').command({ ping: 1 });
  } catch {
    if (cachedClient) {
      await cachedClient.close().catch(() => {});
    }
    cachedClient = new MongoClient(uri);
    cachedClientPromise = cachedClient.connect();
    await cachedClientPromise;
  }

  return cachedClient.db(dbName).collection(collectionName);
}

function sendJson(response, status, payload) {
  response.status(status).json(payload);
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

export default async function handler(request, response) {
  try {
    const collection = await getCollection();
    const { id } = request.query;

    if (request.method === 'GET') {
      const notes = await collection
        .find({})
        .sort({ updated: -1 })
        .limit(200)
        .toArray();
      return sendJson(response, 200, { notes: notes.map(cleanNote) });
    }

    if (request.method === 'POST') {
      const rawHeading = String(request.body?.heading ?? request.body?.title ?? '');
      const heading = rawHeading.trim();
      const notes = String(request.body?.notes ?? request.body?.body ?? '').trim();

      if (!heading || !notes) {
        return sendJson(response, 400, { error: 'Heading and note content are required.' });
      }

      if (/^\s/.test(rawHeading)) {
        return sendJson(response, 400, { error: 'Heading cannot start with a space.' });
      }

      if (await headingExists(collection, heading)) {
        return sendJson(response, 409, { error: 'A note with this heading already exists.' });
      }

      if (notes.length > 50000) {
        return sendJson(response, 400, { error: 'Note content is too long.' });
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

      return sendJson(response, 201, {
        note: cleanNote(note),
      });
    }

    if (request.method === 'PUT') {
      const filter = noteFilter(id);
      const rawHeading = String(request.body?.heading ?? request.body?.title ?? '');
      const heading = rawHeading.trim();
      const notes = String(request.body?.notes ?? request.body?.body ?? '').trim();

      if (!filter) return sendJson(response, 400, { error: 'Valid note id is required.' });
      if (!heading || !notes) {
        return sendJson(response, 400, { error: 'Heading and note content are required.' });
      }

      if (/^\s/.test(rawHeading)) {
        return sendJson(response, 400, { error: 'Heading cannot start with a space.' });
      }

      if (await headingExists(collection, heading, id)) {
        return sendJson(response, 409, { error: 'A note with this heading already exists.' });
      }

      if (notes.length > 50000) {
        return sendJson(response, 400, { error: 'Note content is too long.' });
      }

      const now = new Date().toISOString();
      const result = await collection.findOneAndUpdate(
        filter,
        { $set: { heading, notes, updated: now } },
        { returnDocument: 'after' }
      );

      if (!result) return sendJson(response, 404, { error: 'Note not found.' });
      return sendJson(response, 200, { note: cleanNote(result) });
    }

    if (request.method === 'DELETE') {
      const filter = noteFilter(id);
      if (!filter) return sendJson(response, 400, { error: 'Valid note id is required.' });

      await collection.deleteOne(filter);
      return sendJson(response, 200, { ok: true });
    }

    response.setHeader('Allow', 'GET,POST,PUT,DELETE');
    return sendJson(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    return sendJson(response, 500, { error: error.message || 'Server error.' });
  }
}
