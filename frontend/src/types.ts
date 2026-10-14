// Row shapes returned by the API (mirror db/schema.sql, spec §3).

export interface Todo {
  id: number;
  text: string;
  done: number;
  due: string | null;
  source: string;
  source_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface Writing {
  id: number;
  title: string | null;
  body: string;
  tags: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}
