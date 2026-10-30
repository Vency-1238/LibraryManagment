import { useState, useEffect, useCallback, useRef } from "react";
import { db } from "./lib/database.js";

/* ══════════════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════════════ */
function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}
function isOverdue(dueDate, status) {
  return status === "BORROWED" && new Date(dueDate) < new Date();
}
function normalizeUid(raw) {
  const hex = String(raw ?? "").toUpperCase().replace(/[^0-9A-F]/g, "");
  return /^[0-9A-F]{8}$/.test(hex) ? hex : null;
}

/* ══════════════════════════════════════════════════════════
   SVG ICONS
══════════════════════════════════════════════════════════ */
const Ic = {
  book:    () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  users:   () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  list:    () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  dash:    () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  plus:    () => <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.3" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  trash:   () => <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  ret:     () => <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.34"/></svg>,
  search:  () => <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  check:   () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
  warn:    () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  x:       () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  sun:     () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  moon:    () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  wifi:    () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>,
  wifiOff: () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>,
  chip:    () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="9" y="9" width="6" height="6"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/><rect x="5" y="5" width="14" height="14" rx="2"/></svg>,
};

/* ══════════════════════════════════════════════════════════
   TOAST SYSTEM
══════════════════════════════════════════════════════════ */
let _tid = 0;

