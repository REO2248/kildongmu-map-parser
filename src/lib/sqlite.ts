import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

let pending: Promise<SqlJsStatic> | undefined;

export function loadSqlJs(): Promise<SqlJsStatic> {
  pending ??= initSqlJs({ locateFile: (file) => `${import.meta.env.BASE_URL}${file}` });
  return pending;
}

export type { Database };
