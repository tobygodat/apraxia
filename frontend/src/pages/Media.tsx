import Books from "./Books";
import Movies from "./Movies";

export default function Media() {
  return (
    <section className="collection-page" aria-labelledby="media-heading">
      <header className="collection-page__header">
        <h1 id="media-heading">Media</h1>
        <p>Books and movies now share one collection.</p>
      </header>
      <div className="collection-page__groups">
        <Books />
        <Movies />
      </div>
    </section>
  );
}
