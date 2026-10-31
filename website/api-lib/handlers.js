import { randomUUID } from "node:crypto";
import * as db from "./db.js";
import {
  send,
  sendDatabaseError,
  normalizeText,
  normalizeUid,
  readJsonBody
} from "./http.js";

/* ── constants ───────────────────────────────────────────── */

export const MAX_ACTIVE_BOOKS = 4;
const MAX_BATCH_ID_LENGTH = 64;
const RACE_RECHECK_ATTEMPTS = 3;
const RACE_RECHECK_DELAY_MS = 120;

/* ── helpers ─────────────────────────────────────────────── */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* A 24-character id keeps us comfortably inside a 36/64-char string
   attribute while still being unique enough for a visit batch. */
function newBatchId() {
  return `B${randomUUID().replace(/-/g, "").slice(0, 23)}`;
}

function normalizeBatchId(value) {
  const text = normalizeText(value, MAX_BATCH_ID_LENGTH);
  if (!text) return null;
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text : null;
}

/* Oldest loan first. `$createdAt` is the authoritative server timestamp;
   issueDate and $id are fallbacks for older documents. */
function loanSortKey(record) {
  return `${record.$createdAt || record.issueDate || ""}|${record.id || record.$id || ""}`;
}

function sortLoans(records) {
  return [...records].sort((a, b) => loanSortKey(a).localeCompare(loanSortKey(b)));
}

/* The book status is derived from the loan records so a failed request can
   never leave the two out of sync. */
async function syncBookStatus(bookId) {
  const book = await db.findBookById(bookId);
  if (!book) return null;
  const active = await db.listActiveBorrowingsForBook(bookId);
  const status = active.length ? "BORROWED" : "AVAILABLE";
  if (book.status !== status) return db.updateBook(book.id, { status });
  return book;
}

/* Reads the active list until the new document is visible. Appwrite commits
   writes synchronously, but a short re-read makes the winner/loser decision
   deterministic if two requests land at the same moment. */
async function waitForLoanVisibility(recordId, listFn) {
  let records = [];
  for (let attempt = 0; attempt < RACE_RECHECK_ATTEMPTS; attempt += 1) {
    records = sortLoans(await listFn());
    const rank = records.findIndex((record) => record.id === recordId);
    if (rank !== -1) return { records, rank };
    if (attempt < RACE_RECHECK_ATTEMPTS - 1) await sleep(RACE_RECHECK_DELAY_MS);
  }
  return { records, rank: -1 };
}

async function rollbackBorrow(recordId, bookId) {
  try {
    const current = await db.findBorrowById(recordId);
    if (current && current.status === "BORROWED") {
      await db.deleteBorrowRecord(recordId);
    }
  } catch {
    /* Already gone — nothing to roll back. */
  }
  try {
    await syncBookStatus(bookId);
  } catch {
    /* Best effort; the next borrow/return will reconcile the status. */
  }
}

/* ScanLogs is optional: when the collection is not configured yet the helper
   quietly does nothing so RFID borrowing/returning keeps working. */
async function logScan({ studentId, bookId, rfidUid, scanType, action, status, message }) {
  const allowedActions = ["BORROW", "RETURN", "INVALID"];
  const normalizedAction = allowedActions.includes(action) ? action : "INVALID";
  const normalizedStatus = status === "SUCCESS" ? "SUCCESS" : "FAILED";

  try {
    await db.createScanLog({
      studentId: normalizeText(studentId, 36) || null,
      bookId: normalizeText(bookId, 36) || null,
      rfidUid: normalizeText(rfidUid, 32) || null,
      scanType: normalizeText(scanType, 20) || "UNKNOWN",
      action: normalizedAction,
      status: normalizedStatus,
      timestamp: new Date().toISOString(),
      message: normalizeText(message, 500) || null
    });
  } catch (error) {
    console.error("[ScanLogs]", error.message);
  }
}

