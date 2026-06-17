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

export interface Book {
  id: number;
  title: string;
  author: string | null;
  status: string;
  rating: number | null;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface Movie {
  id: number;
  title: string;
  year: number | null;
  status: string;
  rating: number | null;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface Draft {
  id: number;
  kind: string;
  prompt: string;
  body: string;
  status: string;
  related_todo: number | null;
  created_at: string;
}
