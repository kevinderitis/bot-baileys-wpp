import { Router } from 'express';
import { getSocket, getIsConnected } from '../socket.js';
import config from '../config.js';
import logger from '../utils/logger.js';

function requireAdminToken(req, res, next) {
  if (!config.admin.token) return next();

  const headerToken = req.get('x-admin-token');
  const queryToken = req.query.token;

  if (headerToken === config.admin.token || queryToken === config.admin.token) {
    return next();
  }

  return res.status(401).json({ error: 'Token de admin inválido o faltante' });
}

async function getGroups() {
  const sock = getSocket();
  if (!sock || !getIsConnected()) return [];

  const groups = await sock.groupFetchAllParticipating();
  return Object.values(groups)
    .map(group => ({
      jid: group.id,
      name: group.subject || group.id,
      participants: group.participants?.length || 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function createAdminRoutes(scheduler) {
  const router = Router();
  router.use(requireAdminToken);

  router.get('/status', (req, res) => {
    res.json({
      connected: getIsConnected(),
      protected: !!config.admin.token,
      pending: scheduler.listJobs().filter(job => job.status === 'pending').length,
    });
  });

  router.get('/groups', async (req, res) => {
    try {
      const groups = await getGroups();
      res.json({ connected: getIsConnected(), groups });
    } catch (err) {
      logger.error({ err }, 'Error obteniendo grupos');
      res.status(500).json({ error: 'No se pudieron obtener los grupos' });
    }
  });

  router.get('/schedules', (req, res) => {
    res.json({ schedules: scheduler.listJobs() });
  });

  router.post('/schedules', async (req, res) => {
    try {
      const groups = await getGroups();
      const created = await scheduler.createJobs({ ...req.body, groups });
      res.status(201).json({ schedules: created });
    } catch (err) {
      logger.warn({ err }, 'No se pudo crear la programación');
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/schedules/:id', async (req, res) => {
    try {
      const groups = await getGroups();
      const schedule = await scheduler.updateJob(req.params.id, { ...req.body, groups });
      res.json({ schedule });
    } catch (err) {
      logger.warn({ err }, 'No se pudo editar la programación');
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/schedules/:id', async (req, res) => {
    try {
      const schedule = await scheduler.deleteJob(req.params.id);
      res.json({ schedule });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

export default createAdminRoutes;
