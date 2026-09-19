-- Written class notes: one markdown document per class, beside its PDFs.
-- Forward-only and defaulted, so every class that exists reads as a class with
-- nothing written in it yet. The bound matches the career notes fields.
alter table public.classes
  add column notes text not null default ''
    constraint classes_notes_bounded check (char_length(notes) <= 40000);

-- The browser writes the document straight from the field; `classes_rename`
-- already scopes an update to its owner and keeps a named class named, so a
-- recovered class with no name still has to be named before it takes notes.
grant update (notes) on public.classes to authenticated;
