import { Client, Databases, ID, Query } from "node-appwrite";

/*
 * Appwrite access layer for the Vercel serverless API.
 *
 * Environment (set in Vercel → Project → Settings → Environment Variables):
 *   VITE_APPWRITE_ENDPOINT / APPWRITE_ENDPOINT
 *   VITE_APPWRITE_PROJECT_ID / APPWRITE_PROJECT_ID
 *   VITE_APPWRITE_DATABASE_ID / APPWRITE_DATABASE_ID
 *   VITE_APPWRITE_STUDENTS_COLLECTION_ID / APPWRITE_STUDENTS_COLLECTION_ID
 *   VITE_APPWRITE_BOOKS_COLLECTION_ID / APPWRITE_BOOKS_COLLECTION_ID
 *   VITE_APPWRITE_BORROW_COLLECTION_ID / APPWRITE_BORROW_COLLECTION_ID
 *   APPWRITE_API_KEY (optional)
 *
 * If APPWRITE_API_KEY exists it is used first; when it lacks a scope Appwrite
 * answers 401 and the call is retried anonymously (collections allow public
 * access), so the API works with or without correctly scoped credentials.
 */
const ENV_MAP = {
  endpoint: ["APPWRITE_ENDPOINT", "VITE_APPWRITE_ENDPOINT"],
  projectId: ["APPWRITE_PROJECT_ID", "VITE_APPWRITE_PROJECT_ID"],
  databaseId: ["APPWRITE_DATABASE_ID", "VITE_APPWRITE_DATABASE_ID"],
  studentsCollectionId: [
    "APPWRITE_STUDENTS_COLLECTION_ID",
    "VITE_APPWRITE_STUDENTS_COLLECTION_ID"
  ],
  booksCollectionId: [
    "APPWRITE_BOOKS_COLLECTION_ID",
    "VITE_APPWRITE_BOOKS_COLLECTION_ID"
  ],
  borrowCollectionId: [
    "APPWRITE_BORROW_COLLECTION_ID",
    "VITE_APPWRITE_BORROW_COLLECTION_ID"
  ]
};

function readEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

function readConfig() {
  const config = {};
  const missing = [];

  for (const [key, names] of Object.entries(ENV_MAP)) {
    const value = readEnv(names);
    if (!value) missing.push(names[0]);
    config[key] = value;
  }

  config.apiKey = readEnv(["APPWRITE_API_KEY"]);
  return { ...config, missing };
}

function documentData(document) {
  return { ...document, id: document.$id };
}

/* The books collection may declare loanPeriod as an integer or a string
   attribute. Reads are coerced to a number so due-date math always works. */
function bookData(document) {
  return { ...documentData(document), loanPeriod: Number(document.loanPeriod) };
}

function isLoanPeriodTypeError(error) {
  const message = String(error?.message ?? "");
  return /loanPeriod/i.test(message) && /invalid type/i.test(message);
}

function isScopeError(error) {
  return error?.code === 401 || error?.type === "general_unauthorized_scope";
}

const config = readConfig();
const configured = config.missing.length === 0;

function buildDatabases(key) {
  if (!configured) return null;
  const client = new Client()
    .setEndpoint(config.endpoint)
    .setProject(config.projectId);
  if (key) client.setKey(key);
  return new Databases(client);
}

const keyed = buildDatabases(config.apiKey);
const anonymous = buildDatabases();

export const authMode = keyed ? "api-key" : "public";

function requireConfiguration() {
  if (!configured) {
    throw new Error(`Missing Appwrite environment variables: ${config.missing.join(", ")}`);
  }
}

async function call(operation) {
  requireConfiguration();
  if (keyed) {
    try {
      return await operation(keyed);
    } catch (error) {
      if (!isScopeError(error)) throw error;
      return operation(anonymous);
    }
  }
  return operation(anonymous);
}

