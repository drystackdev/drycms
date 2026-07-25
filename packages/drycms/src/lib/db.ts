import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Driver adapter — normalizes 4 supported SQLite instance shapes into 1 async
// interface. D1 is detected via `.batch` (unique to it); the other 3 drivers
// (better-sqlite3 / bun:sqlite / node:sqlite) share a compatible sync surface
// by design, so they're handled as a single branch.
// ---------------------------------------------------------------------------

export interface D1LikeStatement {
  bind(...values: unknown[]): D1LikeStatement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<{ meta?: { last_row_id?: number } }>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}

export interface D1LikeDatabase {
  prepare(query: string): D1LikeStatement;
  batch(statements: D1LikeStatement[]): Promise<unknown[]>;
}

export interface SyncStatement {
  run(...params: unknown[]): { lastInsertRowid?: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SyncDatabase {
  prepare(query: string): SyncStatement;
}

export type SupportedInstance = D1LikeDatabase | SyncDatabase;

type SqlRow = Record<string, unknown>;

interface AsyncDriver {
  run(sql: string, params: unknown[]): Promise<{ lastInsertRowid?: number | bigint }>;
  get(sql: string, params: unknown[]): Promise<SqlRow | undefined>;
  all(sql: string, params: unknown[]): Promise<SqlRow[]>;
}

function isD1Like(instance: SupportedInstance): instance is D1LikeDatabase {
  const candidate = instance as Partial<D1LikeDatabase>;
  return typeof candidate.batch === "function" && typeof candidate.prepare === "function";
}

function wrapDriver(instance: SupportedInstance): AsyncDriver {
  if (isD1Like(instance)) {
    const d1 = instance;
    return {
      async run(sql, params) {
        const res = await d1.prepare(sql).bind(...params).run();
        return { lastInsertRowid: res?.meta?.last_row_id };
      },
      async get(sql, params) {
        const row = await d1.prepare(sql).bind(...params).first<SqlRow>();
        return row ?? undefined;
      },
      async all(sql, params) {
        const res = await d1.prepare(sql).bind(...params).all<SqlRow>();
        return res.results;
      },
    };
  }
  const sync = instance as SyncDatabase;
  return {
    async run(sql, params) {
      const res = sync.prepare(sql).run(...params);
      return { lastInsertRowid: res?.lastInsertRowid };
    },
    async get(sql, params) {
      return sync.prepare(sql).get(...params) as SqlRow | undefined;
    },
    async all(sql, params) {
      return sync.prepare(sql).all(...params) as SqlRow[];
    },
  };
}

function autoDetectDatabase(filePath: string): SyncDatabase {
  const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
  const req = createRequire(import.meta.url);
  if (isBun) {
    const { Database } = req("bun:sqlite") as { Database: new (path: string) => SyncDatabase };
    return new Database(filePath);
  }
  try {
    const { DatabaseSync } = req("node:sqlite") as { DatabaseSync: new (path: string) => SyncDatabase };
    return new DatabaseSync(filePath);
  } catch {
    throw new Error(
      "createDB(): không tìm thấy SQLite driver khả dụng. Hãy truyền vào 1 trong: " +
        "D1Database (env.DB), better-sqlite3 instance, bun:sqlite Database, hoặc node:sqlite DatabaseSync.",
    );
  }
}

// ---------------------------------------------------------------------------
// Column builder
// ---------------------------------------------------------------------------

type SqlType = "TEXT" | "INTEGER" | "REAL";
type ColumnKind = "text" | "int" | "number" | "bool" | "date" | "json" | "password" | "ref";

interface ColumnMeta {
  sqlType: SqlType;
  kind: ColumnKind;
  required: boolean;
  unique: boolean;
  index: boolean;
  default?: unknown;
  jsonSchema: Record<string, unknown>;
  refTable?: string;
}

export class Column<T, Req extends boolean = false, RefCols extends ColumnMap | undefined = undefined> {
  readonly _meta: ColumnMeta;
  declare readonly _type: T;
  declare readonly _required: Req;
  declare readonly _refCols: RefCols;

  constructor(meta: ColumnMeta) {
    this._meta = meta;
  }

  REQUIRED(): Column<T, true, RefCols> {
    this._meta.required = true;
    return this as unknown as Column<T, true, RefCols>;
  }

  UNIQUE(): this {
    this._meta.unique = true;
    this._meta.index = true;
    return this;
  }

  INDEX(): this {
    this._meta.index = true;
    return this;
  }

  DEFAULT(value: T): this {
    this._meta.default = value;
    return this;
  }
}

/**
 * Subclass riêng chỉ để đánh dấu "đây là cột PASSWORD" ở tầng type (cho
 * `Model<Cols>` biết bảng nào cần gắn `verifyPassword` vào row trả về) mà
 * không phải sửa lại mọi chỗ đang check `Column<any, any, any>` sẵn có.
 */
export class PasswordColumn<Req extends boolean = false> extends Column<string, Req, undefined> {
  override REQUIRED(): PasswordColumn<true> {
    this._meta.required = true;
    return this as unknown as PasswordColumn<true>;
  }
}

export class RelationRefs<TargetCols extends ColumnMap = ColumnMap> {
  declare readonly _targetCols: TargetCols;
  constructor(public readonly targetTable: string) {}
}

export type ColumnMap = Record<string, Column<any, any, any> | RelationRefs<any>>;

type ScalarKeys<Cols extends ColumnMap> = {
  [K in keyof Cols]: Cols[K] extends Column<any, any, any> ? K : never;
}[keyof Cols];

/** Field khai báo qua `db.REF(target)` — cột số thật + biết bảng đích để suy type quan hệ. */
type RefKeys<Cols extends ColumnMap> = {
  [K in keyof Cols]: Cols[K] extends Column<any, any, infer R> ? (R extends ColumnMap ? K : never) : never;
}[keyof Cols];

/** Field khai báo qua `db.REFS(target)` — không phải cột thật, chỉ dùng cho where/select quan hệ n-n. */
type RefsKeys<Cols extends ColumnMap> = {
  [K in keyof Cols]: Cols[K] extends RelationRefs<infer R> ? (R extends ColumnMap ? K : never) : never;
}[keyof Cols];

type TargetColsOf<Cols extends ColumnMap, K extends keyof Cols> = Cols[K] extends Column<any, any, infer R>
  ? R extends ColumnMap
    ? R
    : never
  : Cols[K] extends RelationRefs<infer R>
    ? R extends ColumnMap
      ? R
      : never
    : never;

type RequiredScalarKeys<Cols extends ColumnMap> = {
  [K in ScalarKeys<Cols>]: Cols[K] extends Column<any, infer Req, any> ? (Req extends true ? K : never) : never;
}[ScalarKeys<Cols>];

type OptionalScalarKeys<Cols extends ColumnMap> = Exclude<ScalarKeys<Cols>, RequiredScalarKeys<Cols>>;

export type InferRow<Cols extends ColumnMap> = {
  id: number;
  created_at: string;
  updated_at: string;
} & {
  [K in RequiredScalarKeys<Cols>]: Cols[K] extends Column<infer T, any, any> ? T : never;
} & {
  [K in OptionalScalarKeys<Cols>]: Cols[K] extends Column<infer T, any, any> ? T | null : never;
};

export type InferCreateInput<Cols extends ColumnMap> = {
  [K in RequiredScalarKeys<Cols>]: Cols[K] extends Column<infer T, any, any> ? T : never;
} & {
  [K in OptionalScalarKeys<Cols>]?: Cols[K] extends Column<infer T, any, any> ? T : never;
};

type PasswordKeys<Cols extends ColumnMap> = {
  [K in keyof Cols]: Cols[K] extends PasswordColumn<any> ? K : never;
}[keyof Cols];

type HasPassword<Cols extends ColumnMap> = [PasswordKeys<Cols>] extends [never] ? false : true;

/**
 * Row trả về từ `.get()/.creates()/.update()/.delete()`. Nếu bảng có cột
 * PASSWORD thì row có thêm `verifyPassword(plain)` gắn sẵn theo đúng id của
 * chính row đó — không cần truyền lại table/id.
 */
export type Model<Cols extends ColumnMap> = InferRow<Cols> &
  (HasPassword<Cols> extends true ? { verifyPassword(plain: string): Promise<boolean> } : {});

/** `type User = Infer<typeof userTable>` */
export type Infer<H> = H extends TableHandle<infer Cols> ? Model<Cols> : never;

interface TextOptions {
  min?: number;
  max?: number;
  format?: "email" | "url" | "uuid";
  regex?: string;
}

interface NumberOptions {
  min?: number;
  max?: number;
}

function buildTextSchema(opts: TextOptions): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: "string" };
  if (opts.min != null) schema.minLength = opts.min;
  if (opts.max != null) schema.maxLength = opts.max;
  if (opts.format) schema.format = opts.format;
  if (opts.regex) schema.pattern = opts.regex;
  return schema;
}

