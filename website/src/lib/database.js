import { databases, DB_ID, S_COL, B_COL, BOR_COL, SCAN_COL, ID, Query } from "./appwrite.js";

export const MAX_ACTIVE_BOOKS = 4;

async function listAll(colId, queries = []) {
  const docs = [];
  let offset = 0;
  for (;;) {
    const page = await databases.listDocuments(DB_ID, colId, [
      ...queries,
      Query.limit(100),
      Query.offset(offset),
    ]);
    docs.push(...page.documents);
    if (docs.length >= page.total || page.documents.length === 0) {
      return colId === B_COL ? docs.map(normalizeBook) : docs;
    }
    offset += page.documents.length;
  }
}

/* The books collection may declare loanPeriod as an integer or a string
   attribute, depending on how it was created. Reads are coerced to a
   number, and writes fall back to a string when the schema needs it. */
function normalizeBook(doc) {
  return { ...doc, loanPeriod: Number(doc.loanPeriod) };
}

function isLoanPeriodTypeError(err) {
  const msg = String(err?.message ?? "");
  return /loanPeriod/i.test(msg) && /invalid type/i.test(msg);
}

async function createBookDocument(data) {
  const payload = { ...data, loanPeriod: Number(data.loanPeriod) };
  try {
    return await databases.createDocument(DB_ID, B_COL, ID.unique(), payload);
  } catch (err) {
    if (!isLoanPeriodTypeError(err)) throw err;
    return databases.createDocument(DB_ID, B_COL, ID.unique(), {
      ...data,
      loanPeriod: String(data.loanPeriod),
    });
  }
}


export const db = {
  /* ─── Students ──────────────────────────────────── */
  getStudents: () => listAll(S_COL),

  async findStudentByStudentId(studentId) {
    return (await listAll(S_COL, [Query.equal("studentId", studentId)]))[0] ?? null;
  },
  async findStudentByUid(rfidUID) {
    return (await listAll(S_COL, [Query.equal("rfidUID", rfidUID)]))[0] ?? null;
  },
  addStudent: (data) =>
    databases.createDocument(DB_ID, S_COL, ID.unique(), {
      status: "ACTIVE",
      ...data,
    }),
  updateStudent: (docId, data) =>
    databases.updateDocument(DB_ID, S_COL, docId, data),
  deleteStudent: (docId) =>
    databases.deleteDocument(DB_ID, S_COL, docId),

  getActiveBorrowingsForStudent: (studentId) =>
    listAll(BOR_COL, [
      Query.equal("studentId", studentId),
      Query.equal("status", "BORROWED"),
    ]),

  getBorrowingsForStudent: (studentId) =>
    listAll(BOR_COL, [
      Query.equal("studentId", studentId),
      Query.orderDesc("issueDate"),
    ]),

  /* ─── Books ─────────────────────────────────────── */
  getBooks: () => listAll(B_COL),

  async findBookByBookId(bookId) {
    return (await listAll(B_COL, [Query.equal("bookId", bookId)]))[0] ?? null;
  },
  async findBookByUid(rfidUID) {
    return (await listAll(B_COL, [Query.equal("rfidUID", rfidUID)]))[0] ?? null;
  },
  addBook: (data) => createBookDocument(data),
  updateBook: (docId, data) =>
    databases.updateDocument(DB_ID, B_COL, docId, data),
  deleteBook: (docId) =>
    databases.deleteDocument(DB_ID, B_COL, docId),

  getBorrowingsForBook: (bookId) =>
    listAll(BOR_COL, [Query.equal("bookId", bookId)]),

  getActiveBorrowingsForBook: (bookId) =>
    listAll(BOR_COL, [
      Query.equal("bookId", bookId),
      Query.equal("status", "BORROWED"),
    ]),

  /* ─── Borrowings ────────────────────────────────── */
  getBorrowings: () => listAll(BOR_COL, [Query.orderDesc("issueDate")]),

  addBorrowing: (data) =>
    databases.createDocument(DB_ID, BOR_COL, ID.unique(), data),
  updateBorrowing: (docId, data) =>
    databases.updateDocument(DB_ID, BOR_COL, docId, data),

  /* ─── ScanLogs (optional collection) ────────────── */
  getScanLogs: () => SCAN_COL ? listAll(SCAN_COL) : Promise.resolve([]),
};
