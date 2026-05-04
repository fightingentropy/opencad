import type { Project } from '../types';
import jsPDF from 'jspdf';
import { exportSheetSVG } from './svg';

/**
 * Render an SVG string onto an offscreen canvas and return the PNG data URL.
 * Uses a data-URI approach (more reliable across browsers than Blob URLs for
 * SVG content) and renders at 300 DPI equivalent resolution.
 */
const svgToDataURL = (
  svg: string,
  widthMM: number,
  heightMM: number,
): Promise<string> => {
  const DPI = 300;
  const pxW = Math.round((widthMM / 25.4) * DPI);
  const pxH = Math.round((heightMM / 25.4) * DPI);

  // Encode SVG as a data URI — encodeURIComponent handles all special chars
  const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = pxW;
      canvas.height = pxH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas 2D context'));
        return;
      }
      // White background so the dark-themed SVG sits on a printable page
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pxW, pxH);
      ctx.drawImage(img, 0, 0, pxW, pxH);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load SVG into Image element'));
    img.src = encoded;
  });
};

/**
 * Export the active sheet as a single-page PDF and trigger a browser download.
 *
 * The page size matches the sheet dimensions (mm) with the correct orientation.
 * The drawing is rasterised at 300 DPI so it looks crisp when printed.
 */
export const exportSheetPDF = async (project: Project): Promise<void> => {
  const sheet = project.sheets[project.activeSheetId];
  const orientation = sheet.width > sheet.height ? 'landscape' : 'portrait';

  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: [sheet.width, sheet.height],
  });

  // Metadata
  doc.setProperties({
    title: `${project.name} — ${sheet.name}`,
    subject: `Sheet ${sheet.number}`,
    creator: 'OpenCAD Electrical',
  });

  // Render SVG → high-res PNG → embed in PDF page
  const svg = exportSheetSVG(project);
  const dataURL = await svgToDataURL(svg, sheet.width, sheet.height);
  doc.addImage(dataURL, 'PNG', 0, 0, sheet.width, sheet.height);

  doc.save(`${project.name.replace(/\s+/g, '_')}.pdf`);
};