function buildNumberSchema(opts: NumberOptions, type: "integer" | "number"): Record<string, unknown> {
  const schema: Record<string, unknown> = { type };
  if (opts.min != null) schema.minimum = opts.min;
  if (opts.max != null) schema.maximum = opts.max;
  return schema;
}

interface ColumnFactories {
  TEXT(opts?: TextOptions): Column<string>;
  INT(opts?: NumberOptions): Column<number>;
  NUMBER(opts?: NumberOptions): Column<number>;
  BOOL(): Column<boolean>;
  DATE(): Column<string>;
  JSON<T = unknown>(): Column<T>;
  PASSWORD(): PasswordColumn;
  REF<Cols extends ColumnMap>(target: TableHandle<Cols>): Column<number, false, Cols>;
  REFS<Cols extends ColumnMap>(target: TableHandle<Cols>): RelationRefs<Cols>;
}

function makeColumnFactories(): ColumnFactories {
  return {
    TEXT(opts = {}) {
      return new Column<string>({
        sqlType: "TEXT",
        kind: "text",
        required: false,
        unique: false,
        index: false,
        jsonSchema: buildTextSchema(opts),
      });
    },
    INT(opts = {}) {
      return new Column<number>({
        sqlType: "INTEGER",
        kind: "int",
        required: false,
        unique: false,
        index: false,
        jsonSchema: buildNumberSchema(opts, "integer"),
      });
    },
    NUMBER(opts = {}) {
      return new Column<number>({
        sqlType: "REAL",
        kind: "number",
        required: false,
        unique: false,
        index: false,
        jsonSchema: buildNumberSchema(opts, "number"),
      });
    },
    BOOL() {
      return new Column<boolean>({
        sqlType: "INTEGER",
        kind: "bool",
        required: false,
        unique: false,
        index: false,
        jsonSchema: { type: "boolean" },
      });
    },
    DATE() {
      return new Column<string>({
        sqlType: "TEXT",
        kind: "date",
        required: false,
        unique: false,
        index: false,
        jsonSchema: { type: "string", format: "date-time" },
      });
    },
    JSON<T = unknown>() {
      return new Column<T>({
        sqlType: "TEXT",
        kind: "json",
        required: false,
        unique: false,
        index: false,
        jsonSchema: {},
      });
    },
    PASSWORD() {
      return new PasswordColumn({
        sqlType: "TEXT",
        kind: "password",
        required: false,
        unique: false,
        index: false,
        jsonSchema: { type: "string", minLength: 8 },
      });
    },
    REF(target) {
      return new Column<number, false, typeof target.columns>({
        sqlType: "INTEGER",
        kind: "ref",
        required: false,
        unique: false,
        index: true,
        jsonSchema: { type: "integer" },
        refTable: target.name,
      });
    },
    REFS(target) {
      return new RelationRefs<typeof target.columns>(target.name);
    },
  };
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

const RESERVED_COLUMNS = new Set(["id", "created_at", "updated_at"]);
const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertIdentifier(name: string): void {
  if (!IDENTIFIER_RE.test(name)) {
    throw new Error(`Tên "${name}" không hợp lệ, chỉ cho phép chữ/số/_ và không bắt đầu bằng số.`);
  }
}

interface JoinTableDef {
  name: string;
  columnA: string;
  columnB: string;
}

interface RelationManyDef {
  joinTable: string;
  targetTable: string;
}

export class TableHandle<Cols extends ColumnMap = ColumnMap> {
  readonly name: string;
  columns: Cols;
  readonly relationsMany = new Map<string, RelationManyDef>();
  private readonly joinTables: Map<string, JoinTableDef>;
  private readonly driver: AsyncDriver;
  private readonly tables: Map<string, TableHandle<any>>;

  constructor(
    name: string,
    columns: Cols,
    joinTables: Map<string, JoinTableDef>,
    driver: AsyncDriver,
    tables: Map<string, TableHandle<any>>,
  ) {
    assertIdentifier(name);
    this.name = name;
    this.columns = columns;
    this.joinTables = joinTables;
    this.driver = driver;
    this.tables = tables;
  }

  get jsonSchema(): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [name, col] of Object.entries(this.columns)) {
      if (col instanceof RelationRefs) continue;
      properties[name] = col._meta.jsonSchema;
      if (col._meta.required) required.push(name);
    }
    return { type: "object", properties, required };
  }

  /** Thêm cột vào bảng đã có. Bắt buộc `user = user.addColumn(...)` để lấy type mới. */
  addColumn<NewCols extends ColumnMap>(cols: NewCols): TableHandle<Cols & NewCols> {
    for (const [key, col] of Object.entries(cols)) {
      assertIdentifier(key);
      if (RESERVED_COLUMNS.has(key)) {
        throw new Error(`Cột "${key}" trùng tên với cột hệ thống (id/created_at/updated_at).`);
      }
      if (col instanceof RelationRefs) {
        const joinTable = `${this.name}_${col.targetTable}`;
        this.relationsMany.set(key, { joinTable, targetTable: col.targetTable });
        this.joinTables.set(joinTable, {
          name: joinTable,
          columnA: `${this.name}_id`,
          columnB: `${col.targetTable}_id`,
        });
        continue;
      }
      (this.columns as ColumnMap)[key] = col;
    }
    return this as unknown as TableHandle<Cols & NewCols>;
  }

  /** Xoá cột khỏi bảng. Bắt buộc `user = user.removeColumn(...)` để lấy type mới. */
  removeColumn<K extends keyof Cols>(...fields: K[]): TableHandle<Omit<Cols, K>> {
    for (const field of fields) {
      delete (this.columns as ColumnMap)[field as string];
      this.relationsMany.delete(field as string);
    }
    return this as unknown as TableHandle<Omit<Cols, K>>;
  }

  private query(): QueryBuilder<Cols> {
    return new QueryBuilder<Cols>(this.driver, this, this.tables);
  }

  where(cond: WhereInput<Cols>): QueryBuilder<Cols>;
  where<K extends ScalarKeys<Cols>>(
    field: K,
    value: Cols[K] extends Column<infer T, any, any> ? T : never,
  ): QueryBuilder<Cols>;
  where(condOrField: any, value?: unknown): QueryBuilder<Cols> {
    return (this.query().where as (a: any, b?: unknown) => QueryBuilder<Cols>)(condOrField, value);
  }

  select(shape: SelectInput<Cols>): QueryBuilder<Cols> {
    return this.query().select(shape);
  }

  sort(spec: SortInput<Cols>): QueryBuilder<Cols> {
    return this.query().sort(spec);
  }

  pagination(take: number, skip = 0): QueryBuilder<Cols> {
    return this.query().pagination(take, skip);
  }

  get(): Promise<Model<Cols>[]> {
    return this.query().get();
  }

  /** Không gọi `.where()` trước -> áp dụng cho TOÀN BỘ row (đúng ngữ nghĩa SQL UPDATE không WHERE). */
  update(data: Partial<InferRow<Cols>>): Promise<Model<Cols>[]> {
    return this.query().update(data);
  }

  /** Không gọi `.where()` trước -> xoá TOÀN BỘ row. */
  delete(): Promise<Model<Cols>[]> {
    return this.query().delete();
  }

  creates(data: InferCreateInput<Cols>): Promise<CreateResult<Model<Cols>, false>>;
  creates(data: InferCreateInput<Cols>[]): Promise<CreateResult<Model<Cols>, true>>;
  creates(data: any): Promise<CreateResult<Model<Cols>, boolean>> {
    return this.query().creates(data);
  }
}

