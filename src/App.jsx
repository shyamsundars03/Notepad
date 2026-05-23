import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  FilePenLine,
  Loader2,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';

const DRAFT_STORAGE_KEY = 'dark-notepad-draft'; // Only for unsaved drafts
const EMPTY_NOTE = { heading: '', notes: '' };
const MAX_NOTE_LENGTH = 50000;

// Load unsaved draft from localStorage
function readDraftFromStorage() {
  try {
    const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
    return saved ? JSON.parse(saved) : EMPTY_NOTE;
  } catch {
    return EMPTY_NOTE;
  }
}

// Save only the current draft to localStorage
function saveDraftToStorage(draft) {
  if (!draft.heading && !draft.notes) {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } else {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }
}

// Clear the draft from localStorage after successful save
function clearDraftFromStorage() {
  localStorage.removeItem(DRAFT_STORAGE_KEY);
}

function compactWords(text, limit = 100) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return text.trim();
  return `${words.slice(0, limit).join(' ')}...`;
}

function createLocalId() {
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeNote(note) {
  const now = new Date().toISOString();

  return {
    noteID: note.noteID || note._id || createLocalId(),
    heading: note.heading || note.title || '',
    notes: note.notes || note.body || '',
    created: note.created || note.createdAt || now,
    updated: note.updated || note.updatedAt || now,
  };
}

function normalizeHeading(heading) {
  return heading.trim().toLowerCase();
}

export default function App() {
  const [notes, setNotes] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeNote, setActiveNote] = useState(null);
  const [draft, setDraft] = useState(() => readDraftFromStorage());
  const [searchTerm, setSearchTerm] = useState('');
  const [syncState, setSyncState] = useState('Loading notes...');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Save draft to localStorage whenever it changes (while editing)
  useEffect(() => {
    if (modalOpen) {
      saveDraftToStorage(draft);
    }
  }, [draft, modalOpen]);

  // Fetch notes from MongoDB on app load
  useEffect(() => {
    let ignored = false;

    async function loadNotes() {
      try {
        const response = await fetch('/api/notes');
        if (!response.ok) throw new Error('MongoDB API unavailable');
        const data = await response.json();
        if (!ignored) {
          setNotes(Array.isArray(data.notes) ? data.notes.map(normalizeNote) : []);
          setSyncState('Synced with MongoDB');
        }
      } catch (error) {
        if (!ignored) {
          setSyncState('⚠️ Offline - using cached data');
          console.error('Failed to load notes from MongoDB:', error);
        }
      }
    }

    loadNotes();
    return () => {
      ignored = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;

    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filteredNotes = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return notes;

    return notes.filter((note) => note.heading.toLowerCase().includes(query));
  }, [notes, searchTerm]);

  function showToast(message) {
    setToast({ id: Date.now(), message });
  }

  function validateDraft() {
    if (!draft.heading) {
      showToast('Heading cannot be empty.');
      return null;
    }

    if (/^\s/.test(draft.heading)) {
      showToast('Heading cannot start with a space.');
      return null;
    }

    const heading = draft.heading.trim();
    const noteText = draft.notes.trim();

    if (!noteText) {
      showToast('Note content cannot be empty.');
      return null;
    }

    const duplicate = notes.some((note) => {
      const sameHeading = normalizeHeading(note.heading) === normalizeHeading(heading);
      const sameNote = activeNote && note.noteID === activeNote.noteID;
      return sameHeading && !sameNote;
    });

    if (duplicate) {
      showToast('A note with this heading already exists.');
      return null;
    }

    return { heading, notes: noteText };
  }

  function openNewNote() {
    setActiveNote(null);
    setDraft(readDraftFromStorage()); // Load any unsaved draft
    setModalOpen(true);
  }

  function openExistingNote(note) {
    setActiveNote(note);
    setDraft({ heading: note.heading, notes: note.notes });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setActiveNote(null);
    setDraft(EMPTY_NOTE);
    clearDraftFromStorage(); // Clear saved draft when closing modal
  }

  async function saveNote(event) {
    event.preventDefault();
    const validDraft = validateDraft();

    if (!validDraft) return;

    setSaving(true);
    const now = new Date().toISOString();
    const { heading, notes: noteText } = validDraft;
    const optimisticNote = {
      noteID: activeNote?.noteID || createLocalId(),
      heading,
      notes: noteText,
      created: activeNote?.created || now,
      updated: now,
    };

    setNotes((current) => {
      if (activeNote) {
        return current.map((note) =>
          note.noteID === activeNote.noteID ? optimisticNote : note
        );
      }
      return [optimisticNote, ...current];
    });

    try {
      const endpoint = activeNote
        ? `/api/notes?id=${encodeURIComponent(activeNote.noteID)}`
        : '/api/notes';
      const response = await fetch(endpoint, {
        method: activeNote ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ heading, notes: noteText }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        console.error('API error response:', { status: response.status, payload });
        throw new Error(payload?.error || `API error: ${response.status}`);
      }
      const data = await response.json();
      if (data.note) {
        const syncedNote = normalizeNote(data.note);
        setNotes((current) =>
          current.map((note) =>
            note.noteID === optimisticNote.noteID ? syncedNote : note
          )
        );
      }
      setSyncState('✅ Synced with MongoDB');
      showToast('Note saved to MongoDB');
      clearDraftFromStorage(); // Clear draft after successful save
    } catch (error) {
      console.error('Error saving note:', error);
      setSyncState('❌ Failed to sync');
      showToast(error.message || 'Failed to save note');
    } finally {
      setSaving(false);
      closeModal();
    }
  }

  async function deleteNote() {
    if (!activeNote) return;

    const noteId = activeNote.noteID;
    setNotes((current) => current.filter((note) => note.noteID !== noteId));
    closeModal();

    if (!String(noteId).startsWith('local-')) {
      try {
        const response = await fetch(`/api/notes?id=${encodeURIComponent(noteId)}`, {
          method: 'DELETE',
        });
        if (!response.ok) throw new Error('Unable to delete note');
        setSyncState('✅ Deleted from MongoDB');
        showToast('Note deleted');
      } catch (error) {
        setSyncState('❌ Failed to delete');
        showToast(error.message || 'Failed to delete note');
      }
    }
  }

  return (
    <main className="app-shell">
      <div className="toast-region" aria-live="assertive">
        {toast && (
          <div className="toast-message" key={toast.id}>
            <AlertCircle size={18} aria-hidden="true" />
            <span>{toast.message}</span>
          </div>
        )}
      </div>

      <section className="top-bar" aria-label="Notebook controls">
        <div>
          <p className="eyebrow">Dark Notepad</p>
          <h1>Notes</h1>
        </div>

        <div className="toolbar">
          <label className="search-box">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search notes"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>
          <button className="primary-button" type="button" onClick={openNewNote}>
            <Plus size={19} aria-hidden="true" />
            <span>Add Note</span>
          </button>
        </div>
      </section>

      <section className="notes-panel" aria-live="polite">
        <div className="panel-header">
          <span>{notes.length} {notes.length === 1 ? 'note' : 'notes'}</span>
          <span>{syncState}</span>
        </div>

        {filteredNotes.length === 0 ? (
          <div className="empty-state">
            <FilePenLine size={42} aria-hidden="true" />
            <p>No notes available</p>
          </div>
        ) : (
          <div className="notes-grid">
            {filteredNotes.map((note) => (
              <button
                className="note-card"
                type="button"
                key={note.noteID}
                onClick={() => openExistingNote(note)}
              >
                <span className="note-title">{note.heading}</span>
                <span className="note-preview">{compactWords(note.notes)}</span>
                <span className="note-date">
                  {new Date(note.updated || note.created).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="note-modal" onSubmit={saveNote} noValidate>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{activeNote ? 'Edit note' : 'New note'}</p>
                <h2>{activeNote ? 'Update your note' : 'Write something down'}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close note modal"
                onClick={closeModal}
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              <label className="field-group">
                <span>Heading</span>
                <input
                  autoFocus
                  type="text"
                  maxLength={120}
                  placeholder="Name this note"
                  value={draft.heading}
                  onChange={(event) => {
                    const nextHeading = event.target.value;
                    if (/^\s/.test(nextHeading)) {
                      showToast('Heading cannot start with a space.');
                    }
                    setDraft((current) => ({
                      ...current,
                      heading: nextHeading.replace(/^\s+/, ''),
                    }));
                  }}
                  required
                />
              </label>

              <label className="field-group content-field">
                <span>Note</span>
                <textarea
                  maxLength={MAX_NOTE_LENGTH}
                  placeholder="Paste or type your note here..."
                  value={draft.notes}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, notes: event.target.value }))
                  }
                  required
                />
              </label>
            </div>

            <div className="modal-footer">
              <span>{draft.notes.length.toLocaleString()} / {MAX_NOTE_LENGTH.toLocaleString()}</span>
              <div className="footer-actions">
                {activeNote && (
                  <button className="danger-button" type="button" onClick={deleteNote}>
                    <Trash2 size={18} aria-hidden="true" />
                    <span>Delete</span>
                  </button>
                )}
                <button className="ghost-button" type="button" onClick={closeModal}>
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
                  <span>{saving ? 'Saving' : 'Save'}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
