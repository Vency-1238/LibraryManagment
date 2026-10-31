/*
 * Borrowing history helpers.
 *
 * The database keeps one Borrow document per book (and per loan cycle). The
 * dashboard groups those flat records by student for display only — no record
 * is merged, deleted or written differently. Each individual record remains
 * addressable by its own document ID, which is what Return uses.
 */

export function isOverdue(dueDate, status) {
  return status === "BORROWED" && Boolean(dueDate) && new Date(dueDate) < new Date();
}

function timeValue(value) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function newestFirst(a, b) {
  return timeValue(b.issueDate || b.$createdAt) - timeValue(a.issueDate || a.$createdAt)
    || String(b.$id || b.id || "").localeCompare(String(a.$id || a.id || ""));
}

/**
 * Group flat Borrow records by studentId.
 *
 * Returns one entry per student:
 *   {
 *     studentId, studentName, records, bookGroups, counts,
 *     latestIssueDate
 *   }
 *
 * - `records` keeps every individual Borrow document (newest first).
 * - `bookGroups` collapses repeat loans of the same bookId into one display
 *   entry, so a title is never shown twice, while `records` inside that entry
 *   still holds every loan cycle.
 * - `counts.borrowed`, `counts.returned` and `counts.overdue` are record
 *   counts (OVERDUE is the active-loan subset, matching the rest of the app).
 * - Students without borrowing records simply produce no group; they are not
 *   invented or hardcoded.
 */
export function groupBorrowingsByStudent(records, students = [], books = []) {
  const studentMap = new Map((students || []).map((student) => [student.studentId, student]));
  const bookMap = new Map((books || []).map((book) => [book.bookId, book]));
  const groups = new Map();

  for (const record of records || []) {
    if (!record || !record.studentId) continue;

    if (!groups.has(record.studentId)) {
      groups.set(record.studentId, {
        studentId: record.studentId,
        studentName: studentMap.get(record.studentId)?.name || record.studentId,
        records: [],
      });
    }
    groups.get(record.studentId).records.push(record);
  }

  return [...groups.values()]
    .map((group) => {
      const groupRecords = [...group.records].sort(newestFirst);

      /* Collapse repeat loans of the same book into one display entry. */
      const bookEntries = new Map();
      for (const record of groupRecords) {
        const key = record.bookId || record.$id || record.id;
        if (!bookEntries.has(key)) {
          bookEntries.set(key, {
            bookId: record.bookId,
            title: bookMap.get(record.bookId)?.title || record.bookId || "Unknown book",
            records: [],
          });
        }
        bookEntries.get(key).records.push(record);
      }

      const bookGroups = [...bookEntries.values()]
        .map((book) => {
          const activeRecord = book.records.find((record) => record.status === "BORROWED") || null;
          const latestRecord = book.records[0];
          const focusRecord = activeRecord || latestRecord;

          return {
            ...book,
            latestRecord,
            activeRecord,
            focusRecord,
            status: activeRecord ? "BORROWED" : latestRecord.status || "UNKNOWN",
            overdue: Boolean(activeRecord && isOverdue(activeRecord.dueDate, activeRecord.status)),
            cycleCount: book.records.length,
          };
        })
        /* Overdue and currently borrowed books first, then newest loan first. */
        .sort((a, b) => (
          Number(b.overdue) - Number(a.overdue)
          || Number(Boolean(b.activeRecord)) - Number(Boolean(a.activeRecord))
          || newestFirst(a.latestRecord, b.latestRecord)
        ));

      const counts = {
        total: groupRecords.length,
        books: bookGroups.length,
        borrowed: groupRecords.filter((record) => record.status === "BORROWED").length,
        returned: groupRecords.filter((record) => record.status === "RETURNED").length,
        overdue: groupRecords.filter((record) => isOverdue(record.dueDate, record.status)).length,
      };

      return {
        ...group,
        records: groupRecords,
        bookGroups,
        counts,
        latestIssueDate: groupRecords[0]?.issueDate || groupRecords[0]?.$createdAt || null,
      };
    })
    /* Most recent borrowing activity first, preserving the old record order. */
    .sort((a, b) => (
      timeValue(b.latestIssueDate) - timeValue(a.latestIssueDate)
      || a.studentId.localeCompare(b.studentId)
    ));
}