// ---------------------------------------------------------------------------
// JSON Schema validation (minimal, no external dependency)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateAgainstSchema(schema: Record<string, unknown>, data: SqlRow): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const required = (schema.required as string[] | undefined) ?? [];
  const properties = (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {};

  for (const key of required) {
    const value = data[key];
    if (value === undefined || value === null || value === "") {
      (errors[key] ??= []).push(`${key} là bắt buộc`);
    }
  }

  for (const [key, propSchema] of Object.entries(properties)) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    if (propSchema.type === "string" && typeof value === "string") {
      const minLength = propSchema.minLength as number | undefined;
      const maxLength = propSchema.maxLength as number | undefined;
      const pattern = propSchema.pattern as string | undefined;
      if (minLength != null && value.length < minLength) {
        (errors[key] ??= []).push(`${key} phải có ít nhất ${minLength} ký tự`);
      }
      if (maxLength != null && value.length > maxLength) {
        (errors[key] ??= []).push(`${key} tối đa ${maxLength} ký tự`);
      }
      if (pattern && !new RegExp(pattern).test(value)) {
        (errors[key] ??= []).push(`${key} không đúng định dạng`);
      }
      if (propSchema.format === "email" && !EMAIL_RE.test(value)) {
        (errors[key] ??= []).push(`${key} không phải email hợp lệ`);
      }
    }
    if ((propSchema.type === "integer" || propSchema.type === "number") && typeof value === "number") {
      const minimum = propSchema.minimum as number | undefined;
      const maximum = propSchema.maximum as number | undefined;
      if (minimum != null && value < minimum) (errors[key] ??= []).push(`${key} phải >= ${minimum}`);
      if (maximum != null && value > maximum) (errors[key] ??= []).push(`${key} phải <= ${maximum}`);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Password hashing (PBKDF2 via Web Crypto — no external dependency)
// ---------------------------------------------------------------------------

const PBKDF2_ITERATIONS = 100_000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(plain), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

async function verifyPasswordHash(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = fromBase64(parts[2] as string);
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(plain), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return toBase64(new Uint8Array(bits)) === parts[3];
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

type WhereOperator = "equals" | "not" | "gt" | "gte" | "lt" | "lte" | "contains" | "startsWith" | "endsWith" | "in" | "notIn";
type WhereOperatorInput = Partial<Record<WhereOperator, unknown>>;

/** `q` bên trong callback quan hệ — where() được suy type theo đúng cột của bảng đích. */
export interface RelationQuery<TargetCols extends ColumnMap> {
  where(cond: WhereInput<TargetCols>): unknown;
}

type NonRefScalarKeys<Cols extends ColumnMap> = Exclude<ScalarKeys<Cols>, RefKeys<Cols>>;

type PlainWhereFields<Cols extends ColumnMap> = {
  [K in NonRefScalarKeys<Cols>]?: Cols[K] extends Column<infer T, any, any> ? T | WhereOperatorInput : never;
};

/** Field REF: vừa lọc theo giá trị số thật (id), vừa cho phép lọc theo bảng liên kết qua callback. */
type RefWhereFields<Cols extends ColumnMap> = {
  [K in RefKeys<Cols>]?: Cols[K] extends Column<infer T, any, any>
    ? T | WhereOperatorInput | ((q: RelationQuery<TargetColsOf<Cols, K>>) => unknown)
    : never;
};

/** Field REFS: không có cột thật, chỉ lọc được qua callback ("tồn tại ít nhất 1 bản ghi khớp"). */
type RefsWhereFields<Cols extends ColumnMap> = {
  [K in RefsKeys<Cols>]?: (q: RelationQuery<TargetColsOf<Cols, K>>) => unknown;
};

export type WhereInput<Cols extends ColumnMap> = {
  OR?: WhereInput<Cols>[];
  AND?: WhereInput<Cols>[];
  NOT?: WhereInput<Cols>;
} & PlainWhereFields<Cols> &
  RefWhereFields<Cols> &
  RefsWhereFields<Cols>;

interface SelectSpecObject {
  [key: string]: SelectSpec;
}
type SelectSpec = true | ((value: unknown) => unknown) | SelectSpecObject;

type PlainSelectFields<Cols extends ColumnMap> = {
  [K in NonRefScalarKeys<Cols>]?: Cols[K] extends Column<infer T, any, any> ? true | ((value: T) => unknown) : never;
};

/**
 * REF/REFS trong select() = include: `true` lấy toàn bộ cột của bảng đích,
 * object lồng chọn field cụ thể (không phải callback).
 */
type RelationSelectFields<Cols extends ColumnMap> = {
  [K in RefKeys<Cols> | RefsKeys<Cols>]?: true | SelectInput<TargetColsOf<Cols, K>>;
};

export type SelectInput<Cols extends ColumnMap> = PlainSelectFields<Cols> & RelationSelectFields<Cols>;

export type SortInput<Cols extends ColumnMap> = Partial<Record<NonRefScalarKeys<Cols> & string, "asc" | "desc">>;

export interface CreateResult<M, Arr extends boolean = boolean> {
  error?: Record<string, string[]>;
  success?: Arr extends true ? M[] : M;
}

interface CompileCtx {
  tables: Map<string, TableHandle<any>>;
}

function compileOperator(tableName: string, field: string, op: string, value: unknown, params: unknown[]): string {
  const col = `${tableName}.${field}`;
  switch (op) {
    case "equals":
      params.push(value);
      return `${col} = ?`;
    case "not":
      params.push(value);
      return `${col} != ?`;
    case "gt":
      params.push(value);
      return `${col} > ?`;
    case "gte":
      params.push(value);
      return `${col} >= ?`;
    case "lt":
      params.push(value);
      return `${col} < ?`;
    case "lte":
      params.push(value);
      return `${col} <= ?`;
    case "contains":
      params.push(`%${value}%`);
      return `${col} LIKE ?`;
    case "startsWith":
      params.push(`${value}%`);
      return `${col} LIKE ?`;
    case "endsWith":
      params.push(`%${value}`);
      return `${col} LIKE ?`;
    case "in": {
      const arr = value as unknown[];
      params.push(...arr);
      return `${col} IN (${arr.map(() => "?").join(", ")})`;
    }
    case "notIn": {
      const arr = value as unknown[];
      params.push(...arr);
      return `${col} NOT IN (${arr.map(() => "?").join(", ")})`;
    }
    default:
      throw new Error(`Operator "${op}" không được hỗ trợ.`);
  }
}

function compileWhere(table: TableHandle<any>, cond: Record<string, unknown> | undefined, ctx: CompileCtx): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of Object.entries(cond ?? {})) {
    if (key === "OR" || key === "AND") {
      const arr = value as Record<string, unknown>[];
      if (arr.length > 0) {
        const compiled = arr.map((c) => compileWhere(table, c, ctx));
        parts.push("(" + compiled.map((c) => c.sql).join(key === "OR" ? " OR " : " AND ") + ")");
        for (const c of compiled) params.push(...c.params);
      }
      continue;
    }
    if (key === "NOT") {
      const compiled = compileWhere(table, value as Record<string, unknown>, ctx);
      parts.push("NOT (" + compiled.sql + ")");
      params.push(...compiled.params);
      continue;
    }

    const col = table.columns[key];

    if (typeof value === "function") {
      const captured: { cond?: unknown } = {};
      (value as (q: { where(cond: unknown): unknown }) => unknown)({
        where(c: unknown) {
          captured.cond = c;
          return this;
        },
      });
      const nestedCond = (captured.cond as Record<string, unknown>) ?? {};

      if (col instanceof Column && col._meta.kind === "ref" && col._meta.refTable) {
        const target = ctx.tables.get(col._meta.refTable);
        if (!target) throw new Error(`Bảng "${col._meta.refTable}" chưa được khai báo.`);
        const compiled = compileWhere(target, nestedCond, ctx);
        parts.push(
          `EXISTS (SELECT 1 FROM ${col._meta.refTable} WHERE ${col._meta.refTable}.id = ${table.name}.${key} AND ${compiled.sql})`,
        );
        params.push(...compiled.params);
      } else if (table.relationsMany.has(key)) {
        const rel = table.relationsMany.get(key) as RelationManyDef;
        const target = ctx.tables.get(rel.targetTable);
        if (!target) throw new Error(`Bảng "${rel.targetTable}" chưa được khai báo.`);
        const compiled = compileWhere(target, nestedCond, ctx);
        parts.push(
          `EXISTS (SELECT 1 FROM ${rel.joinTable} JOIN ${rel.targetTable} ON ${rel.targetTable}.id = ${rel.joinTable}.${rel.targetTable}_id ` +
            `WHERE ${rel.joinTable}.${table.name}_id = ${table.name}.id AND ${compiled.sql})`,
        );
        params.push(...compiled.params);
      } else {
        throw new Error(`"${key}" không phải quan hệ REF/REFS, không thể dùng callback trong where.`);
      }
      continue;
    }

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [op, opVal] of Object.entries(value as Record<string, unknown>)) {
        parts.push(compileOperator(table.name, key, op, opVal, params));
      }
      continue;
    }

    parts.push(`${table.name}.${key} = ?`);
    params.push(value);
  }

  return { sql: parts.length ? parts.join(" AND ") : "1=1", params };
}