async function findTagByUid(rawUid) {
  const uid = normalizeUid(rawUid);
  if (!uid) {
    return { error: "Invalid RFID UID format. Expected 8 hexadecimal characters.", status: 400 };
  }

  const student = await db.findStudentByUid(uid);
  if (student) {
    const active = await db.listActiveBorrowingsForStudent(student.studentId);
    const activeBooks = active.length;
    const remaining = Math.max(0, MAX_ACTIVE_BOOKS - activeBooks);
    const studentStatus = student.status || "ACTIVE";
    const activeStatus = studentStatus === "ACTIVE";
    const canBorrow = activeStatus && remaining > 0;

    return {
      type: "STUDENT",
      message: !activeStatus
        ? "Student is inactive"
        : remaining > 0
          ? "Student verified"
          : `Student verified — borrowing limit reached (${MAX_ACTIVE_BOOKS}/${MAX_ACTIVE_BOOKS})`,
      student: {
        id: student.studentId,
        name: student.name,
        uid: student.rfidUID,
        status: studentStatus,
        active_books: activeBooks,
        max_books: MAX_ACTIVE_BOOKS,
        remaining,
        can_borrow: canBorrow
      },
      borrowBatchId: newBatchId(),
      activeBooks,
      maxBooks: MAX_ACTIVE_BOOKS,
      remaining
    };
  }

  const book = await db.findBookByUid(uid);
  if (book) {
    const active = await db.listActiveBorrowingsForBook(book.bookId);
    const activeRecord = sortLoans(active)[0] || null;
    const available = book.status === "AVAILABLE" && !activeRecord;

    return {
      type: "BOOK",
      message: available
        ? "Book verified"
        : activeRecord
          ? "Book is already borrowed"
          : "Book is unavailable",
      available,
      book: {
        id: book.bookId,
        title: book.title,
        uid: book.rfidUID,
        loan_days: book.loanPeriod,
        status: book.status,
        category: book.category || null,
        shelf_location: book.shelfLocation || null,
        rack_number: book.rackNumber || null
      },
      activeBorrowing: activeRecord
        ? {
            id: activeRecord.id,
            studentId: activeRecord.studentId,
            issueDate: activeRecord.issueDate,
            dueDate: activeRecord.dueDate
          }
        : null
    };
  }

  return { error: "Unregistered RFID tag", status: 404 };
}

/* ── routes ──────────────────────────────────────────────── */

async function health(req, res) {
  const result = await db.checkConnection();
  return send(res, result.connected ? 200 : 503, {
    status: result.connected ? "ok" : "degraded",
    message: "RFID Library API is running",
    limits: { maxActiveBooks: MAX_ACTIVE_BOOKS },
    appwrite: {
      configured: db.appwriteConfig.configured,
      auth: db.appwriteConfig.authMode,
      connected: result.connected,
      scanLogsConfigured: db.appwriteConfig.scanLogsConfigured,
      error: result.error
    }
  });
}

async function listStudents(req, res) {
  const [students, records] = await Promise.all([
    db.listStudents(),
    db.listBorrowRecords()
  ]);

  const activeCounts = new Map();
  for (const record of records) {
    if (record.status !== "BORROWED") continue;
    activeCounts.set(record.studentId, (activeCounts.get(record.studentId) || 0) + 1);
  }

  return send(res, 200, students.map((student) => {
    const activeBooks = activeCounts.get(student.studentId) || 0;
    return {
      id: student.studentId,
      name: student.name,
      uid: student.rfidUID,
      status: student.status || "ACTIVE",
      created_at: student.$createdAt || null,
      active_books: activeBooks,
      max_books: MAX_ACTIVE_BOOKS,
      remaining: Math.max(0, MAX_ACTIVE_BOOKS - activeBooks),
      can_borrow: activeBooks < MAX_ACTIVE_BOOKS
    };
  }));
}

