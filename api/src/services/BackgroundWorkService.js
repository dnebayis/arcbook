const config = require('../config');

class BackgroundWorkService {
  static localKickScheduled = false;
  static lastRemoteKickAt = 0;

  static async runWithinBudget({ timeBudgetMs = config.webhooks.drainBudgetMs } = {}) {
    const startedAt = Date.now();
    const stats = { webhooks: 0, anchors: 0 };
    const WebhookService = require('./WebhookService');
    const AnchorService = require('./AnchorService');

    const webhookBudgetMs = Math.max(250, Math.floor(timeBudgetMs * 0.45));
    stats.webhooks = await WebhookService.processDueBatch({
      limit: 2,
      timeBudgetMs: webhookBudgetMs
    });

    const remainingMs = Math.max(250, timeBudgetMs - (Date.now() - startedAt));
    stats.anchors = await AnchorService.processDueBatch({
      limit: 1,
      timeBudgetMs: remainingMs
    });

    const elapsedMs = Date.now() - startedAt;
    if (stats.webhooks > 0 || stats.anchors > 0) {
      console.info(
        `[BackgroundWork] drained webhooks=${stats.webhooks} anchors=${stats.anchors} elapsedMs=${elapsedMs}`
      );
    }

    return stats;
  }

  static kick(reason = 'unspecified', options = {}) {
    this.scheduleLocalDrain();
    void this.kickRemote(reason, options);
  }

  static scheduleLocalDrain() {
    if (this.localKickScheduled) return;

    this.localKickScheduled = true;
    setTimeout(() => {
      this.localKickScheduled = false;
      void this.runWithinBudget().catch((error) => {
        console.warn('[BackgroundWork] Local drain failed:', error.message);
      });
    }, 0);
  }

  static async kickRemote(reason = 'unspecified', { forceRemote = false } = {}) {
    const now = Date.now();
    if (!forceRemote && now - this.lastRemoteKickAt < 1_500) return;
    this.lastRemoteKickAt = now;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.webhooks.remoteKickTimeoutMs);

    try {
      await fetch(`${config.app.baseUrl}/api/v1/internal/drain`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Arcbook-Internal-Secret': config.security.sessionSecret
        },
        body: JSON.stringify({ reason }),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        console.warn(
          `[BackgroundWork] remote kick timed out after ${config.webhooks.remoteKickTimeoutMs}ms (${reason})`
        );
      }
      // Self-kicks are best effort; the local drain remains as fallback.
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = BackgroundWorkService;
