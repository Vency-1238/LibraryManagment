import * as db from "./db.js";
import {
  send,
  sendDatabaseError,
  normalizeText,
  normalizeUid,
  readJsonBody
} from "./http.js";

/* ── helpers ─────────────────────────────────────────────── */

async function findTagByUid(rawUid) {
  const uid = normalizeUid(rawUid);
  if (!uid) {
    return { error: "Invalid RFID UID format", status: 400 };
  }

  const student = await db.findStudentByUid(uid);
  if (student) {
    return {
      type: "STUDENT",
      message: "Student verified",
      student: {
        id: student.studentId,
        name: student.name,
        uid: student.rfidUID
      }
    };
  }

  const book = await db.findBookByUid(uid);
  if (book) {
    const active = (await db.listBorrowingsForBook(book.bookId))
      .some((record) => record.status === "BORROWED");

    return {
      type: "BOOK",
      message: active ? "Book is already borrowed" : "Book verified",
      available: book.status === "AVAILABLE" && !active,
      book: {
        id: book.bookId,
        title: book.title,
        uid: book.rfidUID,
        loan_days: book.loanPeriod
      }
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
    appwrite: {
      configured: db.appwriteConfig.configured,
      auth: db.appwriteConfig.authMode,
      connected: result.connected,
      error: result.error
    }
  });
}

async function listStudents(req, res) {
  const students = await db.listStudents();
  return send(res, 200, students.map((student) => ({
    id: student.studentId,
    name: student.name,
    uid: student.rfidUID
  })));
}

async function listBooks(req, res) {
  const books = await db.listBooks();
  return send(res, 200, books.map((book) => ({
    id: book.bookId,
    title: book.title,
    uid: book.rfidUID,
    loan_days: book.loanPeriod,
    status: book.status
  })));
}

async function createStudent(req, res) {
  const body = readJsonBody(req) ?? {};
  const studentId = normalizeText(body.id, 36);
  const name = normalizeText(body.name, 120);
  const rfidUID = normalizeUid(body.uid);

  if (!studentId || !name || !rfidUID) {
    return send(res, 400, {
      error: "Student ID, name, and a valid 8-character RFID UID are required"
    });
  }

  if (await db.findStudentById(studentId) || await db.findStudentByUid(rfidUID)) {
    return send(res, 409, { error: "Student ID or RFID UID already exists" });
  }

  const student = await db.createStudent({ studentId, name, rfidUID });
  return send(res, 201, { id: student.studentId, name, uid: student.rfidUID });
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

  if (!bookId || !title || !rfidUID ||
      !Number.isInteger(loanPeriod) || loanPeriod <= 0) {
    return send(res, 400, {
      error: "Book ID, title, valid RFID UID, and positive loan days are required"
    });
  }

  if (await db.findBookById(bookId) || await db.findBookByUid(rfidUID)) {
    return send(res, 409, { error: "Book ID or RFID UID already exists" });
  }

  const book = await db.createBook({
    bookId, title, rfidUID, loanPeriod, status: "AVAILABLE"
  });

  return send(res, 201, {
    id: book.bookId,
    title: book.title,
    uid: book.rfidUID,
    loan_days: book.loanPeriod,
    status: book.status
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

  return send(res, 200, records.map((record) => ({
    id: record.id,
    student_id: record.studentId,
    student_name: studentMap.get(record.studentId)?.name || record.studentId,
    book_id: record.bookId,
    book_title: bookMap.get(record.bookId)?.title || record.bookId,
    issue_date: record.issueDate,
    due_date: record.dueDate,
    return_date: record.returnDate || null,
    status: record.status
  })));
}

async function borrow(req, res) {
  const body = readJsonBody(req) ?? {};
  const studentId = normalizeText(body.studentId, 36);
  const bookId = normalizeText(body.bookId, 36);

  if (!studentId || !bookId) {
    return send(res, 400, { error: "studentId and bookId are required" });
  }

  const [student, book] = await Promise.all([
    db.findStudentById(studentId),
    db.findBookById(bookId)
  ]);
  if (!student) return send(res, 404, { error: "Student not registered" });
  if (!book) return send(res, 404, { error: "Book not registered" });
  if (book.status !== "AVAILABLE") {
    return send(res, 409, { error: "Book is already borrowed" });
  }

  const active = (await db.listBorrowingsForBook(bookId))
    .some((record) => record.status === "BORROWED");
  if (active) return send(res, 409, { error: "Book is already borrowed" });

  const issueDate = new Date();
  const dueDate = new Date(issueDate);
  dueDate.setDate(dueDate.getDate() + book.loanPeriod);

  const record = await db.createBorrowRecord({
    studentId,
    bookId,
    issueDate: issueDate.toISOString(),
    dueDate: dueDate.toISOString(),
    status: "BORROWED"
  });
  await db.updateBook(book.id, { status: "BORROWED" });

  return send(res, 201, {
    message: "Book borrowed successfully",
    borrowingId: record.id,
    studentId,
    bookId,
    issueDate: record.issueDate,
    dueDate: record.dueDate,
    status: "BORROWED"
  });
}

async function returnBook(req, res) {
  const body = readJsonBody(req) ?? {};
  const bookId = normalizeText(body.bookId, 36);
  if (!bookId) return send(res, 400, { error: "bookId is required" });

  const records = await db.listBorrowingsForBook(bookId);
  const active = records.find((record) => record.status === "BORROWED");
  const book = await db.findBookById(bookId);
  if (!book) return send(res, 404, { error: "Book not registered" });
  if (!active) {
    return send(res, 404, { error: "No active borrowing record for this book" });
  }

  const returnDate = new Date().toISOString();
  await db.updateBorrowRecord(active.id, { returnDate, status: "RETURNED" });
  await db.updateBook(book.id, { status: "AVAILABLE" });

  return send(res, 200, { message: "Book returned successfully", bookId, returnDate });
}

async function deleteBorrowing(req, res, id) {
  const record = await db.findBorrowById(id);
  await db.deleteBorrowRecord(id);
  if (record.status === "BORROWED") {
    const book = await db.findBookById(record.bookId);
    if (book) await db.updateBook(book.id, { status: "AVAILABLE" });
  }
  return send(res, 200, { message: "Borrowing record deleted successfully" });
}

async function scan(req, res) {
  const body = readJsonBody(req) ?? {};
  const result = await findTagByUid(body.uid);
  if (result.error) return send(res, result.status, { error: result.error });
  return send(res, 200, result);
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
  } catch (error) {
    return sendDatabaseError(res, error);
  }

  return send(res, 404, { error: `No route for ${key}` });
}
