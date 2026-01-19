import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { AppLogger } from './logger';

export interface StreamHandle {
  dir: string;
  stop: () => void;
}

export function startRtspHlsStream(options: {
  url: string;
  dataDir: string;
  logger: AppLogger;
}): StreamHandle | null {
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (probe.error || probe.status !== 0) {
    options.logger.error({ error: probe.error }, 'ffmpeg is not available');
    return null;
  }
  const streamDir = path.join(options.dataDir, 'stream');
  fs.rmSync(streamDir, { recursive: true, force: true });
  fs.mkdirSync(streamDir, { recursive: true });

  const playlistPath = path.join(streamDir, 'index.m3u8');
  const segmentPattern = path.join(streamDir, 'segment-%03d.ts');
  const args = [
    '-rtsp_transport',
    'tcp',
    '-i',
    options.url,
    '-an',
    '-vf',
    'fps=10',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'zerolatency',
    '-g',
    '10',
    '-keyint_min',
    '10',
    '-f',
    'hls',
    '-hls_time',
    '1',
    '-hls_list_size',
    '3',
    '-hls_flags',
    'delete_segments+append_list+omit_endlist',
    '-hls_segment_filename',
    segmentPattern,
    playlistPath
  ];

  let lastStderr = '';
  const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  ffmpeg.stderr?.setEncoding('utf8');
  ffmpeg.stderr?.on('data', (chunk) => {
    lastStderr = chunk.toString().trim();
  });
  ffmpeg.on('error', (error) => {
    options.logger.error({ error }, 'ffmpeg failed to start');
  });
  ffmpeg.on('exit', (code, signal) => {
    if (code === 0) {
      return;
    }
    options.logger.error({ code, signal, stderr: lastStderr }, 'ffmpeg exited');
  });

  const stop = (): void => {
    if (ffmpeg.killed) {
      return;
    }
    ffmpeg.kill('SIGTERM');
    setTimeout(() => {
      if (!ffmpeg.killed) {
        ffmpeg.kill('SIGKILL');
      }
    }, 2000);
  };

  return { dir: streamDir, stop };
}