function buildOrderSql(table: TableHandle<any>, spec: Record<string, "asc" | "desc"> | undefined): string {
  const parts: string[] = [];
  if (spec) {
    for (const [field, dir] of Object.entries(spec)) {
      if (!field) continue;
      parts.push(`${table.name}.${field} ${dir === "desc" ? "DESC" : "ASC"}`);
    }
  }
  if (!parts.some((p) => p.startsWith(`${table.name}.updated_at`))) {
    parts.push(`${table.name}.updated_at DESC`);
  }
  return parts.length ? ` ORDER BY ${parts.join(", ")}` : "";
}

function stripSensitive(row: SqlRow, table: TableHandle<any>): SqlRow {
  const out: SqlRow = { ...row };
  for (const [name, col] of Object.entries(table.columns)) {
    if (col instanceof Column && col._meta.kind === "password") delete out[name];
  }
  return out;
}

/**
 * Nếu bảng có cột PASSWORD, gắn `verifyPassword(plain)` thẳng vào row trả về
 * (không enumerable - không lẫn vào JSON.stringify/spread), tra lại đúng hash
 * theo id của chính row này. Không có cột PASSWORD thì trả nguyên row.
 */
function attachVerifyPassword(row: SqlRow, id: unknown, table: TableHandle<any>, driver: AsyncDriver): SqlRow {
  const passwordEntry = Object.entries(table.columns).find(
    ([, c]) => c instanceof Column && c._meta.kind === "password",
  );
  if (!passwordEntry) return row;
  const [passwordField] = passwordEntry;
  Object.defineProperty(row, "verifyPassword", {
    enumerable: false,
    value: async (plain: string) => {
      const fresh = await driver.get(`SELECT ${passwordField} FROM ${table.name} WHERE id = ?`, [id]);
      if (!fresh) return false;
      return verifyPasswordHash(plain, String(fresh[passwordField]));
    },
  });
  return row;
}

