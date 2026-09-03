export default function Projects() {
  return (
    <section className="collection-page" aria-labelledby="projects-heading">
      <header className="collection-page__header">
        <h1 id="projects-heading">Projects</h1>
        <p>Ongoing outcomes and their related tasks will live here.</p>
      </header>
      <div className="collection-empty">
        <p>No projects yet.</p>
        <span>Project records become writable with the Supabase data layer.</span>
      </div>
    </section>
  );
}
