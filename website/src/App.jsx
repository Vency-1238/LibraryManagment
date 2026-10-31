import { useState, useEffect, useCallback, useRef } from "react";
import { db, MAX_ACTIVE_BOOKS } from "./lib/database.js";
import { client, DB_ID, S_COL, B_COL, BOR_COL, SCAN_COL } from "./lib/appwrite.js";
import { returnBook as returnBookViaApi } from "./lib/api.js";

/* ══════════════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════════════ */
function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}
function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
function isOverdue(dueDate, status) {
  return status === "BORROWED" && Boolean(dueDate) && new Date(dueDate) < new Date();
}
function normalizeUid(raw) {
  const hex = String(raw ?? "").toUpperCase().replace(/[^0-9A-F]/g, "");
  return /^[0-9A-F]{8}$/.test(hex) ? hex : null;
}
function uidGroups(uid) {
  const text = String(uid || "").toUpperCase().replace(/[^0-9A-F]/g, "").padEnd(8, "");
  return [text.slice(0, 2), text.slice(2, 4), text.slice(4, 6), text.slice(6, 8)];
}
function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
function lastDays(count) {
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    days.push({
      key: dayKey(date),
      label: date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    });
  }
  return days;
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
  scan:    () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>,
  chart:   () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/></svg>,
  locate:  () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  edit:    () => <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>,
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
  const value = String(status || "UNKNOWN").toUpperCase();
  const ok = ["AVAILABLE", "RETURNED", "ACTIVE", "SUCCESS"].includes(value);
  const danger = ["INACTIVE", "FAILED", "INVALID"].includes(value);
  const cls = ok ? "badge-ok" : danger ? "badge-danger" : "badge-warn";
  return <span className={`badge ${cls}`}>{value}</span>;
}