async function applySelect(
  rows: SqlRow[],
  table: TableHandle<any>,
  shape: Record<string, SelectSpec> | undefined,
  ctx: CompileCtx,
  driver: AsyncDriver,
): Promise<SqlRow[]> {
  if (!shape) {
    return rows.map((r) => attachVerifyPassword(stripSensitive(r, table), r.id, table, driver));
  }

  const results: SqlRow[] = [];
  for (const row of rows) {
    const out: SqlRow = {};
    for (const [key, spec] of Object.entries(shape)) {
      if (table.relationsMany.has(key)) {
        const rel = table.relationsMany.get(key) as RelationManyDef;
        const target = ctx.tables.get(rel.targetTable);
        if (!target) throw new Error(`Bảng "${rel.targetTable}" chưa được khai báo.`);
        const related = await driver.all(
          `SELECT ${rel.targetTable}.* FROM ${rel.joinTable} JOIN ${rel.targetTable} ON ${rel.targetTable}.id = ${rel.joinTable}.${rel.targetTable}_id ` +
            `WHERE ${rel.joinTable}.${table.name}_id = ?`,
          [row.id],
        );
        const relSpec = spec === true ? undefined : (spec as Record<string, SelectSpec>);
        out[key] = await applySelect(related, target, relSpec, ctx, driver);
        continue;
      }

      const col = table.columns[key];
      if (col instanceof Column && col._meta.kind === "ref" && col._meta.refTable) {
        const target = ctx.tables.get(col._meta.refTable);
        if (!target) throw new Error(`Bảng "${col._meta.refTable}" chưa được khai báo.`);
        const relatedId = row[key];
        if (relatedId == null) {
          out[key] = null;
          continue;
        }
        const relatedRow = await driver.get(`SELECT * FROM ${col._meta.refTable} WHERE id = ?`, [relatedId]);
        const refSpec = spec === true ? undefined : (spec as Record<string, SelectSpec>);
        out[key] = relatedRow ? (await applySelect([relatedRow], target, refSpec, ctx, driver))[0] : null;
        continue;
      }

      if (spec === true) {
        out[key] = row[key];
        continue;
      }
      if (typeof spec === "function") {
        out[key] = spec(row[key]);
        continue;
      }
    }
    results.push(attachVerifyPassword(out, row.id, table, driver));
  }
  return results;
}

