// src/webhooks/ai-callbacks.js
const express = require('express');
const logger = require('../utils/logger');
const prisma = require('../utils/db');
const { videoQueue } = require('../queue/producer');

const router = express.Router();

router.post('/muapi', async (req, res) => {
  const { runId, phase } = req.query;
  const { status, outputs, error, request_id } = req.body;

  logger.info('Received muapi webhook', { runId, phase, status, request_id });

  if (!runId || !phase) {
    return res.status(400).json({ error: 'Missing runId or phase' });
  }

  try {
    if (status === 'completed') {
      const url = Array.isArray(outputs) ? outputs[0] : outputs;
      
      // Update the DB state with the phase result
      const runRecord = await prisma.videoRun.findUnique({ where: { id: runId } });
      let currentExports = runRecord.exports ? JSON.parse(runRecord.exports) : {};
      currentExports[`phase${phase}Url`] = url;

      await prisma.videoRun.update({
        where: { id: runId },
        data: {
          phase: parseInt(phase, 10),
          exports: JSON.stringify(currentExports)
        }
      });

      // Enqueue the next step
      await videoQueue.add(`continue-phase-${parseInt(phase, 10) + 1}`, {
        runId,
        theme: runRecord.themeId,
        phaseUrl: url
      });

    } else if (status === 'failed') {
      logger.error(`Webhook reported failure for run ${runId} phase ${phase}`, { error });
      await prisma.videoRun.update({
        where: { id: runId },
        data: { status: 'failed', error: error || 'Provider failed' }
      });
    }

    res.status(200).json({ received: true });
  } catch (err) {
    logger.error('Error processing webhook', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
