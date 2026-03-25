import PDFDocument from 'pdfkit';
import type { Itinerary } from '../api/expedition';

/**
 * Generates a tour brochure PDF and returns it as a base64 string.
 */
export async function generateBrochurePDF(itinerary: Itinerary): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    const BRAND_COLOR = '#1a6b5a';
    const ACCENT_COLOR = '#e8a020';
    const TEXT_COLOR = '#2f3031';
    const LIGHT_GRAY = '#f5f5f5';

    // ─── Header ────────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 100).fill(BRAND_COLOR);

    doc
      .fill('#ffffff')
      .fontSize(26)
      .font('Helvetica-Bold')
      .text('VOYAGERS TRAVEL', 50, 28, { align: 'left' });

    doc
      .fill('#ffffff')
      .fontSize(11)
      .font('Helvetica')
      .text('Expedition & Adventure Tours', 50, 58, { align: 'left' });

    // ─── Tour Title ─────────────────────────────────────────────────────────
    doc.moveDown(2);
    doc
      .fill(BRAND_COLOR)
      .fontSize(22)
      .font('Helvetica-Bold')
      .text(itinerary.title, { align: 'center' });

    doc
      .fill(ACCENT_COLOR)
      .fontSize(12)
      .font('Helvetica')
      .text(`${itinerary.duration} Days · ${itinerary.destination}`, { align: 'center' });

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke(BRAND_COLOR);
    doc.moveDown(0.5);

    // ─── Short Description ──────────────────────────────────────────────────
    if (itinerary.shortDescription) {
      doc
        .fill(TEXT_COLOR)
        .fontSize(11)
        .font('Helvetica-Oblique')
        .text(itinerary.shortDescription, { align: 'justify' });
      doc.moveDown();
    }

    // ─── Highlights ─────────────────────────────────────────────────────────
    if (itinerary.highlights?.length) {
      sectionTitle(doc, 'Tour Highlights', BRAND_COLOR, LIGHT_GRAY);
      itinerary.highlights.forEach((h) => {
        doc.fill(TEXT_COLOR).fontSize(10).font('Helvetica').text(`• ${h}`);
      });
      doc.moveDown();
    }

    // ─── Includes / Not Includes ─────────────────────────────────────────────
    if (itinerary.includes?.length || itinerary.notInclude?.length) {
      const colWidth = (doc.page.width - 100) / 2;
      const startY = doc.y;

      // Includes
      doc
        .fill(BRAND_COLOR)
        .fontSize(11)
        .font('Helvetica-Bold')
        .text('What\'s Included', 50, startY);
      doc.fill(TEXT_COLOR).fontSize(9).font('Helvetica');
      (itinerary.includes || []).forEach((item) => {
        doc.text(`✓ ${item}`, 50, doc.y, { width: colWidth - 10 });
      });

      const afterIncludes = doc.y;

      // Not includes
      doc
        .fill('#c0392b')
        .fontSize(11)
        .font('Helvetica-Bold')
        .text('Not Included', 50 + colWidth, startY);
      doc
        .fill(TEXT_COLOR)
        .fontSize(9)
        .font('Helvetica');
      (itinerary.notInclude || []).forEach((item) => {
        doc.text(`✗ ${item}`, 50 + colWidth, doc.y, { width: colWidth - 10 });
      });

      doc.y = Math.max(afterIncludes, doc.y);
      doc.moveDown();
    }

    // ─── Daily Itinerary ─────────────────────────────────────────────────────
    if (itinerary.days?.length) {
      sectionTitle(doc, 'Daily Itinerary', BRAND_COLOR, LIGHT_GRAY);

      itinerary.days.forEach((day) => {
        if (doc.y > doc.page.height - 120) doc.addPage();

        doc
          .fill(ACCENT_COLOR)
          .fontSize(11)
          .font('Helvetica-Bold')
          .text(`Day ${day.day}: ${day.title}`);

        if (day.details) {
          doc
            .fill(TEXT_COLOR)
            .fontSize(9)
            .font('Helvetica')
            .text(day.details, { align: 'justify' });
        }

        if (day.meals?.length) {
          doc
            .fill('#888888')
            .fontSize(8)
            .font('Helvetica-Oblique')
            .text(`Meals: ${day.meals.join(', ')}`);
        }

        doc.moveDown(0.5);
      });
    }

    // ─── Cruise Info ──────────────────────────────────────────────────────────
    if (itinerary.cruise?.length) {
      if (doc.y > doc.page.height - 80) doc.addPage();
      sectionTitle(doc, 'Vessels', BRAND_COLOR, LIGHT_GRAY);
      itinerary.cruise.forEach((c) => {
        doc.fill(TEXT_COLOR).fontSize(10).font('Helvetica').text(`• ${c.name}`);
      });
      doc.moveDown();
    }

    // ─── Footer ───────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 60;
    doc.rect(0, footerY, doc.page.width, 60).fill(BRAND_COLOR);
    doc
      .fill('#ffffff')
      .fontSize(9)
      .font('Helvetica')
      .text('voyagers.travel  ·  info@voyagerstravel.com', 50, footerY + 15, {
        align: 'center',
        width: doc.page.width - 100,
      });
    doc
      .fill('#cccccc')
      .fontSize(8)
      .text(
        `Brochure generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
        50,
        footerY + 32,
        { align: 'center', width: doc.page.width - 100 }
      );

    doc.end();
  });
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, color: string, bg: string) {
  doc.rect(50, doc.y, doc.page.width - 100, 22).fill(bg);
  doc
    .fill(color)
    .fontSize(12)
    .font('Helvetica-Bold')
    .text(title, 55, doc.y - 18);
  doc.moveDown(0.8);
}