async function listBooks(req, res) {
  const books = await db.listBooks();
  return send(res, 200, books.map((book) => ({
    id: book.bookId,
    title: book.title,
    uid: book.rfidUID,
    loan_days: book.loanPeriod,
    status: book.status,
    category: book.category || null,
    shelf_location: book.shelfLocation || null,
    rack_number: book.rackNumber || null,
    isbn: book.isbn || null
  })));
}

async function createStudent(req, res) {
  const body = readJsonBody(req) ?? {};
  const studentId = normalizeText(body.id, 36);
  const name = normalizeText(body.name, 120);
  const rfidUID = normalizeUid(body.uid);
  const status = body.status === "INACTIVE" ? "INACTIVE" : "ACTIVE";

  if (!studentId || !name || !rfidUID) {
    return send(res, 400, {
      error: "Student ID, name, and a valid 8-character RFID UID are required"
    });
  }

  if (await db.findStudentById(studentId) || await db.findStudentByUid(rfidUID)) {
    return send(res, 409, { error: "Student ID or RFID UID already exists" });
  }

  const student = await db.createStudent({ studentId, name, rfidUID, status });
  return send(res, 201, {
    id: student.studentId,
    name,
    uid: student.rfidUID,
    status: student.status || status
  });
}

async function deleteStudent(req, res, studentId) {
  const id = normalizeText(studentId, 36);

  const active = await db.listActiveBorrowingsForStudent(id);
  if (active.length) {
    return send(res, 409, {
      error: "Cannot delete a student with active borrowing history"
    });
  }

  const records = await db.listBorrowRecords();
  if (records.some((record) => record.studentId === id)) {
    return send(res, 409, { error: "Cannot delete a student with borrowing history" });
  }

  const student = await db.findStudentById(id);
  if (!student) return send(res, 404, { error: "Student not found" });

  await db.deleteStudent(student.id);
  return send(res, 200, { message: "Student deleted successfully" });
}

async function createBook(req, res) {
  const body = readJsonBody(req) ?? {};
  const bookId = normalizeText(body.id, 36);
  const title = normalizeText(body.title, 200);
  const rfidUID = normalizeUid(body.uid);
  const loanPeriod = Number(body.loan_days);
  const category = normalizeText(body.category, 80);
  const shelfLocation = normalizeText(body.shelfLocation, 80);
  const rackNumber = normalizeText(body.rackNumber, 40);
  const isbn = normalizeText(body.isbn, 20);

  if (!bookId || !title || !rfidUID ||
      !Number.isInteger(loanPeriod) || loanPeriod <= 0) {
    return send(res, 400, {
      error: "Book ID, title, valid RFID UID, and positive loan days are required"
    });
  }

  if (await db.findBookById(bookId) || await db.findBookByUid(rfidUID)) {
    return send(res, 409, { error: "Book ID or RFID UID already exists" });
  }

  const payload = { bookId, title, rfidUID, loanPeriod, status: "AVAILABLE" };
  if (category) payload.category = category;
  if (shelfLocation) payload.shelfLocation = shelfLocation;
  if (rackNumber) payload.rackNumber = rackNumber;
  if (isbn) payload.isbn = isbn;

  const book = await db.createBook(payload);

  return send(res, 201, {
    id: book.bookId,
    title: book.title,
    uid: book.rfidUID,
    loan_days: book.loanPeriod,
    status: book.status,
    category: book.category || null,
    shelf_location: book.shelfLocation || null,
    rack_number: book.rackNumber || null,
    isbn: book.isbn || null
  });
}

async function deleteBook(req, res, bookId) {
  const id = normalizeText(bookId, 36);

  const records = await db.listBorrowingsForBook(id);
  if (records.length) {
    return send(res, 409, { error: "Cannot delete a book with borrowing history" });
  }

  const book = await db.findBookById(id);
  if (!book) return send(res, 404, { error: "Book not found" });

  await db.deleteBook(book.id);
  return send(res, 200, { message: "Book deleted successfully" });
}