export class QueryBuilder<Cols extends ColumnMap = ColumnMap> {
  private cond: Record<string, unknown> | undefined;
  private selectShape: Record<string, SelectSpec> | undefined;
  private takeN: number | undefined;
  private skipN = 0;
  private sortSpec: Record<string, "asc" | "desc"> | undefined;

  constructor(
    private readonly driver: AsyncDriver,
    private readonly table: TableHandle<any>,
    private readonly tables: Map<string, TableHandle<any>>,
  ) {}

  where(cond: WhereInput<Cols>): this;
  where<K extends ScalarKeys<Cols>>(field: K, value: Cols[K] extends Column<infer T, any, any> ? T : never): this;
  where(condOrField: WhereInput<Cols> | ScalarKeys<Cols>, value?: unknown): this {
    this.cond =
      typeof condOrField === "object"
        ? (condOrField as Record<string, unknown>)
        : { [condOrField as string]: value };
    return this;
  }

  select(shape: SelectInput<Cols>): this {
    this.selectShape = shape as Record<string, SelectSpec>;
    return this;
  }

  pagination(take: number, skip = 0): this {
    this.takeN = take;
    this.skipN = skip;
    return this;
  }

  sort(spec: SortInput<Cols>): this {
    this.sortSpec = spec as Record<string, "asc" | "desc">;
    return this;
  }

  private ctx(): CompileCtx {
    return { tables: this.tables };
  }

