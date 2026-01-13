import type { Logger } from 'pino';
import type { PrinterClient } from './printer';
import type { JobRepository, JobRow } from './jobs';

export class JobQueue {
  private processing = false;
  private pendingKick = false;

  constructor(private repo: JobRepository, private printer: PrinterClient, private logger: Logger) {}

  start(): void {
    this.kick();
  }

  kick(): void {
    if (this.processing) {
      this.pendingKick = true;
      return;
    }
    void this.processLoop();
  }

  private async processLoop(): Promise<void> {
    this.processing = true;
    try {
      while (true) {
        const job = this.repo.nextQueued();
        if (!job) {
          break;
        }
        await this.processJob(job);
      }
    } finally {
      this.processing = false;
      if (this.pendingKick) {
        this.pendingKick = false;
        this.kick();
      }
    }
  }

  private async processJob(job: JobRow): Promise<void> {
    this.repo.updateStatus(job.id, 'printing');
    this.logger.info({ jobId: job.id }, 'job started');

    try {
      const result = await this.printer.print(job.text);
      this.repo.updateStatus(job.id, 'succeeded');
      this.logger.info({ jobId: job.id, bytes: result.bytes }, 'job succeeded');
    } catch (error) {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      this.repo.updateStatus(job.id, 'failed', message);
      this.logger.error({ jobId: job.id, error: message }, 'job failed');
    }
  }
}
