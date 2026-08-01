import type { Project } from '../types';
import { exportSheetSVG } from './svg';
import { buildExportMetadata } from './export-metadata';
import { embedPngExportMetadata } from './png-metadata';

export const exportSheetPNG = async (project: Project, scale = 2): Promise<Blob> => {
  const svg = exportSheetSVG(project);
  const metadata = buildExportMetadata(project, 'sheet-png');
  const sheet = project.sheets[project.activeSheetId];
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = sheet.width * 4 * scale;
      const h = sheet.height * 4 * scale;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#0a0e14';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((b) => {
        URL.revokeObjectURL(url);
        if (b) {
          void embedPngExportMetadata(b, metadata).then(resolve, reject);
        } else reject(new Error('PNG encoding failed'));
      }, 'image/png');
    };
    img.onerror = (err) => reject(err);
    img.src = url;
  });
};
