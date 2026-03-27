import PDFDocument from 'pdfkit';
import type { Itinerary } from '../api/expedition';

const LOGO_URL =
  'https://dynamic-media-cdn.tripadvisor.com/media/photo-o/2c/cb/08/0b/caption.jpg?w=400&h=-1&s=1';

// ─── Palette ─────────────────────────────────────────────────────────────────
const DARK    = '#2f3031';
const GOLD    = '#c8a45a';
const WHITE   = '#ffffff';
const LIGHT   = '#f7f6f4';
const MUTED   = '#888888';
const GREEN   = '#2e7d5e';  // included items
const RED     = '#b03030';  // not included items

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchLogoBuffer(): Promise<Buffer | null> {
  try {
    const res = await fetch(LOGO_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function sectionHeader(doc: PDFKit.PDFDocument, title: string) {
  const y = doc.y;
  doc.rect(50, y, doc.page.width - 100, 24).fill(DARK);
  doc
    .fill(GOLD)
    .fontSize(11)
    .font('Helvetica-Bold')
    .text(title.toUpperCase(), 60, y + 7, { width: doc.page.width - 120 });
  doc.y = y + 32;
}

function divider(doc: PDFKit.PDFDocument) {
  doc
    .moveTo(50, doc.y)
    .lineTo(doc.page.width - 50, doc.y)
    .strokeColor(GOLD)
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.6);
}

const FOOTER_HEIGHT = 65; // reserved at bottom of every page for footer

function ensureSpace(doc: PDFKit.PDFDocument, needed = 100) {
  if (doc.y > doc.page.height - Math.max(needed, FOOTER_HEIGHT)) doc.addPage();
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function generateBrochurePDF(itinerary: Itinerary): Promise<string> {
  const logoBuffer = await fetchLogoBuffer();

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 0, size: 'A4' });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    const W = doc.page.width;   // 595
    const H = doc.page.height;  // 842
    const M = 50;               // margin

    // ── Cover strip ──────────────────────────────────────────────────────────
    doc.rect(0, 0, W, 90).fill(DARK);

    // Logo on white pill
    if (logoBuffer) {
      doc.rect(M, 14, 160, 62).fill(WHITE);
      doc.image(logoBuffer, M + 6, 16, { height: 58, fit: [148, 58], align: 'left', valign: 'center' });
    } else {
      doc.fill(WHITE).fontSize(18).font('Helvetica-Bold').text('VOYAGERS TRAVEL', M, 34);
    }

    // Tagline on dark strip
    doc
      .fill(GOLD)
      .fontSize(9)
      .font('Helvetica')
      .text('Expedition & Adventure Tours', M + 170, 38, { width: W - M - 170 - M, align: 'right' });

    // ── Gold bar under header ─────────────────────────────────────────────────
    doc.rect(0, 90, W, 5).fill(GOLD);

    // ── Title block ───────────────────────────────────────────────────────────
    doc.rect(0, 95, W, 80).fill(LIGHT);

    doc
      .fill(DARK)
      .fontSize(18)
      .font('Helvetica-Bold')
      .text(itinerary.title, M, 108, { width: W - M * 2, align: 'center' });

    doc
      .fill(GOLD)
      .fontSize(11)
      .font('Helvetica')
      .text(
        `${itinerary.duration} Days  ·  ${itinerary.destination}`,
        M,
        152,
        { width: W - M * 2, align: 'center' }
      );

    doc.y = 185;

    // ── Short Description ─────────────────────────────────────────────────────
    if (itinerary.shortDescription) {
      const desc = stripHtml(itinerary.shortDescription);
      doc
        .fill(DARK)
        .fontSize(10)
        .font('Helvetica-Oblique')
        .text(desc, M, doc.y, { width: W - M * 2, align: 'justify' });
      doc.moveDown(0.8);
    }

    divider(doc);

    // ── Highlights ────────────────────────────────────────────────────────────
    if (itinerary.highlights?.length) {
      sectionHeader(doc, 'Tour Highlights');
      const colW = (W - M * 2 - 20) / 2;
      const highlights = itinerary.highlights;
      const half = Math.ceil(highlights.length / 2);

      const leftH  = highlights.slice(0, half);
      const rightH = highlights.slice(half);
      const startY = doc.y;

      // left column
      doc.fill(DARK).fontSize(9).font('Helvetica');
      leftH.forEach((h) => {
        doc.text(`▸  ${h}`, M, doc.y, { width: colW });
      });
      const afterLeft = doc.y;

      // right column
      doc.y = startY;
      rightH.forEach((h) => {
        doc.text(`▸  ${h}`, M + colW + 20, doc.y, { width: colW });
      });

      doc.y = Math.max(afterLeft, doc.y);
      doc.moveDown(0.8);
    }

    // ── Includes / Not Included ───────────────────────────────────────────────
    if (itinerary.includes?.length || itinerary.notInclude?.length) {
      ensureSpace(doc, 120);
      const colW = (W - M * 2 - 20) / 2;

      // Included header
      const startY = doc.y;
      doc.rect(M, startY, colW, 22).fill(GREEN);
      doc.fill(WHITE).fontSize(10).font('Helvetica-Bold').text("What's Included", M + 8, startY + 6, { width: colW - 10 });

      // Not included header
      doc.rect(M + colW + 20, startY, colW, 22).fill(RED);
      doc.fill(WHITE).fontSize(10).font('Helvetica-Bold').text('Not Included', M + colW + 28, startY + 6, { width: colW - 10 });

      doc.y = startY + 28;
      const itemStart = doc.y;

      // Left: included items
      doc.fill(DARK).fontSize(9).font('Helvetica');
      (itinerary.includes || []).forEach((item) => {
        doc.text(`✓  ${item}`, M, doc.y, { width: colW });
      });
      const afterLeft = doc.y;

      // Right: not included items
      doc.y = itemStart;
      (itinerary.notInclude || []).forEach((item) => {
        doc.text(`✗  ${item}`, M + colW + 20, doc.y, { width: colW });
      });

      doc.y = Math.max(afterLeft, doc.y);
      doc.moveDown(0.8);
    }

    // ── Daily Itinerary ───────────────────────────────────────────────────────
    if (itinerary.days?.length) {
      ensureSpace(doc, 80);
      sectionHeader(doc, 'Daily Itinerary');

      itinerary.days.forEach((day) => {
        ensureSpace(doc, 80);

        // Day title bar
        const dayY = doc.y;
        doc.rect(M, dayY, W - M * 2, 20).fill(LIGHT);
        doc
          .fill(DARK)
          .fontSize(10)
          .font('Helvetica-Bold')
          .text(`Day ${day.day}  –  ${day.title}`, M + 8, dayY + 5, { width: W - M * 2 - 16 });
        doc.y = dayY + 26;

        if (day.details) {
          const details = stripHtml(day.details);
          doc
            .fill(DARK)
            .fontSize(9)
            .font('Helvetica')
            .text(details, M, doc.y, { width: W - M * 2, align: 'justify' });
        }

        if (day.meals?.length) {
          doc
            .fill(MUTED)
            .fontSize(8)
            .font('Helvetica-Oblique')
            .text(`Meals: ${day.meals.join(', ')}`, M, doc.y, { width: W - M * 2 });
        }

        doc.moveDown(0.6);
      });
    }

    // ── Vessels ───────────────────────────────────────────────────────────────
    if (itinerary.cruise?.length) {
      ensureSpace(doc, 60);
      sectionHeader(doc, 'Vessels');
      itinerary.cruise.forEach((c) => {
        doc.fill(DARK).fontSize(10).font('Helvetica').text(`▸  ${c.name}`, M, doc.y, { width: W - M * 2 });
      });
      doc.moveDown(0.8);
    }

    // ── Footer on last page ────────────────────────────────────────────────────
    // If content already passed the footer zone, add a new page for the footer
    if (doc.y > H - FOOTER_HEIGHT) doc.addPage();
    const footerY = H - 55;
    doc.rect(0, footerY, W, 55).fill(DARK);
    doc.rect(0, footerY, W, 4).fill(GOLD);

    doc
      .fill(WHITE)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('voyagers.travel  ·  info@voyagers.travel', M, footerY + 16, {
        align: 'center',
        width: W - M * 2,
      });

    doc
      .fill(MUTED)
      .fontSize(7.5)
      .font('Helvetica')
      .text(
        `Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
        M,
        footerY + 33,
        { align: 'center', width: W - M * 2 }
      );

    doc.end();
  });
}
