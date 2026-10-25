import { Link, useParams } from 'react-router-dom';

/** Placeholder: Task 4 replaces this with the layer page. */
export default function LayerPage() {
  const { key } = useParams();
  return (
    <div className="quan-ly-route">
      <p>{key}</p>
      <Link className="link" to="/du-lieu">Về danh sách</Link>
    </div>
  );
}