async function listAll(collectionId, queries = [], mapper = documentData) {
  const documents = [];
  let offset = 0;

  while (true) {
    const page = await call((databases) => databases.listDocuments(
      config.databaseId,
      collectionId,
      [...queries, Query.limit(100), Query.offset(offset)]
    ));
    documents.push(...page.documents.map(mapper));
    if (documents.length >= page.total || page.documents.length === 0) {
      return documents;
    }
    offset += page.documents.length;
  }
}

async function findOne(collectionId, field, value, mapper = documentData) {
  const documents = await listAll(collectionId, [Query.equal(field, value)], mapper);
  return documents[0] || null;
}

export const appwriteConfig = { configured, authMode, databaseId: config.databaseId };

export async function checkConnection() {
  try {
    await listAll(config.studentsCollectionId, [Query.limit(1)]);
    return { connected: true, error: null };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

export const listStudents = () => listAll(config.studentsCollectionId);
export const listBooks = () => listAll(config.booksCollectionId, [], bookData);
export const listBorrowRecords = () =>
  listAll(config.borrowCollectionId, [Query.orderDesc("issueDate")]);

export const findStudentById = (studentId) =>
  findOne(config.studentsCollectionId, "studentId", studentId);
export const findStudentByUid = (rfidUID) =>
  findOne(config.studentsCollectionId, "rfidUID", rfidUID);
export const findBookById = (bookId) =>
  findOne(config.booksCollectionId, "bookId", bookId, bookData);
export const findBookByUid = (rfidUID) =>
  findOne(config.booksCollectionId, "rfidUID", rfidUID, bookData);

export async function findBorrowById(id) {
  const document = await call((databases) => databases.getDocument(
    config.databaseId,
    config.borrowCollectionId,
    id
  ));
  return documentData(document);
}

export const listActiveBorrowingsForStudent = (studentId) =>
  listAll(config.borrowCollectionId, [
    Query.equal("studentId", studentId),
    Query.equal("status", "BORROWED")
  ]);

export const listBorrowingsForBook = (bookId) =>
  listAll(config.borrowCollectionId, [Query.equal("bookId", bookId)]);

export async function createStudent(data) {
  return documentData(await call((databases) => databases.createDocument(
    config.databaseId,
    config.studentsCollectionId,
    ID.unique(),
    data
  )));
}

export async function createBook(data) {
  const payload = { ...data, loanPeriod: Number(data.loanPeriod) };
  try {
    return bookData(await call((databases) => databases.createDocument(
      config.databaseId,
      config.booksCollectionId,
      ID.unique(),
      payload
    )));
  } catch (error) {
    if (!isLoanPeriodTypeError(error)) throw error;
    return bookData(await call((databases) => databases.createDocument(
      config.databaseId,
      config.booksCollectionId,
      ID.unique(),
      { ...data, loanPeriod: String(data.loanPeriod) }
    )));
  }
}

export async function createBorrowRecord(data) {
  return documentData(await call((databases) => databases.createDocument(
    config.databaseId,
    config.borrowCollectionId,
    ID.unique(),
    data
  )));
}

export async function updateBook(documentId, data) {
  return bookData(await call((databases) => databases.updateDocument(
    config.databaseId,
    config.booksCollectionId,
    documentId,
    data
  )));
}

export async function updateBorrowRecord(documentId, data) {
  return documentData(await call((databases) => databases.updateDocument(
    config.databaseId,
    config.borrowCollectionId,
    documentId,
    data
  )));
}

export const deleteStudent = (documentId) =>
  call((databases) => databases.deleteDocument(
    config.databaseId,
    config.studentsCollectionId,
    documentId
  ));

export const deleteBook = (documentId) =>
  call((databases) => databases.deleteDocument(
    config.databaseId,
    config.booksCollectionId,
    documentId
  ));

export const deleteBorrowRecord = (documentId) =>
  call((databases) => databases.deleteDocument(
    config.databaseId,
    config.borrowCollectionId,
    documentId
  ));
