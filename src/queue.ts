import type { PrinterClient } from './printer';
import type { JobRepository, JobRow } from './jobs';
import type { AppLogger } from './logger';

export class JobQueue {
  private processing = false;
  private pendingKick = false;

  constructor(private repo: JobRepository, private printer: PrinterClient, private logger: AppLogger) {}

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
      const result = await this.printer.print({ text: job.text, image: job.image_data });
      this.repo.updateStatus(job.id, 'succeeded');
      this.logger.info({ jobId: job.id, bytes: result.bytes }, 'job succeeded');
    } catch (error) {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      this.repo.updateStatus(job.id, 'failed', message);
      this.logger.error({ jobId: job.id, error: message }, 'job failed');
    }
  }
}
