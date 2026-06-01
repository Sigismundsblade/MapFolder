import express from 'express';
import type { Server } from 'node:http';
import path from 'node:path';
import { ProjectReport } from '../analysis/types';

export interface ReportServerOptions {
  preferredPort?: number;
  openBrowser?: boolean;
}

export interface ReportServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function startReportServer(report: ProjectReport, options: ReportServerOptions = {}): Promise<ReportServerHandle> {
  const preferredPort = options.preferredPort ?? 4173;

  try {
    return await listenWithPort(report, preferredPort, options.openBrowser ?? true);
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException;
    if (typedError.code === 'EADDRINUSE') {
      return listenWithPort(report, 0, options.openBrowser ?? true);
    }
    throw error;
  }
}

async function listenWithPort(report: ProjectReport, port: number, openBrowser: boolean): Promise<ReportServerHandle> {
  const app = express();
  const projectRoot = path.resolve(__dirname, '..', '..');
  const publicRoot = path.join(projectRoot, 'public');
  const cytoscapeRoot = path.join(projectRoot, 'node_modules', 'cytoscape', 'dist');

  app.get('/api/report', (_request, response) => {
    response.json(report);
  });

  app.use('/vendor/cytoscape', express.static(cytoscapeRoot));
  app.use(express.static(publicRoot));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(publicRoot, 'index.html'));
  });

  const server = await new Promise<Server>((resolve, reject) => {
    const instance = app.listen(port, '127.0.0.1');

    instance.once('error', reject);
    instance.once('listening', () => {
      instance.off('error', reject);
      resolve(instance);
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine report server address.');
  }

  const url = `http://127.0.0.1:${address.port}`;
  if (openBrowser) {
    const openModule = await import('open');
    await openModule.default(url);
  }

  return {
    url,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