function ActionBadge({ action }) {
  const value = String(action || "INVALID").toUpperCase();
  const cls = value === "BORROW" ? "badge-blue" : value === "RETURN" ? "badge-ok" : "badge-danger";
  return <span className={`badge ${cls}`}>{value}</span>;
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
function Dashboard({ students, books, borrowings, scans }) {
  const activeLoans   = borrowings.filter((r) => r.status === "BORROWED");
  const activeBookIds = new Set(activeLoans.map((r) => r.bookId));
  const borrowed      = activeLoans.length;
  const available     = books.filter((b) => b.status === "AVAILABLE" && !activeBookIds.has(b.bookId)).length;
  const returned      = borrowings.filter((r) => r.status === "RETURNED").length;
  const overdue       = activeLoans.filter((r) => isOverdue(r.dueDate, r.status)).length;
  const sMap          = new Map(students.map((s) => [s.studentId, s.name]));
  const bMap          = new Map(books.map((b) => [b.bookId, b.title]));
  const recent        = borrowings.slice(0, 8);
  const scanCount     = scans.length;

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
        <StatCard label="Total Students"       value={students.length}  icon={<Ic.users />}  color="blue" />
        <StatCard label="Total Books"          value={books.length}     icon={<Ic.book />}   color="violet" />
        <StatCard label="Available Books"      value={available}        icon={<Ic.dash />}   color="green" />
        <StatCard label="Currently Borrowed"   value={borrowed}         icon={<Ic.list />}   color="amber"
          sub={overdue > 0 ? `⚠ ${overdue} overdue` : undefined} />
        <StatCard label="Returned Books"       value={returned}         icon={<Ic.ret />}    color="blue" />
        <StatCard label="Overdue Books"        value={overdue}          icon={<Ic.warn />}   color="red" />
        <StatCard label="Total RFID Scans"     value={scanCount}        icon={<Ic.scan />}   color="violet"
          sub={SCAN_COL ? "ScanLogs history" : "ScanLogs not configured"} />
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
function StudentsPage({ students, borrowings, onRefresh, toast }) {
  const [q, setQ]       = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm]  = useState({ id: "", name: "", uid: ["", "", "", ""], status: "ACTIVE" });
  const [editing, setEditing] = useState(null);
  const [saving, setSav] = useState(false);
  const [delTarget, setDel] = useState(null);
  const [deleting, setDeling] = useState(false);
  const [toggling, setToggling] = useState(null);

  const activeCounts = new Map();
  for (const record of borrowings) {
    if (record.status !== "BORROWED") continue;
    activeCounts.set(record.studentId, (activeCounts.get(record.studentId) || 0) + 1);
  }

  const list = students.filter((s) =>
    [s.name, s.studentId, s.rfidUID].some((v) => v.toLowerCase().includes(q.toLowerCase()))
  );

  function resetForm() {
    setForm({ id: "", name: "", uid: ["", "", "", ""], status: "ACTIVE" });
    setEditing(null);
  }

  function openAdd() {
    resetForm();
    setModal(true);
  }

  function openEdit(student) {
    setEditing(student.$id);
    setForm({
      id: student.studentId,
      name: student.name,
      uid: uidGroups(student.rfidUID),
      status: student.status || "ACTIVE",
    });
    setModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    const uid = normalizeUid(form.uid.join(""));
    if (!uid) { toast("RFID UID must be 8 hex characters", "error"); return; }
    setSav(true);
    try {
      const uidOwner = await db.findStudentByUid(uid);
      if (uidOwner && uidOwner.$id !== editing) {
        toast("RFID UID already registered", "error");
        return;
      }

      if (editing) {
        /* studentId is intentionally immutable: Borrow records reference it,
           so renaming it would detach the student's history. */
        await db.updateStudent(editing, {
          name: form.name.trim(),
          rfidUID: uid,
          status: form.status,
        });
        toast(`Student "${form.name}" updated`);
      } else {
        if (await db.findStudentByStudentId(form.id.trim())) {
          toast("Student ID already exists", "error");
          return;
        }
        await db.addStudent({
          studentId: form.id.trim(),
          name: form.name.trim(),
          rfidUID: uid,
          status: form.status,
        });
        toast(`Student "${form.name}" added!`);
      }
      resetForm(); setModal(false); onRefresh();
    } catch (err) { toast(err.message || "Failed to save student", "error"); }
    finally { setSav(false); }
  }

  async function handleToggleStatus(student) {
    const current = student.status || "ACTIVE";
    const next = current === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setToggling(student.$id);
    try {
      await db.updateStudent(student.$id, { status: next });
      toast(`${student.name} is now ${next}`);
      onRefresh();
    } catch (err) { toast(err.message || "Failed to update status", "error"); }
    finally { setToggling(null); }
  }

  async function handleDelete() {
    if (!delTarget) return;
    setDeling(true);
    try {
      const [active, history] = await Promise.all([
        db.getActiveBorrowingsForStudent(delTarget.studentId),
        db.getBorrowingsForStudent(delTarget.studentId),
      ]);
      if (active.length) { toast("Cannot delete — student has active borrowings", "error"); setDel(null); return; }
      if (history.length) { toast("Cannot delete — student has borrowing history", "error"); setDel(null); return; }
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
        <button className="btn btn-primary" onClick={openAdd}><Ic.plus /> Add Student</button>
      </div>

      <div className="panel">
        <div className="pnl-bar">
          <Searchbar value={q} onChange={setQ} placeholder="Search by name, ID or UID…" />
          <span className="cnt-chip">{list.length} student{list.length === 1 ? "" : "s"}</span>
        </div>

        {list.length === 0 ? (
          q ? <EmptyState icon="🔍" msg={`No students matching "${q}"`} /> :
              <EmptyState icon="👥" msg="No students registered." action={{ label: "Add Student", fn: openAdd }} />
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Student ID</th><th>Name</th><th>RFID UID</th><th>Status</th><th>Borrowing</th><th>Actions</th></tr></thead>
              <tbody>
                {list.map((s) => {
                  const active = activeCounts.get(s.studentId) || 0;
                  const remaining = Math.max(0, MAX_ACTIVE_BOOKS - active);
                  const atLimit = active >= MAX_ACTIVE_BOOKS;
                  return (
                    <tr key={s.$id}>
                      <td data-label="Student ID"><code className="id-chip">{s.studentId}</code></td>
                      <td data-label="Name">
                        <div className="av-cell">
                          <div className="av">{s.name[0].toUpperCase()}</div>
                          {s.name}
                        </div>
                      </td>
                      <td data-label="RFID UID"><code className="uid-chip">{s.rfidUID.match(/.{2}/g)?.join(":")}</code></td>
                      <td data-label="Status"><Badge status={s.status || "ACTIVE"} /></td>
                      <td data-label="Borrowing">
                        <div className="borrow-cell">
                          <span className="borrow-line">
                            <strong>{active} / {MAX_ACTIVE_BOOKS}</strong> books borrowed
                          </span>
                          <span className={`badge ${atLimit ? "badge-overdue" : active ? "badge-warn" : "badge-ok"}`}>
                            {atLimit
                              ? "LIMIT REACHED"
                              : active
                                ? `${remaining} SLOT${remaining === 1 ? "" : "S"} LEFT`
                                : "NO ACTIVE LOANS"}
                          </span>
                          <div className="borrow-meter" aria-hidden="true">
                            <span style={{ width: `${(active / MAX_ACTIVE_BOOKS) * 100}%` }} />
                          </div>
                        </div>
                      </td>
                      <td data-label="Actions" className="act-cell">
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(s)}>
                          <Ic.edit /> Edit
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={toggling === s.$id}
                          onClick={() => handleToggleStatus(s)}
                        >
                          {(s.status || "ACTIVE") === "ACTIVE" ? "Deactivate" : "Activate"}
                        </button>
                        <button className="btn btn-del btn-sm" onClick={() => setDel(s)}>
                          <Ic.trash /> Delete
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

      <Modal
        open={modal}
        onClose={() => { setModal(false); resetForm(); }}
        title={editing ? "Edit Student" : "Add New Student"}
        footer={
          <div className="mf-acts">
            <button className="btn btn-ghost" onClick={() => { setModal(false); resetForm(); }} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" form="sf" type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Add Student"}
            </button>
          </div>
        }>
        <form id="sf" onSubmit={handleSave} className="f-grid">
          <div className="f-fld">
            <label>
              Student ID
              {editing && <span className="f-hint">immutable to preserve history</span>}
            </label>
            <input required placeholder="e.g. 23BCP230" value={form.id} disabled={Boolean(editing)}
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
          <div className="f-fld">
            <label>Status</label>
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
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
const EMPTY_BOOK_FORM = {
  id: "", title: "", uid: ["", "", "", ""], days: "14",
  category: "", shelfLocation: "", rackNumber: "", isbn: "",
};

function BooksPage({ books, onRefresh, toast }) {
  const [q, setQ]       = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [availability, setAvailability] = useState("ALL");
  const [modal, setModal] = useState(false);
  const [form, setForm]  = useState(EMPTY_BOOK_FORM);
  const [editing, setEditing] = useState(null);
  const [saving, setSav] = useState(false);
  const [delTarget, setDel] = useState(null);
  const [deleting, setDeling] = useState(false);

  const categories = [...new Set(books.map((b) => b.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  const list = books
    .filter((b) => {
      if (!q) return true;
      const text = q.toLowerCase();
      return [b.title, b.bookId, b.rfidUID, b.category, b.shelfLocation, b.rackNumber, b.isbn]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(text));
    })
    .filter((b) => categoryFilter === "ALL" || (b.category || "") === categoryFilter)
    .filter((b) => availability === "ALL" || b.status === availability);

  function resetForm() { setForm(EMPTY_BOOK_FORM); setEditing(null); }

  function openAdd() {
    resetForm();
    setModal(true);
  }

  function openEdit(book) {
    setEditing(book.$id);
    setForm({
      id: book.bookId,
      title: book.title,
      uid: uidGroups(book.rfidUID),
      days: String(book.loanPeriod || 14),
      category: book.category || "",
      shelfLocation: book.shelfLocation || "",
      rackNumber: book.rackNumber || "",
      isbn: book.isbn || "",
    });
    setModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    const uid = normalizeUid(form.uid.join(""));
    if (!uid) { toast("RFID UID must be 8 hex characters", "error"); return; }
    const days = parseInt(form.days, 10);
    if (!days || days <= 0) { toast("Loan period must be a positive number", "error"); return; }
    setSav(true);
    try {
      const uidOwner = await db.findBookByUid(uid);
      if (uidOwner && uidOwner.$id !== editing) {
        toast("RFID UID already registered to another book", "error");
        return;
      }

      const metadata = {
        title: form.title.trim(),
        rfidUID: uid,
        loanPeriod: days,
        category: form.category.trim() || null,
        shelfLocation: form.shelfLocation.trim() || null,
        rackNumber: form.rackNumber.trim() || null,
        isbn: form.isbn.trim() || null,
      };

      if (editing) {
        await db.updateBook(editing, metadata);
        toast(`"${form.title}" updated`);
      } else {
        if (await db.findBookByBookId(form.id.trim())) { toast("Book ID already exists", "error"); return; }
        await db.addBook({
          ...metadata,
          bookId: form.id.trim(),
          status: "AVAILABLE",
        });
        toast(`"${form.title}" added to inventory!`);
      }
      resetForm(); setModal(false); onRefresh();
    } catch (err) { toast(err.message || "Failed to save book", "error"); }
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
          <p>Manage the library book inventory, shelf location and availability.</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}><Ic.plus /> Add Book</button>
      </div>

      <div className="panel">
        <div className="pnl-bar">
          <Searchbar value={q} onChange={setQ} placeholder="Search by title, category, ID, shelf or UID…" />
          <select className="filter-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter by category">
            <option value="ALL">All categories</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select className="filter-select" value={availability} onChange={(e) => setAvailability(e.target.value)} aria-label="Filter by availability">
            <option value="ALL">All availability</option>
            <option value="AVAILABLE">Available</option>
            <option value="BORROWED">Borrowed</option>
          </select>
          <span className="cnt-chip">{list.length} book{list.length === 1 ? "" : "s"}</span>
        </div>

        {list.length === 0 ? (
          q || categoryFilter !== "ALL" || availability !== "ALL"
            ? <EmptyState icon="🔍" msg="No books match the current search and filters." />
            : <EmptyState icon="📚" msg="No books in inventory." action={{ label: "Add Book", fn: openAdd }} />
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Book ID</th><th>Title</th><th>Category</th>
                  <th>Shelf</th><th>Rack</th><th>RFID UID</th>
                  <th>Loan</th><th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.$id}>
                    <td data-label="Book ID"><code className="id-chip">{b.bookId}</code></td>
                    <td data-label="Title">
                      <div className="bk-cell">
                        <span className="bk-ico">📖</span>
                        <div>
                          <div className="cell-main">{b.title}</div>
                          {b.isbn && <div className="cell-sub">ISBN {b.isbn}</div>}
                        </div>
                      </div>
                    </td>
                    <td data-label="Category">
                      {b.category ? <span className="meta-chip">{b.category}</span> : <span className="muted">—</span>}
                    </td>
                    <td data-label="Shelf">
                      {b.shelfLocation ? <span className="meta-chip">{b.shelfLocation}</span> : <span className="muted">—</span>}
                    </td>
                    <td data-label="Rack">
                      {b.rackNumber ? <span className="meta-chip">{b.rackNumber}</span> : <span className="muted">—</span>}
                    </td>
                    <td data-label="RFID UID"><code className="uid-chip">{b.rfidUID.match(/.{2}/g)?.join(":")}</code></td>
                    <td data-label="Loan"><span className="loan-chip">{b.loanPeriod}d</span></td>
                    <td data-label="Status"><Badge status={b.status} /></td>
                    <td data-label="Actions" className="act-cell">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(b)}>
                        <Ic.edit /> Edit
                      </button>
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

      <Modal
        open={modal}
        onClose={() => { setModal(false); resetForm(); }}
        title={editing ? "Edit Book" : "Add New Book"}
        footer={
          <div className="mf-acts">
            <button className="btn btn-ghost" onClick={() => { setModal(false); resetForm(); }} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" form="bf" type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Add Book"}
            </button>
          </div>
        }>
        <form id="bf" onSubmit={handleSave} className="f-grid">
          <div className="f-fld">
            <label>Book ID</label>
            <input required placeholder="e.g. BK-001" value={form.id} disabled={Boolean(editing)}
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
          <div className="f-fld">
            <label>Category</label>
            <input placeholder="e.g. IoT" value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
          </div>
          <div className="f-fld">
            <label>Shelf Location</label>
            <input placeholder="e.g. A-Block" value={form.shelfLocation}
              onChange={(e) => setForm((f) => ({ ...f, shelfLocation: e.target.value }))} />
          </div>
          <div className="f-fld">
            <label>Rack Number</label>
            <input placeholder="e.g. Rack 02" value={form.rackNumber}
              onChange={(e) => setForm((f) => ({ ...f, rackNumber: e.target.value }))} />
          </div>
          <div className="f-fld">
            <label>ISBN <span className="f-hint">optional</span></label>
            <input placeholder="e.g. 9780000000000" value={form.isbn}
              onChange={(e) => setForm((f) => ({ ...f, isbn: e.target.value }))} />
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
const FILTERS = [["ALL","All"], ["BORROWED","Borrowed"], ["RETURNED","Returned"], ["OVERDUE","Overdue"]];

function BorrowingsPage({ borrowings, students, books, onRefresh, toast }) {
  const [filt, setFilt]      = useState("ALL");
  const [q, setQ]            = useState("");
  const [returning, setRet]  = useState(null);

  const sMap = new Map(students.map((s) => [s.studentId, s.name]));
  const bMap = new Map(books.map((b) => [b.bookId, b]));

  const counts = {
    ALL:      borrowings.length,
    BORROWED: borrowings.filter((r) => r.status === "BORROWED").length,
    RETURNED: borrowings.filter((r) => r.status === "RETURNED").length,
    OVERDUE:  borrowings.filter((r) => isOverdue(r.dueDate, r.status)).length,
  };

  const list = borrowings
    .filter((r) => {
      if (filt === "BORROWED") return r.status === "BORROWED";
      if (filt === "RETURNED") return r.status === "RETURNED";
      if (filt === "OVERDUE")  return isOverdue(r.dueDate, r.status);
      return true;
    })
    .filter((r) => {
      if (!q) return true;
      const s = q.toLowerCase();
      return (sMap.get(r.studentId) || "").toLowerCase().includes(s)
          || r.studentId.toLowerCase().includes(s)
          || (bMap.get(r.bookId)?.title || "").toLowerCase().includes(s)
          || r.bookId.toLowerCase().includes(s)
          || (r.borrowBatchId || "").toLowerCase().includes(s)
          || r.$id.toLowerCase().includes(s);
    });

  async function handleReturn(r) {
    setRet(r.$id);
    try {
      try {
        await returnBookViaApi({
          studentId: r.studentId,
          bookId: r.bookId,
          borrowingId: r.$id,
        });
      } catch (apiError) {
        /* `npm run dev` serves Vite only; `npx vercel dev` serves /api.
           In local Vite mode we fall back to the same checks directly against
           Appwrite. In production the backend always enforces them. */
        if (!import.meta.env.DEV || !apiError.unavailable) throw apiError;

        const bookDoc = bMap.get(r.bookId);
        const active = (await db.getActiveBorrowingsForBook(r.bookId))
          .filter((record) => record.status === "BORROWED")
          .sort((a, b) => String(a.$createdAt).localeCompare(String(b.$createdAt)))[0];

        if (!active) throw new Error("No active borrowing record for this book");
        if (active.studentId !== r.studentId) {
          throw new Error("This student did not borrow this book");
        }

        await db.updateBorrowing(active.$id, {
          returnDate: new Date().toISOString(),
          status: "RETURNED",
        });
        if (bookDoc) await db.updateBook(bookDoc.$id, { status: "AVAILABLE" });
      }

      toast("Book returned successfully!");
      onRefresh();
    } catch (err) { toast(err.message || "Return failed", "error"); }
    finally { setRet(null); }
  }

  return (
    <div className="page">
      <div className="pg-head">
        <div>
          <h2>Borrowing History</h2>
          <p>Every borrowing transaction is kept permanently. Returning a book updates the same record.</p>
        </div>
        <span className="cnt-chip">{borrowings.length} total record{borrowings.length === 1 ? "" : "s"}</span>
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
          <Searchbar value={q} onChange={setQ} placeholder="Search by student, book, batch or borrow ID…" />
        </div>

        {list.length === 0 ? (
          <EmptyState icon="📋" msg={q ? `No records matching "${q}"` : "No records in this category."} />
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Borrow ID</th>
                  <th>Student ID</th>
                  <th>Student Name</th>
                  <th>Book ID</th>
                  <th>Book Title</th>
                  <th>Batch ID</th>
                  <th>Issue Date</th>
                  <th>Due Date</th>
                  <th>Return Date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const over = isOverdue(r.dueDate, r.status);
                  const bookDoc = bMap.get(r.bookId);
                  return (
                    <tr key={r.$id} className={over ? "tr-over" : ""}>
                      <td data-label="Borrow ID">
                        <code className="id-chip mono-sm" title={r.$id}>{r.$id}</code>
                      </td>
                      <td data-label="Student ID"><code className="id-chip">{r.studentId}</code></td>
                      <td data-label="Student Name">
                        <div className="cell-main">{sMap.get(r.studentId) || "—"}</div>
                      </td>
                      <td data-label="Book ID"><code className="id-chip">{r.bookId}</code></td>
                      <td data-label="Book Title">
                        <div className="bk-cell"><span className="bk-ico">📖</span>{bookDoc?.title || r.bookId}</div>
                      </td>
                      <td data-label="Batch ID">
                        {r.borrowBatchId
                          ? <code className="batch-chip" title={r.borrowBatchId}>{r.borrowBatchId}</code>
                          : <span className="muted">—</span>}
                      </td>
                      <td data-label="Issue Date">{formatDate(r.issueDate)}</td>
                      <td data-label="Due Date" className={over ? "td-danger" : ""}>{formatDate(r.dueDate)}</td>
                      <td data-label="Return Date">{r.returnDate ? formatDate(r.returnDate) : "—"}</td>
                      <td data-label="Status"><Badge status={r.status} overdue={over} /></td>
                      <td data-label="Actions" className="act-cell">
                        {r.status === "BORROWED" ? (
                          <button className="btn btn-ret btn-sm" onClick={() => handleReturn(r)} disabled={returning === r.$id}>
                            <Ic.ret /> {returning === r.$id ? "…" : "Return"}
                          </button>
                        ) : (
                          <span className="muted mono-sm">Completed</span>
                        )}
                      </td>
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
   SCAN ACTIVITY PAGE
══════════════════════════════════════════════════════════ */
const SCAN_FILTERS = [
  ["ALL", "All"],
  ["SUCCESS", "Successful"],
  ["FAILED", "Failed"],
  ["INVALID", "Invalid"],
  ["BORROW", "Borrow"],
  ["RETURN", "Return"],
];

function ScanActivityPage({ scans, students, books }) {
  const [filt, setFilt] = useState("ALL");
  const [q, setQ] = useState("");

  const sMap = new Map(students.map((s) => [s.studentId, s.name]));
  const bMap = new Map(books.map((b) => [b.bookId, b.title]));

  const value = (log, camel, snake) => log[camel] ?? log[snake] ?? "";
  const actionOf = (log) => String(value(log, "action", "action") || "").toUpperCase();
  const statusOf = (log) => String(value(log, "status", "status") || "").toUpperCase();
  const scanTypeOf = (log) => String(value(log, "scanType", "scan_type") || "").toUpperCase();
  const isInvalid = (log) => actionOf(log) === "INVALID" || scanTypeOf(log) === "UNKNOWN";

  const counts = {
    ALL: scans.length,
    SUCCESS: scans.filter((log) => statusOf(log) === "SUCCESS").length,
    FAILED: scans.filter((log) => statusOf(log) === "FAILED").length,
    INVALID: scans.filter(isInvalid).length,
    BORROW: scans.filter((log) => actionOf(log) === "BORROW").length,
    RETURN: scans.filter((log) => actionOf(log) === "RETURN").length,
  };

  const list = scans
    .filter((log) => {
      if (filt === "SUCCESS") return statusOf(log) === "SUCCESS";
      if (filt === "FAILED") return statusOf(log) === "FAILED";
      if (filt === "INVALID") return isInvalid(log);
      if (filt === "BORROW") return actionOf(log) === "BORROW";
      if (filt === "RETURN") return actionOf(log) === "RETURN";
      return true;
    })
    .filter((log) => {
      if (!q) return true;
      const text = q.toLowerCase();
      return [
        value(log, "rfidUid", "rfid_uid"),
        value(log, "studentId", "student_id"),
        value(log, "bookId", "book_id"),
        value(log, "message", "message"),
        sMap.get(value(log, "studentId", "student_id")),
        bMap.get(value(log, "bookId", "book_id")),
      ].filter(Boolean).some((v) => String(v).toLowerCase().includes(text));
    })
    .sort((a, b) => {
      const left = a.timestamp || a.$createdAt || "";
      const right = b.timestamp || b.$createdAt || "";
      return String(right).localeCompare(String(left));
    });

  return (
    <div className="page">
      <div className="pg-head">
        <div>
          <h2>Scan Activity</h2>
          <p>Every RFID student card and book tag scan, including failed and invalid reads.</p>
        </div>
        <span className="cnt-chip">{scans.length} scan{scans.length === 1 ? "" : "s"}</span>
      </div>

      {!SCAN_COL && (
        <div className="notice">
          <strong>ScanLogs is not configured yet.</strong> Create the ScanLogs collection in
          Appwrite and set <code>VITE_APPWRITE_SCANLOGS_COLLECTION_ID</code> to start recording
          scans. Borrowing and returning still work without it.
        </div>
      )}

      <div className="panel">
        <div className="filt-tabs">
          {SCAN_FILTERS.map(([key, label]) => (
            <button key={key}
              className={`ftab ${filt === key ? "ftab-on" : ""} ${key === "FAILED" && counts.FAILED > 0 ? "ftab-danger" : ""}`}
              onClick={() => setFilt(key)}>
              {label} <span className="ftab-n">{counts[key]}</span>
            </button>
          ))}
        </div>

        <div className="pnl-bar">
          <Searchbar value={q} onChange={setQ} placeholder="Search by UID, student, book or message…" />
        </div>

        {list.length === 0 ? (
          <EmptyState icon="📡" msg={scans.length === 0 ? "No scan activity recorded yet." : "No scans match this filter."} />
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th><th>RFID UID</th><th>Student ID</th>
                  <th>Book ID</th><th>Scan Type</th><th>Action</th>
                  <th>Status</th><th>Message</th>
                </tr>
              </thead>
              <tbody>
                {list.map((log) => {
                  const studentId = value(log, "studentId", "student_id");
                  const bookId = value(log, "bookId", "book_id");
                  const rfidUid = value(log, "rfidUid", "rfid_uid");
                  return (
                    <tr key={log.$id || log.id} className={isInvalid(log) ? "tr-over" : ""}>
                      <td data-label="Timestamp">{formatDateTime(log.timestamp || log.$createdAt)}</td>
                      <td data-label="RFID UID">
                        {rfidUid
                          ? <code className="uid-chip">{String(rfidUid).match(/.{2}/g)?.join(":")}</code>
                          : <span className="muted">—</span>}
                      </td>
                      <td data-label="Student ID">
                        {studentId ? <code className="id-chip">{studentId}</code> : <span className="muted">—</span>}
                        {studentId && sMap.get(studentId) && <div className="cell-sub">{sMap.get(studentId)}</div>}
                      </td>
                      <td data-label="Book ID">
                        {bookId ? <code className="id-chip">{bookId}</code> : <span className="muted">—</span>}
                        {bookId && bMap.get(bookId) && <div className="cell-sub">{bMap.get(bookId)}</div>}
                      </td>
                      <td data-label="Scan Type"><span className="meta-chip">{scanTypeOf(log) || "—"}</span></td>
                      <td data-label="Action"><ActionBadge action={actionOf(log)} /></td>
                      <td data-label="Status"><Badge status={statusOf(log)} /></td>
                      <td data-label="Message" className="msg-cell">{log.message || <span className="muted">—</span>}</td>
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
   INSIGHTS / SMART FEATURES PAGE
══════════════════════════════════════════════════════════ */
function RankList({ rows, empty }) {
  if (!rows.length) return <p className="analytics-empty">{empty}</p>;
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="rank-list">
      {rows.map((row, index) => (
        <div className="rank-row" key={row.key}>
          <span className="rank-no">{index + 1}</span>
          <div className="rank-body">
            <div className="rank-top">
              <span className="rank-name">{row.label}</span>
              <span className="rank-count">{row.count}</span>
            </div>
            <div className="rank-bar"><span style={{ width: `${(row.count / max) * 100}%` }} /></div>
            {row.sub && <span className="rank-sub">{row.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function InsightsPage({ students, books, borrowings }) {
  const [q, setQ] = useState("");

  const bMap = new Map(books.map((b) => [b.bookId, b]));
  const sMap = new Map(students.map((s) => [s.studentId, s]));
  const activeLoans = borrowings.filter((r) => r.status === "BORROWED");
  const returns = borrowings.filter((r) => r.status === "RETURNED");
  const overdue = activeLoans.filter((r) => isOverdue(r.dueDate, r.status));

  const locations = books
    .filter((book) => {
      if (!q) return true;
      const text = q.toLowerCase();
      return [book.title, book.category, book.shelfLocation, book.rackNumber, book.isbn]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(text));
    })
    .slice(0, 12);

  const bookCounts = new Map();
  const categoryCounts = new Map();
  const studentCounts = new Map();
  for (const record of borrowings) {
    bookCounts.set(record.bookId, (bookCounts.get(record.bookId) || 0) + 1);
    studentCounts.set(record.studentId, (studentCounts.get(record.studentId) || 0) + 1);
    const category = bMap.get(record.bookId)?.category || "Uncategorised";
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  }

  const mostBorrowed = [...bookCounts.entries()]
    .map(([bookId, count]) => ({
      key: bookId,
      label: bMap.get(bookId)?.title || bookId,
      sub: bMap.get(bookId)?.category || null,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const mostActiveStudents = [...studentCounts.entries()]
    .map(([studentId, count]) => ({
      key: studentId,
      label: sMap.get(studentId)?.name || studentId,
      sub: studentId,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const mostCategories = [...categoryCounts.entries()]
    .map(([category, count]) => ({ key: category, label: category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const days = lastDays(7).map((day) => ({
    ...day,
    borrowed: borrowings.filter((r) => dayKey(r.issueDate) === day.key).length,
    returned: borrowings.filter((r) => r.returnDate && dayKey(r.returnDate) === day.key).length,
  }));
  const dailyMax = Math.max(1, ...days.flatMap((day) => [day.borrowed, day.returned]));

  const studentRows = students.map((student) => {
    const own = borrowings.filter((r) => r.studentId === student.studentId);
    const active = own.filter((r) => r.status === "BORROWED").length;
    const returned = own.filter((r) => r.status === "RETURNED").length;
    const late = own.filter((r) => isOverdue(r.dueDate, r.status)).length;
    return {
      student,
      total: own.length,
      active,
      returned,
      overdue: late,
      remaining: Math.max(0, MAX_ACTIVE_BOOKS - active),
    };
  }).sort((a, b) => b.total - a.total);

  return (
    <div className="page">
      <div className="pg-head">
        <div>
          <h2>Insights</h2>
          <p>Book locations, borrowing trends and student activity calculated from real records.</p>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="Total Borrowings" value={borrowings.length} icon={<Ic.list />} color="blue" />
        <StatCard label="Active Loans" value={activeLoans.length} icon={<Ic.book />} color="amber" />
        <StatCard label="Total Returns" value={returns.length} icon={<Ic.ret />} color="green" />
        <StatCard label="Overdue Now" value={overdue.length} icon={<Ic.warn />} color="red" />
      </div>

      <div className="panel">
        <div className="pnl-hd">
          <h3><span className="hd-ico"><Ic.locate /></span> Book Location Finder</h3>
          <span className="pnl-cnt">{books.length} books indexed</span>
        </div>
        <div className="pnl-bar">
          <Searchbar value={q} onChange={setQ} placeholder="Search by title, category, ISBN, shelf or rack…" />
        </div>
        {locations.length === 0 ? (
          <EmptyState icon="📍" msg={q ? `No books matching "${q}"` : "No books in inventory."} />
        ) : (
          <div className="loc-list">
            {locations.map((book) => (
              <div className="loc-row" key={book.$id}>
                <div className="loc-main">
                  <span className="bk-ico">📖</span>
                  <div>
                    <div className="cell-main">{book.title}</div>
                    <div className="cell-sub">{book.bookId}{book.isbn ? ` • ISBN ${book.isbn}` : ""}</div>
                  </div>
                </div>
                <div className="loc-meta">
                  <span className="meta-chip">{book.category || "Uncategorised"}</span>
                  <span className="meta-chip">{book.shelfLocation || "Shelf —"}</span>
                  <span className="meta-chip">{book.rackNumber || "Rack —"}</span>
                </div>
                <Badge status={book.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="analytics-grid">
        <div className="panel">
          <div className="pnl-hd"><h3>Most Borrowed Books</h3><span className="pnl-cnt">All time</span></div>
          <RankList rows={mostBorrowed} empty="No borrowing records yet." />
        </div>
        <div className="panel">
          <div className="pnl-hd"><h3>Most Active Students</h3><span className="pnl-cnt">All time</span></div>
          <RankList rows={mostActiveStudents} empty="No student activity yet." />
        </div>
        <div className="panel">
          <div className="pnl-hd"><h3>Most Borrowed Categories</h3><span className="pnl-cnt">All time</span></div>
          <RankList rows={mostCategories} empty="No category data yet." />
        </div>
      </div>

      <div className="panel">
        <div className="pnl-hd">
          <h3>Library Activity — Last 7 Days</h3>
          <span className="chart-legend">
            <span className="lg-borrow">Borrowed</span>
            <span className="lg-return">Returned</span>
          </span>
        </div>
        <div className="activity-chart">
          {days.map((day) => (
            <div className="activity-row" key={day.key}>
              <span className="activity-day">{day.label}</span>
              <div className="activity-bars">
                <span className="bar bar-borrow" style={{ width: `${(day.borrowed / dailyMax) * 100}%` }} title={`${day.borrowed} borrowed`} />
                <span className="bar bar-return" style={{ width: `${(day.returned / dailyMax) * 100}%` }} title={`${day.returned} returned`} />
              </div>
              <span className="activity-count">{day.borrowed} / {day.returned}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="pnl-hd">
          <h3>Student Borrowing Analytics</h3>
          <span className="pnl-cnt">{students.length} students</span>
        </div>
        {studentRows.length === 0 ? (
          <EmptyState icon="👥" msg="No students registered." />
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th><th>Total Borrowed</th><th>Currently Borrowed</th>
                  <th>Returned</th><th>Overdue</th><th>Capacity</th>
                </tr>
              </thead>
              <tbody>
                {studentRows.map(({ student, total, active, returned, overdue: late, remaining }) => (
                  <tr key={student.$id}>
                    <td data-label="Student">
                      <div className="cell-main">{student.name}</div>
                      <div className="cell-sub">{student.studentId}</div>
                    </td>
                    <td data-label="Total Borrowed"><strong>{total}</strong></td>
                    <td data-label="Currently Borrowed"><strong>{active}</strong> / {MAX_ACTIVE_BOOKS}</td>
                    <td data-label="Returned">{returned}</td>
                    <td data-label="Overdue" className={late ? "td-danger" : ""}>{late}</td>
                    <td data-label="Capacity">
                      <div className="borrow-cell">
                        <span className="borrow-line"><strong>{active} / {MAX_ACTIVE_BOOKS}</strong> · {remaining} left</span>
                        <div className="borrow-meter" aria-hidden="true">
                          <span style={{ width: `${(active / MAX_ACTIVE_BOOKS) * 100}%` }} />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
  { id: "scans",      label: "Scan Activity", Icon: Ic.scan },
  { id: "insights",   label: "Insights",   Icon: Ic.chart },
];

export default function App() {
  const [students,   setStudents]   = useState([]);
  const [books,      setBooks]      = useState([]);
  const [borrowings, setBorrowings] = useState([]);
  const [scans,      setScans]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [online,     setOnline]     = useState(null);
  const [error,      setError]      = useState("");
  const [page,       setPage]       = useState("dashboard");
  const [theme,      setTheme]      = useState(() => localStorage.getItem("rfid-theme") || "light");
  const { toasts, toast, dismiss }  = useToast();
  const realtimeTimer = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("rfid-theme", theme);
  }, [theme]);

  const load = useCallback(async () => {
    try {
      const [s, b, r, l] = await Promise.all([
        db.getStudents(),
        db.getBooks(),
        db.getBorrowings(),
        /* ScanLogs is optional; a missing or unreadable collection must not
           take down the core library dashboard. */
        db.getScanLogs().catch((scanError) => {
          console.warn("[ScanLogs] unavailable:", scanError?.message || scanError);
          return [];
        }),
      ]);
      setStudents(s.map((student) => ({ ...student, status: student.status || "ACTIVE" })));
      setBooks(b);
      setBorrowings(r);
      setScans(l);
      setOnline(true);
      setError("");
    } catch (err) {
      console.error("[Appwrite]", err);
      setOnline(false);
      setError(err?.message || "Unknown error");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  /* Appwrite Realtime keeps the dashboard in sync as soon as the ESP32 or the
     website writes a document. Polling above remains as a fallback. */
  useEffect(() => {
    if (!DB_ID || !S_COL || !B_COL || !BOR_COL) return undefined;

    let unsubscribe = () => {};
    try {
      const channels = [
        `databases.${DB_ID}.collections.${S_COL}.documents`,
        `databases.${DB_ID}.collections.${B_COL}.documents`,
        `databases.${DB_ID}.collections.${BOR_COL}.documents`,
      ];
      if (SCAN_COL) channels.push(`databases.${DB_ID}.collections.${SCAN_COL}.documents`);

      unsubscribe = client.subscribe(
        channels,
        () => {
          if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
          realtimeTimer.current = setTimeout(() => load(), 250);
        }
      );
    } catch (err) {
      console.warn("[Appwrite Realtime] unavailable, polling will continue:", err?.message || err);
    }

    return () => {
      try { unsubscribe(); } catch { /* already closed */ }
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
    };
  }, [load]);

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
              {page === "dashboard"  && <Dashboard   students={students} books={books} borrowings={borrowings} scans={scans} />}
              {page === "students"   && <StudentsPage students={students} borrowings={borrowings} onRefresh={load} toast={toast} />}
              {page === "books"      && <BooksPage    books={books}       onRefresh={load} toast={toast} />}
              {page === "borrowings" && <BorrowingsPage borrowings={borrowings} students={students} books={books} onRefresh={load} toast={toast} />}
              {page === "scans"      && <ScanActivityPage scans={scans} students={students} books={books} />}
              {page === "insights"   && <InsightsPage students={students} books={books} borrowings={borrowings} />}
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