  async get(): Promise<Model<Cols>[]> {
    const { sql: whereSql, params } = compileWhere(this.table, this.cond, this.ctx());
    const orderSql = buildOrderSql(this.table, this.sortSpec);
    const limitSql = this.takeN != null ? ` LIMIT ${this.takeN} OFFSET ${this.skipN}` : "";
    const sql = `SELECT * FROM ${this.table.name} WHERE ${whereSql}${orderSql}${limitSql}`;
    const rows = await this.driver.all(sql, params);
    return (await applySelect(rows, this.table, this.selectShape, this.ctx(), this.driver)) as Model<Cols>[];
  }

  async creates(data: InferCreateInput<Cols>): Promise<CreateResult<Model<Cols>, false>>;
  async creates(data: InferCreateInput<Cols>[]): Promise<CreateResult<Model<Cols>, true>>;
  async creates(
    data: InferCreateInput<Cols> | InferCreateInput<Cols>[],
  ): Promise<CreateResult<Model<Cols>, boolean>> {
    const isArray = Array.isArray(data);
    const items: SqlRow[] = (isArray ? data : [data]) as SqlRow[];
    const errors: Record<string, string[]> = {};
    const prepared: SqlRow[] = [];

    for (const item of items) {
      const itemErrors = validateAgainstSchema(this.table.jsonSchema, item);
      for (const [k, v] of Object.entries(itemErrors)) (errors[k] ??= []).push(...v);

      const clean: SqlRow = { ...item };
      for (const [name, col] of Object.entries(this.table.columns)) {
        if (!(col instanceof Column)) continue;
        if (clean[name] === undefined && col._meta.default !== undefined) {
          clean[name] = col._meta.default;
        }
        if (col._meta.unique && clean[name] !== undefined) {
          const existing = await this.driver.get(`SELECT id FROM ${this.table.name} WHERE ${name} = ?`, [clean[name]]);
          if (existing) (errors[name] ??= []).push(`${name} đã tồn tại`);
        }
        if (col._meta.kind === "password" && typeof clean[name] === "string") {
          clean[name] = await hashPassword(clean[name] as string);
        }
      }
      prepared.push(clean);
    }

    if (Object.keys(errors).length > 0) return { error: errors };

    const now = new Date().toISOString();
    const created: SqlRow[] = [];
    for (const item of prepared) {
      const columnNames = Object.keys(this.table.columns).filter(
        (n) => this.table.columns[n] instanceof Column && item[n] !== undefined,
      );
      const placeholders = columnNames.map(() => "?").join(", ");
      const values = columnNames.map((n) => item[n]);
      const allNames = [...columnNames, "created_at", "updated_at"];
      const sql = `INSERT INTO ${this.table.name} (${allNames.join(", ")}) VALUES (${placeholders}${placeholders ? ", " : ""}?, ?)`;
      const res = await this.driver.run(sql, [...values, now, now]);
      const id = Number(res.lastInsertRowid);
      const row = await this.driver.get(`SELECT * FROM ${this.table.name} WHERE id = ?`, [id]);
      if (row) created.push(row);
    }

    const output = await applySelect(created, this.table, undefined, this.ctx(), this.driver);
    return { success: (isArray ? output : output[0]) as Model<Cols> | Model<Cols>[] };
  }

  async update(data: Partial<InferRow<Cols>>): Promise<Model<Cols>[]> {
    const { sql: whereSql, params } = compileWhere(this.table, this.cond, this.ctx());
    const rows = await this.driver.all(`SELECT * FROM ${this.table.name} WHERE ${whereSql}`, params);
    const now = new Date().toISOString();
    const updated: SqlRow[] = [];

    for (const row of rows) {
      const clean: SqlRow = { ...(data as SqlRow) };
      const passwordCol = Object.entries(this.table.columns).find(
        ([, c]) => c instanceof Column && c._meta.kind === "password",
      );
      if (passwordCol) {
        const [passwordField] = passwordCol;
        if (typeof clean[passwordField] === "string") {
          clean[passwordField] = await hashPassword(clean[passwordField] as string);
        }
      }
      const setNames = Object.keys(clean).filter((n) => this.table.columns[n] instanceof Column);
      if (setNames.length > 0) {
        const setSql = setNames.map((n) => `${n} = ?`).join(", ");
        await this.driver.run(`UPDATE ${this.table.name} SET ${setSql}, updated_at = ? WHERE id = ?`, [
          ...setNames.map((n) => clean[n]),
          now,
          row.id,
        ]);
      }
      const fresh = await this.driver.get(`SELECT * FROM ${this.table.name} WHERE id = ?`, [row.id]);
      if (fresh) updated.push(fresh);
    }

    return (await applySelect(updated, this.table, undefined, this.ctx(), this.driver)) as Model<Cols>[];
  }

  async delete(): Promise<Model<Cols>[]> {
    const { sql: whereSql, params } = compileWhere(this.table, this.cond, this.ctx());
    const rows = await this.driver.all(`SELECT * FROM ${this.table.name} WHERE ${whereSql}`, params);
    for (const row of rows) {
      await this.driver.run(`DELETE FROM ${this.table.name} WHERE id = ?`, [row.id]);
    }
    return (await applySelect(rows, this.table, undefined, this.ctx(), this.driver)) as Model<Cols>[];
  }
}

