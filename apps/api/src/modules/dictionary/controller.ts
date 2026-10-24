import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DictFeatureType } from '@webatlas/shared';
import { NotFoundError } from '../../errors';
import { getDictionary, getFeatureType } from './service';
import { csvTemplate, gpkgTemplate } from './template';

/** GET /api/dictionary: the whole dictionary with a strong ETag; a matching If-None-Match gets 304. */
export async function dictionary(req: FastifyRequest, reply: FastifyReply) {
  const body = await getDictionary(req.server.pg);
  const etag = `"${body.version}"`;
  reply.header('ETag', etag).header('Cache-Control', 'no-cache');
  if (req.headers['if-none-match'] === etag) return reply.code(304).send();
  return reply.send(body);
}

/** GET /api/dictionary/:layer: one feature type by key. */
export async function dictionaryLayer(req: FastifyRequest, reply: FastifyReply) {
  const { layer } = req.params as { layer: string };
  const featureType = await getFeatureType(req.server.pg, layer);
  if (!featureType) throw new NotFoundError(`Không có lớp "${layer}" trong từ điển dữ liệu.`);
  return reply.send(featureType);
}

const RASTER_NO_TEMPLATE = 'Lớp ảnh không có tệp mẫu.';
const RETIRED_NO_TEMPLATE = 'Lớp đã ngừng dùng, không có tệp mẫu.';

/** The feature type a template is made for: unknown → Task 7's 404; raster or retired → no template. */
async function templateFeatureType(req: FastifyRequest): Promise<DictFeatureType> {
  const { layer } = req.params as { layer: string };
  const featureType = await getFeatureType(req.server.pg, layer);
  if (!featureType) throw new NotFoundError(`Không có lớp "${layer}" trong từ điển dữ liệu.`);
  if (featureType.kind === 'raster') throw new NotFoundError(RASTER_NO_TEMPLATE);
  // A retired layer accepts no uploads, and its attributes all carry its validTo.
  if (featureType.validTo) throw new NotFoundError(RETIRED_NO_TEMPLATE);
  return featureType;
}

function attachment(reply: FastifyReply, key: string, ext: 'csv' | 'gpkg') {
  return reply.header('Content-Disposition', `attachment; filename="mau-${key}.${ext}"`);
}

/** GET /api/dictionary/:layer/template.csv: an empty CSV with the layer's columns. */
export async function templateCsv(req: FastifyRequest, reply: FastifyReply) {
  const featureType = await templateFeatureType(req);
  return attachment(reply, featureType.key, 'csv')
    .type('text/csv; charset=utf-8')
    .send(csvTemplate(featureType));
}

/** GET /api/dictionary/:layer/template.gpkg: an empty GeoPackage with the layer's feature table. */
export async function templateGpkg(req: FastifyRequest, reply: FastifyReply) {
  const featureType = await templateFeatureType(req);
  return attachment(reply, featureType.key, 'gpkg')
    .type('application/geopackage+sqlite3')
    .send(await gpkgTemplate(featureType));
}