function useToast() {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((message, type = "success") => {
    const id = ++_tid;
    setToasts((p) => [...p, { id, message, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4500);
  }, []);
  const dismiss = useCallback((id) => setToasts((p) => p.filter((t) => t.id !== id)), []);
  return { toasts, toast, dismiss };
}

function ToastContainer({ toasts, dismiss }) {
  return (
    <div className="toast-wrap" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`} role="alert">
          <span className="toast-ico">{t.type === "success" ? <Ic.check /> : <Ic.warn />}</span>
          <span className="toast-msg">{t.message}</span>
          <button className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss"><Ic.x /></button>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MODAL
══════════════════════════════════════════════════════════ */
function Modal({ open, onClose, title, children, footer }) {
  const backdropRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const esc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", esc); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-bg" ref={backdropRef} onClick={(e) => e.target === backdropRef.current && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mtitle">
        <div className="modal-hd">
          <h3 id="mtitle">{title}</h3>
          <button className="modal-x" onClick={onClose} aria-label="Close"><Ic.x /></button>
        </div>
        <div className="modal-bd">{children}</div>
        {footer && <div className="modal-ft">{footer}</div>}
      </div>
    </div>
  );
}

function ConfirmDialog({ open, title, message, onConfirm, onCancel, loading }) {
  return (
    <Modal open={open} onClose={onCancel} title={title}
      footer={
        <div className="cf-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={loading}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? "Deleting…" : "Delete"}
          </button>
        </div>
      }>
      <p className="cf-msg">{message}</p>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════
   UID INPUT
══════════════════════════════════════════════════════════ */
function UIDInput({ value, onChange }) {
  const refs = [useRef(), useRef(), useRef(), useRef()];
  function handle(i, raw) {
    const v = raw.replace(/[^0-9a-f]/gi, "").toUpperCase().slice(0, 2);
    const next = [...value]; next[i] = v; onChange(next);
    if (v.length === 2 && i < 3) refs[i + 1].current?.focus();
  }
  function onKey(i, e) {
    if (e.key === "Backspace" && !value[i] && i > 0) refs[i - 1].current?.focus();
  }
  return (
    <div className="uid-grp">
      {value.map((part, i) => (
        <span key={i} className="uid-item">
          {i > 0 && <span className="uid-sep">:</span>}
          <input
            ref={refs[i]}
            className="uid-box"
            maxLength={2}
            placeholder="A0"
            value={part}
            onChange={(e) => handle(i, e.target.value)}
            onKeyDown={(e) => onKey(i, e)}
            aria-label={`RFID byte ${i + 1}`}
          />
        </span>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   SHARED SMALL COMPONENTS
══════════════════════════════════════════════════════════ */
function Badge({ status, overdue }) {
  if (overdue) return <span className="badge badge-overdue">OVERDUE</span>;
  const cls = status === "AVAILABLE" || status === "RETURNED" ? "badge-ok" : "badge-warn";
  return <span className={`badge ${cls}`}>{status}</span>;
}

function EmptyState({ icon, msg, action }) {
  return (
    <div className="empty">
      <div className="empty-ico">{icon}</div>
      <p>{msg}</p>
      {action && (
        <button className="btn btn-primary" onClick={action.fn}>
          <Ic.plus />{action.label}
        </button>
      )}
    </div>
  );
}

function Searchbar({ value, onChange, placeholder }) {
  return (
    <div className="srch-wrap">
      <span className="srch-ico"><Ic.search /></span>
      <input className="srch" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function StatCard({ label, value, sub, icon, color }) {
  return (
    <div className={`stat-card sc-${color}`}>
      <div className="sc-icon">{icon}</div>
      <div className="sc-body">
        <p className="sc-lbl">{label}</p>
        <strong className="sc-val">{value}</strong>
        {sub && <p className="sc-sub">{sub}</p>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════════ */
function Dashboard({ students, books, borrowings }) {
  const borrowed  = books.filter((b) => b.status === "BORROWED").length;
  const available = books.filter((b) => b.status === "AVAILABLE").length;
  const overdue   = borrowings.filter((r) => isOverdue(r.dueDate, r.status)).length;
  const sMap      = new Map(students.map((s) => [s.studentId, s.name]));
  const bMap      = new Map(books.map((b) => [b.bookId, b.title]));
  const recent    = borrowings.slice(0, 8);

  return (
    <div className="page">
      <div className="pg-hero">
        <div className="pg-hero-text">
          <p className="eyebrow"><Ic.chip /> SMART CAMPUS • RFID</p>
          <h2>Library Dashboard</h2>
          <p className="hero-sub">Real-time overview of books, students and borrowing activity.</p>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="Registered Students" value={students.length}  icon={<Ic.users />} color="blue" />
        <StatCard label="Total Books"          value={books.length}    icon={<Ic.book />}  color="violet" />
        <StatCard label="Currently Borrowed"   value={borrowed}        icon={<Ic.list />}  color="amber"
          sub={overdue > 0 ? `⚠ ${overdue} overdue` : undefined} />
        <StatCard label="Available"            value={available}       icon={<Ic.dash />}  color="green" />
      </div>

      <div className="panel">
        <div className="pnl-hd">
          <h3>Recent Activity</h3>
          <span className="pnl-cnt">{borrowings.length} total record{borrowings.length === 1 ? "" : "s"}</span>
        </div>
        {recent.length === 0 ? (
          <EmptyState icon="📋" msg="No borrowing activity yet." />
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th><th>Book</th>
                  <th>Issue</th><th>Due</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => {
                  const over = isOverdue(r.dueDate, r.status);
                  return (
                    <tr key={r.$id} className={over ? "tr-over" : ""}>
                      <td data-label="Student">
                        <div className="cell-main">{sMap.get(r.studentId) || r.studentId}</div>
                        <div className="cell-sub">{r.studentId}</div>
                      </td>
                      <td data-label="Book">{bMap.get(r.bookId) || r.bookId}</td>
                      <td data-label="Issued">{formatDate(r.issueDate)}</td>
                      <td data-label="Due" className={over ? "td-danger" : ""}>{formatDate(r.dueDate)}</td>
                      <td data-label="Status"><Badge status={r.status} overdue={over} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   STUDENTS PAGE
══════════════════════════════════════════════════════════ */
function StudentsPage({ students, onRefresh, toast }) {
  const [q, setQ]       = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm]  = useState({ id: "", name: "", uid: ["", "", "", ""] });
  const [saving, setSav] = useState(false);
  const [delTarget, setDel] = useState(null);
  const [deleting, setDeling] = useState(false);

  const list = students.filter((s) =>
    [s.name, s.studentId, s.rfidUID].some((v) => v.toLowerCase().includes(q.toLowerCase()))
  );

  function resetForm() { setForm({ id: "", name: "", uid: ["", "", "", ""] }); }

  async function handleAdd(e) {
    e.preventDefault();
    const uid = normalizeUid(form.uid.join(""));
    if (!uid) { toast("RFID UID must be 8 hex characters", "error"); return; }
    setSav(true);
    try {
      if (await db.findStudentByStudentId(form.id.trim())) { toast("Student ID already exists", "error"); return; }
      if (await db.findStudentByUid(uid)) { toast("RFID UID already registered", "error"); return; }
      await db.addStudent({ studentId: form.id.trim(), name: form.name.trim(), rfidUID: uid });
      toast(`Student "${form.name}" added!`);
      resetForm(); setModal(false); onRefresh();
    } catch (err) { toast(err.message || "Failed to add student", "error"); }
    finally { setSav(false); }
  }

  async function handleDelete() {
    if (!delTarget) return;
    setDeling(true);
    try {
      const active = await db.getActiveBorrowingsForStudent(delTarget.studentId);
      if (active.length) { toast("Cannot delete — student has active borrowings", "error"); setDel(null); return; }
      await db.deleteStudent(delTarget.$id);
      toast(`"${delTarget.name}" deleted`);
      setDel(null); onRefresh();
    } catch (err) { toast(err.message || "Delete failed", "error"); }
    finally { setDeling(false); }
  }

  return (
    <div className="page">
      <div className="pg-head">
        <div>
          <h2>Students</h2>
          <p>Manage student RFID card registrations.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal(true)}><Ic.plus /> Add Student</button>
      </div>

      <div className="panel">
        <div className="pnl-bar">
          <Searchbar value={q} onChange={setQ} placeholder="Search by name, ID or UID…" />
          <span className="cnt-chip">{list.length} student{list.length === 1 ? "" : "s"}</span>
        </div>

        {list.length === 0 ? (
          q ? <EmptyState icon="🔍" msg={`No students matching "${q}"`} /> :
              <EmptyState icon="👥" msg="No students registered." action={{ label: "Add Student", fn: () => setModal(true) }} />
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Student ID</th><th>Name</th><th>RFID UID</th><th>Actions</th></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.$id}>
                    <td data-label="Student ID"><code className="id-chip">{s.studentId}</code></td>
                    <td data-label="Name">
                      <div className="av-cell">
                        <div className="av">{s.name[0].toUpperCase()}</div>
                        {s.name}
                      </div>
                    </td>
                    <td data-label="RFID UID"><code className="uid-chip">{s.rfidUID.match(/.{2}/g)?.join(":")}</code></td>
                    <td data-label="Actions">
                      <button className="btn btn-del btn-sm" onClick={() => setDel(s)}>
                        <Ic.trash /> Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modal} onClose={() => { setModal(false); resetForm(); }} title="Add New Student"
        footer={
          <div className="mf-acts">
            <button className="btn btn-ghost" onClick={() => setModal(false)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" form="sf" type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add Student"}
            </button>
          </div>
        }>
        <form id="sf" onSubmit={handleAdd} className="f-grid">
          <div className="f-fld">
            <label>Student ID</label>
            <input required placeholder="e.g. 23BCP230" value={form.id}
              onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))} />
          </div>
          <div className="f-fld">
            <label>Full Name</label>
            <input required placeholder="e.g. Vency Thummar" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="f-fld">
            <label>RFID UID <span className="f-hint">8 hex characters</span></label>
            <UIDInput value={form.uid} onChange={(uid) => setForm((f) => ({ ...f, uid }))} />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!delTarget}
        title="Delete Student"
        message={`Delete "${delTarget?.name}" permanently? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDel(null)}
        loading={deleting}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   BOOKS PAGE
══════════════════════════════════════════════════════════ */
function BooksPage({ books, onRefresh, toast }) {
  const [q, setQ]       = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm]  = useState({ id: "", title: "", uid: ["", "", "", ""], days: "14" });
  const [saving, setSav] = useState(false);
  const [delTarget, setDel] = useState(null);
  const [deleting, setDeling] = useState(false);

  const list = books.filter((b) =>
    [b.title, b.bookId, b.rfidUID].some((v) => v.toLowerCase().includes(q.toLowerCase()))
  );

  function resetForm() { setForm({ id: "", title: "", uid: ["", "", "", ""], days: "14" }); }

  async function handleAdd(e) {
    e.preventDefault();
    const uid = normalizeUid(form.uid.join(""));
    if (!uid) { toast("RFID UID must be 8 hex characters", "error"); return; }
    const days = parseInt(form.days);
    if (!days || days <= 0) { toast("Loan period must be a positive number", "error"); return; }
    setSav(true);
    try {
      if (await db.findBookByBookId(form.id.trim())) { toast("Book ID already exists", "error"); return; }
      if (await db.findBookByUid(uid)) { toast("RFID UID already registered to another book", "error"); return; }
      await db.addBook({ bookId: form.id.trim(), title: form.title.trim(), rfidUID: uid, loanPeriod: days, status: "AVAILABLE" });
      toast(`"${form.title}" added to inventory!`);
      resetForm(); setModal(false); onRefresh();
    } catch (err) { toast(err.message || "Failed to add book", "error"); }
    finally { setSav(false); }
  }

  async function handleDelete() {
    if (!delTarget) return;
    setDeling(true);
    try {
      const recs = await db.getBorrowingsForBook(delTarget.bookId);
      if (recs.length) { toast("Cannot delete — book has borrowing history", "error"); setDel(null); return; }
      await db.deleteBook(delTarget.$id);
      toast(`"${delTarget.title}" deleted from inventory`);
      setDel(null); onRefresh();
    } catch (err) { toast(err.message || "Delete failed", "error"); }
    finally { setDeling(false); }
  }

  return (
    <div className="page">
      <div className="pg-head">
        <div>
          <h2>Books</h2>
          <p>Manage the library book inventory.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal(true)}><Ic.plus /> Add Book</button>
      </div>

      <div className="panel">
        <div className="pnl-bar">
          <Searchbar value={q} onChange={setQ} placeholder="Search by title, ID or UID…" />
          <span className="cnt-chip">{list.length} book{list.length === 1 ? "" : "s"}</span>
        </div>

        {list.length === 0 ? (
          q ? <EmptyState icon="🔍" msg={`No books matching "${q}"`} /> :
              <EmptyState icon="📚" msg="No books in inventory." action={{ label: "Add Book", fn: () => setModal(true) }} />
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Book ID</th><th>Title</th><th>RFID UID</th><th>Loan</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.$id}>
                    <td data-label="Book ID"><code className="id-chip">{b.bookId}</code></td>
                    <td data-label="Title">
                      <div className="bk-cell">
                        <span className="bk-ico">📖</span>{b.title}
                      </div>
                    </td>
                    <td data-label="RFID UID"><code className="uid-chip">{b.rfidUID.match(/.{2}/g)?.join(":")}</code></td>
                    <td data-label="Loan"><span className="loan-chip">{b.loanPeriod}d</span></td>
                    <td data-label="Status"><Badge status={b.status} /></td>
                    <td data-label="Actions">
                      <button
                        className="btn btn-del btn-sm"
                        disabled={b.status === "BORROWED"}
                        title={b.status === "BORROWED" ? "Return the book before deleting" : ""}
                        onClick={() => setDel(b)}
                      >
                        <Ic.trash /> Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modal} onClose={() => { setModal(false); resetForm(); }} title="Add New Book"
        footer={
          <div className="mf-acts">
            <button className="btn btn-ghost" onClick={() => setModal(false)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" form="bf" type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add Book"}
            </button>
          </div>
        }>
        <form id="bf" onSubmit={handleAdd} className="f-grid">
          <div className="f-fld">
            <label>Book ID</label>
            <input required placeholder="e.g. BK-001" value={form.id}
              onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))} />
          </div>
          <div className="f-fld">
            <label>Title</label>
            <input required placeholder="e.g. Internet of Things" value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="f-fld">
            <label>RFID UID <span className="f-hint">8 hex characters</span></label>
            <UIDInput value={form.uid} onChange={(uid) => setForm((f) => ({ ...f, uid }))} />
          </div>
          <div className="f-fld">
            <label>Loan Period <span className="f-hint">days</span></label>
            <input required type="number" min="1" max="365" placeholder="14" value={form.days}
              onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!delTarget}
        title="Delete Book"
        message={`Delete "${delTarget?.title}" from inventory? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDel(null)}
        loading={deleting}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   BORROWINGS PAGE
══════════════════════════════════════════════════════════ */
const FILTERS = [["ALL","All"], ["BORROWED","Active"], ["RETURNED","Returned"], ["OVERDUE","Overdue"]];

function BorrowingsPage({ borrowings, students, books, onRefresh, toast }) {
  const [filt, setFilt]  = useState("ALL");
  const [q, setQ]        = useState("");
  const [delTarget, setDel]   = useState(null);
  const [deleting, setDeling] = useState(false);
  const [returning, setRet]   = useState(null);

  const sMap = new Map(students.map((s) => [s.studentId, s.name]));
  const bMap = new Map(books.map((b) => [b.bookId, b]));

  const counts = {
    ALL:      borrowings.length,
    BORROWED: borrowings.filter((r) => r.status === "BORROWED" && !isOverdue(r.dueDate, r.status)).length,
    RETURNED: borrowings.filter((r) => r.status === "RETURNED").length,
    OVERDUE:  borrowings.filter((r) => isOverdue(r.dueDate, r.status)).length,
  };

  const list = borrowings
    .filter((r) => {
      if (filt === "BORROWED") return r.status === "BORROWED" && !isOverdue(r.dueDate, r.status);
      if (filt === "RETURNED") return r.status === "RETURNED";
      if (filt === "OVERDUE")  return isOverdue(r.dueDate, r.status);
      return true;
    })
    .filter((r) => {
      if (!q) return true;
      const s = q.toLowerCase();
      return (sMap.get(r.studentId) || "").toLowerCase().includes(s)
          || r.studentId.toLowerCase().includes(s)
          || (bMap.get(r.bookId)?.title || "").toLowerCase().includes(s);
    });

  async function handleReturn(r) {
    setRet(r.$id);
    try {
      const bookDoc = bMap.get(r.bookId);
      await db.updateBorrowing(r.$id, { returnDate: new Date().toISOString(), status: "RETURNED" });
      if (bookDoc) await db.updateBook(bookDoc.$id, { status: "AVAILABLE" });
      toast("Book returned successfully!");
      onRefresh();
    } catch (err) { toast(err.message || "Return failed", "error"); }
    finally { setRet(null); }
  }

  async function handleDelete() {
    if (!delTarget) return;
    setDeling(true);
    try {
      if (delTarget.status === "BORROWED") {
        const bookDoc = bMap.get(delTarget.bookId);
        if (bookDoc) await db.updateBook(bookDoc.$id, { status: "AVAILABLE" });
      }
      await db.deleteBorrowing(delTarget.$id);
      toast("Borrowing record deleted");
      setDel(null); onRefresh();
    } catch (err) { toast(err.message || "Delete failed", "error"); }
    finally { setDeling(false); }
  }

  return (
    <div className="page">
      <div className="pg-head">
        <div>
          <h2>Borrowings</h2>
          <p>Issue dates, due dates, and return status.</p>
        </div>
      </div>

      <div className="panel">
        <div className="filt-tabs">
          {FILTERS.map(([key, label]) => (
            <button key={key}
              className={`ftab ${filt === key ? "ftab-on" : ""} ${key === "OVERDUE" && counts.OVERDUE > 0 ? "ftab-danger" : ""}`}
              onClick={() => setFilt(key)}>
              {label} <span className="ftab-n">{counts[key]}</span>
            </button>
          ))}
        </div>

        <div className="pnl-bar">
          <Searchbar value={q} onChange={setQ} placeholder="Search by student or book…" />
        </div>

        {list.length === 0 ? (
          <EmptyState icon="📋" msg={q ? `No records matching "${q}"` : "No records in this category."} />
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th><th>Book</th>
                  <th>Issue</th><th>Due</th><th>Return</th>
                  <th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const over = isOverdue(r.dueDate, r.status);
                  const bookDoc = bMap.get(r.bookId);
                  return (
                    <tr key={r.$id} className={over ? "tr-over" : ""}>
                      <td data-label="Student">
                        <div className="cell-main">{sMap.get(r.studentId) || r.studentId}</div>
                        <div className="cell-sub">{r.studentId}</div>
                      </td>
                      <td data-label="Book">{bookDoc?.title || r.bookId}</td>
                      <td data-label="Issued">{formatDate(r.issueDate)}</td>
                      <td data-label="Due" className={over ? "td-danger" : ""}>{formatDate(r.dueDate)}</td>
                      <td data-label="Returned">{r.returnDate ? formatDate(r.returnDate) : "—"}</td>
                      <td data-label="Status"><Badge status={r.status} overdue={over} /></td>
                      <td data-label="Actions" className="act-cell">
                        {r.status === "BORROWED" && (
                          <button className="btn btn-ret btn-sm" onClick={() => handleReturn(r)} disabled={returning === r.$id}>
                            <Ic.ret /> {returning === r.$id ? "…" : "Return"}
                          </button>
                        )}
                        <button className="btn btn-del btn-sm icon-only" onClick={() => setDel(r)} aria-label="Delete record">
                          <Ic.trash />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!delTarget}
        title="Delete Borrowing Record"
        message={`Delete this record for "${sMap.get(delTarget?.studentId) || delTarget?.studentId}"?${
          delTarget?.status === "BORROWED" ? " The book will be marked as available." : ""
        }`}
        onConfirm={handleDelete}
        onCancel={() => setDel(null)}
        loading={deleting}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   ROOT APP
══════════════════════════════════════════════════════════ */
const NAV = [
  { id: "dashboard",  label: "Dashboard",  Icon: Ic.dash },
  { id: "students",   label: "Students",   Icon: Ic.users },
  { id: "books",      label: "Books",      Icon: Ic.book },
  { id: "borrowings", label: "Borrowings", Icon: Ic.list },
];

export default function App() {
  const [students,   setStudents]   = useState([]);
  const [books,      setBooks]      = useState([]);
  const [borrowings, setBorrowings] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [online,     setOnline]     = useState(null);
  const [error,      setError]      = useState("");
  const [page,       setPage]       = useState("dashboard");
  const [theme,      setTheme]      = useState(() => localStorage.getItem("rfid-theme") || "light");
  const { toasts, toast, dismiss }  = useToast();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("rfid-theme", theme);
  }, [theme]);

  const load = useCallback(async () => {
    try {
      const [s, b, r] = await Promise.all([db.getStudents(), db.getBooks(), db.getBorrowings()]);
      setStudents(s); setBooks(b); setBorrowings(r);
      setOnline(true);
      setError("");
    } catch (err) {
      console.error("[Appwrite]", err);
      setOnline(false);
      setError(err?.message || "Unknown error");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  return (
    <>
      <div className="layout">
        {/* ── HEADER ── */}
        <header className="hdr">
          <div className="hdr-brand">
            <span className="brand-ico">📚</span>
            <div>
              <span className="brand-name">RFID Library</span>
              <span className="brand-tag">Smart Campus</span>
            </div>
          </div>

          <nav className="hdr-nav" aria-label="Main navigation">
            {NAV.map(({ id, label, Icon }) => (
              <button key={id} className={`nav-btn ${page === id ? "nav-on" : ""}`} onClick={() => setPage(id)}>
                <Icon /><span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="hdr-r">
            <span className={`conn-badge ${online === null ? "conn-wait" : online ? "conn-ok" : "conn-err"}`}>
              <span className="conn-dot" />
              {online === null ? "Connecting…" : online ? "Appwrite" : "Offline"}
            </span>
            <button className="theme-btn" onClick={() => setTheme((t) => t === "light" ? "dark" : "light")} aria-label="Toggle theme">
              {theme === "light" ? <Ic.moon /> : <Ic.sun />}
            </button>
          </div>
        </header>

        {/* ── MAIN ── */}
        <main className="main">
          {loading ? (
            <div className="loading">
              <div className="spin" />
              <p>Loading from Appwrite…</p>
            </div>
          ) : !online ? (
            <div className="offline-screen">
              <div className="offline-ico"><Ic.wifiOff /></div>
              <h3>Cannot reach Appwrite</h3>
              <p>Check your internet connection and Appwrite collection permissions.</p>
              {error && <pre className="offline-err">{error}</pre>}
              <button className="btn btn-primary" onClick={load}>Retry</button>
            </div>
          ) : (
            <>
              {page === "dashboard"  && <Dashboard   students={students} books={books} borrowings={borrowings} />}
              {page === "students"   && <StudentsPage students={students} onRefresh={load} toast={toast} />}
              {page === "books"      && <BooksPage    books={books}       onRefresh={load} toast={toast} />}
              {page === "borrowings" && <BorrowingsPage borrowings={borrowings} students={students} books={books} onRefresh={load} toast={toast} />}
            </>
          )}
        </main>

        {/* ── FOOTER ── */}
        <footer className="ftr">
          <span>RFID Library Management</span>
          <span>ESP32 + RC522 + Appwrite</span>
        </footer>
      </div>

      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </>
  );
}