// ---------------------------------------------------------------------------
// Migration diff (generates .sql files — never applies to the live DB)
// ---------------------------------------------------------------------------

function buildCreateTableSql(table: TableHandle<any>): string {
  const lines = ["id INTEGER PRIMARY KEY AUTOINCREMENT", "created_at TEXT", "updated_at TEXT"];
  for (const [name, col] of Object.entries(table.columns)) {
    if (col instanceof Column) lines.push(`${name} ${col._meta.sqlType}`);
  }
  return `CREATE TABLE ${table.name} (\n  ${lines.join(",\n  ")}\n);`;
}

function buildJoinTableCreateSql(join: JoinTableDef): string {
  return `CREATE TABLE ${join.name} (\n  ${join.columnA} INTEGER,\n  ${join.columnB} INTEGER\n);`;
}

function buildIndexSql(tableName: string, column: string): string {
  return `CREATE INDEX idx_${tableName}_${column} ON ${tableName}(${column});`;
}

export interface MigrationResult {
  file: string | null;
  statements: string[];
}

async function computeMigrationStatements(
  driver: AsyncDriver,
  tables: Map<string, TableHandle<any>>,
  joinTables: Map<string, JoinTableDef>,
): Promise<string[]> {
  const statements: string[] = [];

  for (const table of tables.values()) {
    const liveCols = await driver.all(`PRAGMA table_info(${table.name})`, []);
    if (liveCols.length === 0) {
      statements.push(buildCreateTableSql(table));
      for (const [name, col] of Object.entries(table.columns)) {
        if (col instanceof Column && col._meta.index) statements.push(buildIndexSql(table.name, name));
      }
      continue;
    }

    const liveNames = new Set(liveCols.map((c) => String(c.name)));
    const desiredNames = new Set(["id", "created_at", "updated_at", ...Object.keys(table.columns)]);

    for (const [name, col] of Object.entries(table.columns)) {
      if (col instanceof Column && !liveNames.has(name)) {
        statements.push(`ALTER TABLE ${table.name} ADD COLUMN ${name} ${col._meta.sqlType};`);
      }
    }
    for (const liveName of liveNames) {
      if (!desiredNames.has(liveName)) {
        statements.push(`ALTER TABLE ${table.name} DROP COLUMN ${liveName};`);
      }
    }

    const liveIndexes = await driver.all(`PRAGMA index_list(${table.name})`, []);
    const liveIndexNames = new Set(liveIndexes.map((i) => String(i.name)));
    for (const [name, col] of Object.entries(table.columns)) {
      if (!(col instanceof Column) || !col._meta.index) continue;
      const idxName = `idx_${table.name}_${name}`;
      if (!liveIndexNames.has(idxName)) statements.push(buildIndexSql(table.name, name));
    }
  }

  for (const join of joinTables.values()) {
    const liveCols = await driver.all(`PRAGMA table_info(${join.name})`, []);
    if (liveCols.length === 0) statements.push(buildJoinTableCreateSql(join));
  }

  return statements;
}

async function migrateAndWrite(
  driver: AsyncDriver,
  tables: Map<string, TableHandle<any>>,
  joinTables: Map<string, JoinTableDef>,
): Promise<MigrationResult> {
  const statements = await computeMigrationStatements(driver, tables, joinTables);
  if (statements.length === 0) return { file: null, statements: [] };

  const dir = path.join(process.cwd(), "migrations");
  fs.mkdirSync(dir, { recursive: true });
  const existing = fs.readdirSync(dir).filter((f) => /^\d{4}_/.test(f));
  const next = String(existing.length + 1).padStart(4, "0");
  const file = path.join(dir, `${next}_migration.sql`);
  fs.writeFileSync(file, statements.join("\n\n") + "\n");
  return { file, statements };
}

// ---------------------------------------------------------------------------
// createDB()
// ---------------------------------------------------------------------------

export interface DB extends ColumnFactories {
  table<Cols extends ColumnMap>(name: string, columns: Cols): TableHandle<Cols>;
  table(name: string): TableHandle<any>;
  migrate(): Promise<MigrationResult>;
}

export function createDB(instance?: SupportedInstance): DB {
  const driver = wrapDriver(instance ?? autoDetectDatabase(path.join(process.cwd(), "db.sqlite")));
  const tables = new Map<string, TableHandle<any>>();
  const joinTables = new Map<string, JoinTableDef>();
  const factories = makeColumnFactories();

  function table(name: string, columns?: ColumnMap): TableHandle<any> {
    if (columns) {
      assertIdentifier(name);
      if (tables.has(name)) throw new Error(`Bảng "${name}" đã được khai báo.`);
      for (const key of Object.keys(columns)) {
        if (RESERVED_COLUMNS.has(key)) throw new Error(`Cột "${key}" trùng tên với cột hệ thống.`);
      }
      const t = new TableHandle(name, columns, joinTables, driver, tables);
      tables.set(name, t);
      return t;
    }
    const existing = tables.get(name);
    if (!existing) throw new Error(`Bảng "${name}" chưa được khai báo, cần truyền columns lần đầu.`);
    return existing;
  }

  return {
    ...factories,
    table: table as DB["table"],
    migrate() {
      return migrateAndWrite(driver, tables, joinTables);
    },
  };
}
