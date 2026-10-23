import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../authz/assert';
import {
  addFeature, adminSummary, addLayer, addShare, copyMap, createExport, createImport, createMap, createUpload, deleteJob,
  deleteMap, deleteUpload, downloadJob, getJob, getMap, getRaster, getUpload, listFeatures, listJobs, listMaps, listShares, listShareTargets,
  listUploads, previewExport, removeFeature, removeLayer, removeShare, updateFeature, updateLayer, updateMap,
} from './controller';

// Personal maps. Any signed-in user has a workspace; who sees or writes a given map is decided
// per map by the services (access.ts), not by a route guard.
export default async function workspaceRoutes(app: FastifyInstance) {
  const signedIn = { preHandler: [app.authenticate] };
  app.get('/maps', signedIn, listMaps);
  app.post('/maps', signedIn, createMap);
  app.get('/maps/:mapId', signedIn, getMap);
  app.patch('/maps/:mapId', signedIn, updateMap);
  app.delete('/maps/:mapId', signedIn, deleteMap);
  app.post('/maps/:mapId/copy', signedIn, copyMap);

  // Shares are managed by the map's owner only; anyone signed in may look up share targets.
  app.get('/maps/:mapId/shares', signedIn, listShares);
  app.post('/maps/:mapId/shares', signedIn, addShare);
  app.delete('/maps/:mapId/shares/:shareId', signedIn, removeShare);
  app.get('/share-targets', signedIn, listShareTargets);

  // One route set for every layer kind; the controller dispatches on the layer's kind.
  app.post('/maps/:mapId/layers', signedIn, addLayer);
  app.patch('/maps/:mapId/layers/:layerId', signedIn, updateLayer);
  app.delete('/maps/:mapId/layers/:layerId', signedIn, removeLayer);
  app.get('/maps/:mapId/layers/:layerId/features', signedIn, listFeatures);
  // A raster layer's COG, by byte range, for whoever may read the map (rasters.ts).
  app.get('/maps/:mapId/layers/:layerId/raster', signedIn, getRaster);
  app.post('/maps/:mapId/layers/:layerId/features', signedIn, addFeature);
  app.put('/maps/:mapId/layers/:layerId/features/:featureId', signedIn, updateFeature);
  app.delete('/maps/:mapId/layers/:layerId/features/:featureId', signedIn, removeFeature);

  // Uploads belong to their owner alone (uploads.ts); multipart is registered in server.ts.
  app.post('/uploads', signedIn, createUpload);
  app.get('/uploads', signedIn, listUploads);
  app.get('/uploads/:fileId', signedIn, getUpload);
  app.delete('/uploads/:fileId', signedIn, deleteUpload);

  // Imports and exports are jobs for the worker (jobs.ts). Queueing follows the map: the owner
  // imports, the owner and recipients export. A job is its owner's alone.
  app.post('/maps/:mapId/imports', signedIn, createImport);
  app.post('/maps/:mapId/exports', signedIn, createExport);
  app.get('/maps/:mapId/exports/preview', signedIn, previewExport);
  app.get('/jobs', signedIn, listJobs);
  app.get('/jobs/:jobId', signedIn, getJob);
  app.delete('/jobs/:jobId', signedIn, deleteJob);
  app.get('/jobs/:jobId/download', signedIn, downloadJob);

  // Admin sees counts and sizes per owner, never content.
  app.get('/admin/summary', { preHandler: [app.authenticate, requireAdmin()] }, adminSummary);
}