async function listBorrowings(req, res) {
  const [records, students, books] = await Promise.all([
    db.listBorrowRecords(),
    db.listStudents(),
    db.listBooks()
  ]);
  const studentMap = new Map(students.map((s) => [s.studentId, s]));
  const bookMap = new Map(books.map((b) => [b.bookId, b]));
  const now = new Date();

  return send(res, 200, records.map((record) => ({
    id: record.id,
    student_id: record.studentId,
    student_name: studentMap.get(record.studentId)?.name || record.studentId,
    book_id: record.bookId,
    book_title: bookMap.get(record.bookId)?.title || record.bookId,
    borrow_batch_id: record.borrowBatchId || null,
    issue_date: record.issueDate,
    due_date: record.dueDate,
    return_date: record.returnDate || null,
    status: record.status,
    overdue: record.status === "BORROWED" &&
      Boolean(record.dueDate) && new Date(record.dueDate) < now
  })));
}

async function borrow(req, res) {
  const body = readJsonBody(req) ?? {};
  const studentId = normalizeText(body.studentId, 36);
  const bookId = normalizeText(body.bookId, 36);
  const log = {
    studentId,
    bookId,
    rfidUid: normalizeText(body.rfidUid ?? body.uid, 32)
  };

  const fail = async (status, payload) => {
    await logScan({
      ...log,
      scanType: "BOOK",
      action: "BORROW",
      status: "FAILED",
      message: payload.error || "Borrow failed"
    });
    return send(res, status, payload);
  };

  const succeed = async (status, payload) => {
    await logScan({
      ...log,
      scanType: "BOOK",
      action: "BORROW",
      status: "SUCCESS",
      message: payload.message || "Book borrowed successfully"
    });
    return send(res, status, payload);
  };

  if (!studentId || !bookId) {
    return fail(400, {
      error: "studentId and bookId are required",
      code: "INVALID_REQUEST"
    });
  }

  let borrowBatchId = newBatchId();
  const rawBatch = body.borrowBatchId ?? body.batchId;
  if (rawBatch !== undefined && rawBatch !== null && String(rawBatch).trim() !== "") {
    borrowBatchId = normalizeBatchId(rawBatch);
    if (!borrowBatchId) {
      return fail(400, {
        error: `borrowBatchId must be 1-${MAX_BATCH_ID_LENGTH} characters using letters, numbers, ".", "_", ":" or "-"`,
        code: "INVALID_BATCH_ID"
      });
    }
  }

  const [student, book] = await Promise.all([
    db.findStudentById(studentId),
    db.findBookById(bookId)
  ]);
  if (!student) {
    return fail(404, {
      error: `Student "${studentId}" is not registered`,
      code: "STUDENT_NOT_FOUND"
    });
  }
  if (!book) {
    return fail(404, {
      error: `Book "${bookId}" is not registered`,
      code: "BOOK_NOT_FOUND"
    });
  }

  log.rfidUid = log.rfidUid || book.rfidUID || "";

  if ((student.status || "ACTIVE") !== "ACTIVE") {
    return fail(409, {
      error: `Student "${student.name}" is inactive and cannot borrow books`,
      code: "STUDENT_INACTIVE"
    });
  }

  const loanPeriod = Number(book.loanPeriod);
  if (!Number.isFinite(loanPeriod) || loanPeriod <= 0) {
    return fail(409, {
      error: `Book "${book.title}" has an invalid loan period`,
      code: "INVALID_LOAN_PERIOD"
    });
  }

  const [studentLoans, bookLoans] = await Promise.all([
    db.listActiveBorrowingsForStudent(studentId),
    db.listActiveBorrowingsForBook(bookId)
  ]);

  if (studentLoans.length >= MAX_ACTIVE_BOOKS) {
    return fail(409, {
      error: `Borrowing limit reached: ${student.name} already has ${studentLoans.length} of ${MAX_ACTIVE_BOOKS} books. Return a book before borrowing another.`,
      code: "MAX_BOOKS_REACHED",
      activeBooks: studentLoans.length,
      maxBooks: MAX_ACTIVE_BOOKS,
      remaining: 0
    });
  }

  if (bookLoans.length > 0 || book.status !== "AVAILABLE") {
    return fail(409, {
      error: `Book "${book.title}" is not available${bookLoans[0]?.studentId ? ` (currently borrowed by ${bookLoans[0].studentId})` : ""}`,
      code: "BOOK_UNAVAILABLE",
      status: book.status
    });
  }

  const issueDate = new Date();
  const dueDate = new Date(issueDate);
  dueDate.setDate(dueDate.getDate() + loanPeriod);

  let record;
  try {
    record = await db.createBorrowRecord({
      studentId,
      bookId,
      issueDate: issueDate.toISOString(),
      dueDate: dueDate.toISOString(),
      returnDate: null,
      status: "BORROWED",
      borrowBatchId
    });
  } catch (error) {
    await logScan({
      ...log,
      scanType: "BOOK",
      action: "BORROW",
      status: "FAILED",
      message: error.message
    });
    throw error;
  }

  try {
    /* Concurrent requests can both pass the pre-check. The server timestamp
       order decides the winner; every loser removes its own new record. */
    const studentCheck = await waitForLoanVisibility(
      record.id,
      () => db.listActiveBorrowingsForStudent(studentId)
    );
    if (studentCheck.rank === -1) {
      await rollbackBorrow(record.id, bookId);
      return fail(503, {
        error: "Borrowing could not be confirmed. Please scan again.",
        code: "BORROW_NOT_CONFIRMED"
      });
    }
    if (studentCheck.rank >= MAX_ACTIVE_BOOKS) {
      await rollbackBorrow(record.id, bookId);
      return fail(409, {
        error: `Borrowing limit reached: ${student.name} already has ${MAX_ACTIVE_BOOKS} of ${MAX_ACTIVE_BOOKS} books. Return a book before borrowing another.`,
        code: "MAX_BOOKS_REACHED",
        activeBooks: MAX_ACTIVE_BOOKS,
        maxBooks: MAX_ACTIVE_BOOKS,
        remaining: 0
      });
    }

    const bookCheck = await waitForLoanVisibility(
      record.id,
      () => db.listActiveBorrowingsForBook(bookId)
    );
    if (bookCheck.rank === -1) {
      await rollbackBorrow(record.id, bookId);
      return fail(503, {
        error: "Borrowing could not be confirmed. Please scan again.",
        code: "BORROW_NOT_CONFIRMED"
      });
    }
    if (bookCheck.rank > 0) {
      await rollbackBorrow(record.id, bookId);
      return fail(409, {
        error: `Book "${book.title}" was just borrowed by another student. Scan an available book.`,
        code: "BOOK_UNAVAILABLE"
      });
    }

    await db.updateBook(book.id, { status: "BORROWED" });

    const activeFinal = await db.listActiveBorrowingsForStudent(studentId);
    return succeed(201, {
      message: "Book borrowed successfully",
      borrowingId: record.id,
      studentId,
      studentName: student.name,
      bookId,
      bookTitle: book.title,
      borrowBatchId,
      issueDate: record.issueDate,
      dueDate: record.dueDate,
      returnDate: null,
      status: "BORROWED",
      activeBooks: activeFinal.length,
      maxBooks: MAX_ACTIVE_BOOKS,
      remaining: Math.max(0, MAX_ACTIVE_BOOKS - activeFinal.length)
    });
  } catch (error) {
    await rollbackBorrow(record.id, bookId);
    await logScan({
      ...log,
      scanType: "BOOK",
      action: "BORROW",
      status: "FAILED",
      message: error.message
    });
    throw error;
  }
}

