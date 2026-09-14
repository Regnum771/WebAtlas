/**
 * Client Overpass API tối giản, có thử lại và luân phiên máy chủ.
 *
 * Overpass công cộng hay quá tải — trong lúc khảo sát đã gặp lỗi
 * "Dispatcher_Client::request_read_and_idx::timeout" trên endpoint chính và
 * phải chuyển sang máy chủ dự phòng. Vì vậy mọi truy vấn đều phải chịu được
 * lỗi tạm thời.
 */

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * Chạy một truy vấn Overpass QL, trả về JSON đã parse.
 * Thử lần lượt từng endpoint, mỗi endpoint tối đa `attemptsPerEndpoint` lần.
 */
export async function overpassQuery(query, { attemptsPerEndpoint = 2 } = {}) {
  let lastError;
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 1; attempt <= attemptsPerEndpoint; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          body: query,
          headers: { 'Content-Type': 'text/plain', 'User-Agent': 'webatlas-osm-fetch' },
        });
        const text = await res.text();
        // Overpass trả HTML khi quá tải, dù mã HTTP là 200.
        if (!text.trimStart().startsWith('{')) {
          throw new Error(`phản hồi không phải JSON (máy chủ quá tải?): ${text.slice(0, 120)}`);
        }
        return JSON.parse(text);
      } catch (err) {
        lastError = err;
        const wait = attempt * 5000;
        console.warn(`  ! ${endpoint} lần ${attempt}: ${err.message.slice(0, 100)} — chờ ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw new Error(`Overpass thất bại trên mọi endpoint: ${lastError?.message}`);
}

/** Bbox của một FeatureCollection -> [minLat, minLon, maxLat, maxLon] (thứ tự Overpass). */
export function bboxOf(features) {
  let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
  const walk = (n) => {
    if (typeof n[0] === 'number') {
      minLon = Math.min(minLon, n[0]); maxLon = Math.max(maxLon, n[0]);
      minLat = Math.min(minLat, n[1]); maxLat = Math.max(maxLat, n[1]);
    } else n.forEach(walk);
  };
  for (const f of features) walk(f.geometry.coordinates);
  return [minLat, minLon, maxLat, maxLon];
}
