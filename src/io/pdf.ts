import type { Project } from '../types';
import jsPDF from 'jspdf';
import { exportSheetSVG } from './svg';

export const exportSheetPDF = async (project: Project) => {
  const sheet = project.sheets[project.activeSheetId];
  const orientation = sheet.width > sheet.height ? 'landscape' : 'portrait';
  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: [sheet.width, sheet.height],
  });

  // Render the SVG to canvas, then place as image into the PDF
  const svg = exportSheetSVG(project);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed loading SVG'));
    img.src = url;
  });

  const dpi = 300;
  const w = (sheet.width / 25.4) * dpi;
  const h = (sheet.height / 25.4) * dpi;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  const data = canvas.toDataURL('image/png');
  doc.addImage(data, 'PNG', 0, 0, sheet.width, sheet.height);

  // Add additional sheets
  for (let i = 0; i < project.sheetOrder.length; i++) {
    if (project.sheetOrder[i] === project.activeSheetId) continue;
  }

  doc.save(`${project.name.replace(/\s+/g, '_')}.pdf`);
};