async function returnBook(req, res) {
  const body = readJsonBody(req) ?? {};
  const studentId = normalizeText(body.studentId, 36);
  const bookId = normalizeText(body.bookId, 36);
  const borrowingId = normalizeText(body.borrowingId ?? body.id, 36);
  const log = {
    studentId,
    bookId,
    rfidUid: normalizeText(body.rfidUid ?? body.uid, 32)
  };

  const fail = async (status, payload) => {
    await logScan({
      ...log,
      scanType: "BOOK",
      action: "RETURN",
      status: "FAILED",
      message: payload.error || "Return failed"
    });
    return send(res, status, payload);
  };

  if (!bookId && !borrowingId) {
    return fail(400, {
      error: "bookId or borrowingId is required",
      code: "INVALID_REQUEST"
    });
  }

  let active;
  if (borrowingId) {
    let record;
    try {
      record = await db.findBorrowById(borrowingId);
    } catch (error) {
      if (error?.code === 404) {
        return fail(404, {
          error: "Borrowing record not found",
          code: "BORROWING_NOT_FOUND"
        });
      }
      throw error;
    }
    if (bookId && record.bookId !== bookId) {
      return fail(400, {
        error: "The borrowing record does not belong to the supplied book",
        code: "BOOK_MISMATCH"
      });
    }
    if (record.status !== "BORROWED") {
      return fail(409, {
        error: "This borrowing record has already been returned",
        code: "ALREADY_RETURNED",
        borrowingId: record.id,
        returnDate: record.returnDate || null,
        status: record.status
      });
    }
    active = record;
  } else {
    const records = await db.listBorrowingsForBook(bookId);
    const candidates = sortLoans(records.filter((record) => record.status === "BORROWED"));

    if (!candidates.length) {
      return fail(409, {
        error: "No active borrowing record for this book",
        code: "NO_ACTIVE_LOAN"
      });
    }

    if (studentId) {
      const own = candidates.filter((record) => record.studentId === studentId);
      if (!own.length) {
        return fail(409, {
          error: "This student did not borrow this book",
          code: "NOT_BORROWER"
        });
      }
      active = own[0];
    } else {
      active = candidates[0];
    }
  }

  log.studentId = log.studentId || active.studentId;
  log.bookId = log.bookId || active.bookId;

  if (studentId && active.studentId !== studentId) {
    return fail(409, {
      error: "This student did not borrow this book",
      code: "NOT_BORROWER"
    });
  }

  const book = await db.findBookById(active.bookId);
  if (!book) {
    return fail(404, {
      error: `Book "${active.bookId}" is not registered`,
      code: "BOOK_NOT_FOUND"
    });
  }

  log.rfidUid = log.rfidUid || book.rfidUID || "";

  const returnDate = new Date().toISOString();
  await db.updateBorrowRecord(active.id, { returnDate, status: "RETURNED" });

  try {
    const remaining = await db.listActiveBorrowingsForBook(active.bookId);
    await db.updateBook(book.id, {
      status: remaining.length ? "BORROWED" : "AVAILABLE"
    });
  } catch (error) {
    /* Restore the loan so the record and the book status stay consistent. */
    try {
      await db.updateBorrowRecord(active.id, {
        returnDate: active.returnDate || null,
        status: active.status
      });
    } catch {
      /* The database error is reported below. */
    }
    await logScan({
      ...log,
      scanType: "BOOK",
      action: "RETURN",
      status: "FAILED",
      message: error.message
    });
    throw error;
  }

  const student = await db.findStudentById(active.studentId);

  await logScan({
    ...log,
    scanType: "BOOK",
    action: "RETURN",
    status: "SUCCESS",
    message: "Book returned successfully"
  });

  return send(res, 200, {
    message: "Book returned successfully",
    borrowingId: active.id,
    studentId: active.studentId,
    studentName: student?.name || active.studentId,
    bookId: active.bookId,
    bookTitle: book.title,
    borrowBatchId: active.borrowBatchId || null,
    issueDate: active.issueDate,
    dueDate: active.dueDate,
    returnDate,
    status: "RETURNED"
  });
}

