import 'dotenv/config';

const base = () => {
  const url = process.env.GEOSERVER_URL;
  if (!url) throw new Error('GEOSERVER_URL is not set');
  return `${url.replace(/\/$/, '')}/rest`;
};

function authHeader(): string {
  const user = process.env.GEOSERVER_ADMIN_USER ?? 'admin';
  const pass = process.env.GEOSERVER_ADMIN_PASSWORD ?? '';
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

export async function gsRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<Response> {
  return fetch(`${base()}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** true if a GET on the path returns 200 (resource exists) */
export async function gsExists(path: string): Promise<boolean> {
  const res = await gsRequest('GET', path);
  return res.status === 200;
}
