import { Client, Databases, ID, Query } from "appwrite";

export const client = new Client()
  .setEndpoint(import.meta.env.VITE_APPWRITE_ENDPOINT || "https://fra.cloud.appwrite.io/v1")
  .setProject(import.meta.env.VITE_APPWRITE_PROJECT_ID);

export const databases = new Databases(client);
export { ID, Query };

export const DB_ID    = import.meta.env.VITE_APPWRITE_DATABASE_ID;
export const S_COL    = import.meta.env.VITE_APPWRITE_STUDENTS_COLLECTION_ID;
export const B_COL    = import.meta.env.VITE_APPWRITE_BOOKS_COLLECTION_ID;
export const BOR_COL  = import.meta.env.VITE_APPWRITE_BORROW_COLLECTION_ID;