/* Borrowing history is permanent: records are updated on return, never removed.
   The internal rollback helper above is the only code allowed to delete a
   record, and only for a borrow that lost a concurrency race. */
async function deleteBorrowing(req, res) {
  return send(res, 403, {
    error: "Borrowing history is permanent and cannot be deleted",
    code: "HISTORY_IMMUTABLE"
  });
}

async function listScanLogs(req, res) {
  const logs = await db.listScanLogs();
  const sorted = [...logs].sort((a, b) => {
    const left = a.timestamp || a.$createdAt || "";
    const right = b.timestamp || b.$createdAt || "";
    return String(right).localeCompare(String(left));
  });

  return send(res, 200, sorted.map((log) => ({
    id: log.id,
    student_id: log.studentId || null,
    book_id: log.bookId || null,
    rfid_uid: log.rfidUid || null,
    scan_type: log.scanType || null,
    action: log.action || null,
    status: log.status || null,
    timestamp: log.timestamp || log.$createdAt || null,
    message: log.message || null
  })));
}

async function scan(req, res) {
  const body = readJsonBody(req) ?? {};
  const rawUid = body.uid ?? body.rfidUid;
  const requestedAction = String(body.action || "").toUpperCase();
  const action = requestedAction === "RETURN" ? "RETURN" : "BORROW";
  const contextStudentId = normalizeText(body.studentId, 36);
  const result = await findTagByUid(rawUid);

  if (result.error) {
    await logScan({
      studentId: contextStudentId,
      bookId: null,
      rfidUid: normalizeUid(rawUid) || normalizeText(rawUid, 32),
      scanType: "UNKNOWN",
      action: "INVALID",
      status: "FAILED",
      message: result.error
    });
    return send(res, result.status, { error: result.error });
  }

  if (result.type === "STUDENT") {
    const student = result.student;
    const studentCanProceed = action === "RETURN" || student.can_borrow;
    await logScan({
      studentId: student.id,
      bookId: null,
      rfidUid: student.uid,
      scanType: "STUDENT",
      action,
      status: studentCanProceed ? "SUCCESS" : "FAILED",
      message: result.message
    });
    return send(res, 200, { ...result, scanAction: action });
  }

  const book = result.book;
  const borrower = result.activeBorrowing?.studentId || null;
  const bookCanProceed = action === "BORROW"
    ? result.available
    : Boolean(borrower) && (!contextStudentId || borrower === contextStudentId);

  await logScan({
    studentId: contextStudentId || borrower,
    bookId: book.id,
    rfidUid: book.uid,
    scanType: "BOOK",
    action,
    status: bookCanProceed ? "SUCCESS" : "FAILED",
    message: result.message
  });

  return send(res, 200, { ...result, scanAction: action });
}

/* ── router ──────────────────────────────────────────────── */

export async function route(method, segments, req, res) {
  const [resource, param] = segments;
  const key = `${method} /${segments.join("/")}`;

  try {
    if (resource === "health" && method === "GET") return await health(req, res);
    if (resource === "scan" && method === "POST") return await scan(req, res);
    if (resource === "borrow" && method === "POST") return await borrow(req, res);
    if (resource === "return" && method === "POST") return await returnBook(req, res);

    if (resource === "students") {
      if (method === "GET" && !param) return await listStudents(req, res);
      if (method === "POST" && !param) return await createStudent(req, res);
      if (method === "DELETE" && param) return await deleteStudent(req, res, param);
    }

    if (resource === "books") {
      if (method === "GET" && !param) return await listBooks(req, res);
      if (method === "POST" && !param) return await createBook(req, res);
      if (method === "DELETE" && param) return await deleteBook(req, res, param);
    }

    if (resource === "borrowings") {
      if (method === "GET" && !param) return await listBorrowings(req, res);
      if (method === "DELETE" && param) return await deleteBorrowing(req, res, param);
    }

    if (resource === "scanlogs" && method === "GET" && !param) {
      return await listScanLogs(req, res);
    }
  } catch (error) {
    return sendDatabaseError(res, error);
  }

  return send(res, 404, { error: `No route for ${key}` });
}
