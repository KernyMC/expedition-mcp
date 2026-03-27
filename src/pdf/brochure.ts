import PDFDocument from 'pdfkit';
import type { Itinerary } from '../api/expedition';

const LOGO_URL =
  'https://dynamic-media-cdn.tripadvisor.com/media/photo-o/2c/cb/08/0b/caption.jpg?w=400&h=-1&s=1';

// ─── Palette ──────────────────────────────────────────────────────────────────
const DARK  = '#2f3031';
const GOLD  = '#c8a45a';
const WHITE = '#ffffff';
const LIGHT = '#f7f6f4';
const MUTED = '#888888';
const GREEN = '#2e7d5e';
const RED   = '#b03030';

// ─── A4 layout constants ──────────────────────────────────────────────────────
const PW = 595.28;   // page width
const PH = 841.89;   // page height
const M  = 50;       // left/right margin
const CW = PW - M * 2;  // content width = 495.28

const FOOTER_H  = 58;          // footer band height
const FOOTER_Y  = PH - FOOTER_H; // = 783.89
const SAFE_Y    = FOOTER_Y - 8;  // content must not exceed this

// ─── HTML stripping (comprehensive) ──────────────────────────────────────────

function stripHtml(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    // Block-level closing tags → newline
    .replace(/<\/(p|div|h[1-6]|li|tr|td|th|section|article|blockquote)>/gi, '\n')
    // Self-closing and opening block tags → newline
    .replace(/<br\s*\/?>/gi, '\n')
    // Remove ALL remaining tags (including inline styles, class, etc.)
    .replace(/<[^>]*>/g, '')
    // Named HTML entities
    .replace(/&amp;/g,    '&')
    .replace(/&lt;/g,     '<')
    .replace(/&gt;/g,     '>')
    .replace(/&nbsp;/g,   ' ')
    .replace(/&rsquo;/g,  '\u2019')
    .replace(/&lsquo;/g,  '\u2018')
    .replace(/&rdquo;/g,  '\u201D')
    .replace(/&ldquo;/g,  '\u201C')
    .replace(/&mdash;/g,  '\u2014')
    .replace(/&ndash;/g,  '\u2013')
    .replace(/&hellip;/g, '\u2026')
    .replace(/&apos;/g,   "'")
    .replace(/&quot;/g,   '"')
    // Decimal numeric entities: &#39; &#160; etc.
    .replace(/&#(\d+);/g,    (_, n) => String.fromCharCode(Number(n)))
    // Hex numeric entities: &#x27; etc.
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    // Normalise whitespace
    .replace(/[ \t]+/g,  ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g,  '\n\n')
    .trim();
}

// ─── Logo fetch ───────────────────────────────────────────────────────────────

async function fetchLogo(): Promise<Buffer | null> {
  try {
    const res = await fetch(LOGO_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/jpeg,image/png,image/*,*/*',
        'Referer': 'https://www.tripadvisor.com/',
      },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) return null; // guard against empty/error responses
    return buf;
  } catch {
    return null;
  }
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

/** Add a new page only when remaining space is insufficient */
function needSpace(doc: PDFKit.PDFDocument, required: number) {
  if (doc.y + required > SAFE_Y) doc.addPage();
}

/** Dark bar with gold label */
function sectionBar(doc: PDFKit.PDFDocument, title: string) {
  needSpace(doc, 40);
  const y = doc.y;
  doc.rect(M, y, CW, 22).fill(DARK);
  doc.fill(GOLD).fontSize(10).font('Helvetica-Bold')
     .text(title.toUpperCase(), M + 8, y + 7, { width: CW - 16 });
  doc.y = y + 28;
}

/** Footer stamped on every page */
function stampFooter(doc: PDFKit.PDFDocument) {
  doc.rect(0, FOOTER_Y, PW, FOOTER_H).fill(DARK);
  doc.rect(0, FOOTER_Y, PW, 3).fill(GOLD);
  doc.fill(WHITE).fontSize(9).font('Helvetica-Bold')
     .text('voyagers.travel  ·  info@voyagers.travel', M, FOOTER_Y + 14, {
       align: 'center', width: CW,
     });
  doc.fill(MUTED).fontSize(7.5).font('Helvetica')
     .text(
       `Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
       M, FOOTER_Y + 33, { align: 'center', width: CW }
     );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateBrochurePDF(itinerary: Itinerary): Promise<string> {
  const logoBuffer = await fetchLogo();

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    // bufferPages: true → lets us iterate all pages at the end to stamp footer everywhere
    const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });

    doc.on('data',  (c: Buffer) => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    // ── HEADER ────────────────────────────────────────────────────────────────
    doc.rect(0, 0, PW, 88).fill(DARK);
    doc.rect(0, 88, PW, 4).fill(GOLD);

    // Logo on white box
    if (logoBuffer) {
      doc.rect(M, 12, 172, 64).fill(WHITE);
      try {
        doc.image(logoBuffer, M + 5, 14, { fit: [162, 60] });
      } catch {
        // fallback: text only
        doc.fill(WHITE).fontSize(18).font('Helvetica-Bold').text('VOYAGERS TRAVEL', M + 6, 34);
      }
    } else {
      doc.fill(WHITE).fontSize(18).font('Helvetica-Bold').text('VOYAGERS TRAVEL', M, 32);
    }

    // Tagline on the right
    doc.fill(GOLD).fontSize(9).font('Helvetica')
       .text('Expedition & Adventure Tours', M + 180, 40, {
         width: PW - M - 180 - M, align: 'right',
       });

    // ── TITLE BLOCK ───────────────────────────────────────────────────────────
    // Dynamic height: measure title first
    const titleFontSize = itinerary.title.length > 60 ? 16 : 19;
    doc.rect(0, 92, PW, 88).fill(LIGHT);

    doc.fill(DARK).fontSize(titleFontSize).font('Helvetica-Bold')
       .text(itinerary.title, M, 104, { width: CW, align: 'center' });

    doc.fill(GOLD).fontSize(11).font('Helvetica')
       .text(
         `${itinerary.duration} Days  ·  ${itinerary.destination}`,
         M, 154, { width: CW, align: 'center' }
       );

    doc.y = 190;

    // ── SHORT DESCRIPTION ─────────────────────────────────────────────────────
    if (itinerary.shortDescription) {
      const desc = stripHtml(itinerary.shortDescription);
      if (desc) {
        doc.fill(DARK).fontSize(10).font('Helvetica-Oblique')
           .text(desc, M, doc.y, { width: CW, align: 'justify' });
        doc.moveDown(0.7);
      }
    }

    // Thin gold divider
    doc.moveTo(M, doc.y).lineTo(PW - M, doc.y)
       .strokeColor(GOLD).lineWidth(0.5).stroke();
    doc.moveDown(0.6);

    // ── HIGHLIGHTS ────────────────────────────────────────────────────────────
    if (itinerary.highlights?.length) {
      sectionBar(doc, 'Tour Highlights');
      const colW = (CW - 16) / 2;
      const half = Math.ceil(itinerary.highlights.length / 2);
      const leftItems  = itinerary.highlights.slice(0, half);
      const rightItems = itinerary.highlights.slice(half);
      const startY = doc.y;

      doc.fill(DARK).fontSize(9).font('Helvetica');
      leftItems.forEach(h => { doc.text(`▸  ${stripHtml(h)}`, M, doc.y, { width: colW }); });
      const afterLeft = doc.y;

      doc.y = startY;
      rightItems.forEach(h => { doc.text(`▸  ${stripHtml(h)}`, M + colW + 16, doc.y, { width: colW }); });

      doc.y = Math.max(afterLeft, doc.y);
      doc.moveDown(0.8);
    }

    // ── INCLUDES / NOT INCLUDED ───────────────────────────────────────────────
    const incItems = itinerary.includes || [];
    const notItems = itinerary.notInclude || [];

    if (incItems.length || notItems.length) {
      needSpace(doc, 100);
      const colW = (CW - 12) / 2;
      const startY = doc.y;

      // Green "Included" header
      doc.rect(M, startY, colW, 22).fill(GREEN);
      doc.fill(WHITE).fontSize(10).font('Helvetica-Bold')
         .text("What's Included", M + 6, startY + 6, { width: colW - 8 });

      // Red "Not Included" header
      doc.rect(M + colW + 12, startY, colW, 22).fill(RED);
      doc.fill(WHITE).fontSize(10).font('Helvetica-Bold')
         .text('Not Included', M + colW + 18, startY + 6, { width: colW - 8 });

      const itemsY = startY + 28;
      doc.fill(DARK).fontSize(9).font('Helvetica');

      // Left column
      doc.y = itemsY;
      incItems.forEach(item => {
        doc.text(`✓  ${stripHtml(item)}`, M, doc.y, { width: colW });
      });
      const afterLeft = doc.y;

      // Right column — reset Y to same start
      doc.y = itemsY;
      notItems.forEach(item => {
        doc.text(`✗  ${stripHtml(item)}`, M + colW + 12, doc.y, { width: colW });
      });

      doc.y = Math.max(afterLeft, doc.y);
      doc.moveDown(1);
    }

    // ── DAILY ITINERARY ───────────────────────────────────────────────────────
    if (itinerary.days?.length) {
      needSpace(doc, 60);
      sectionBar(doc, 'Daily Itinerary');

      itinerary.days.forEach(day => {
        needSpace(doc, 70);

        // Day title row
        const dayY = doc.y;
        doc.rect(M, dayY, CW, 20).fill(LIGHT);
        doc.fill(DARK).fontSize(10).font('Helvetica-Bold')
           .text(`Day ${day.day}  –  ${day.title}`, M + 8, dayY + 5, { width: CW - 16 });
        doc.y = dayY + 26;

        if (day.details) {
          const details = stripHtml(day.details);
          if (details) {
            needSpace(doc, 20);
            doc.fill(DARK).fontSize(9).font('Helvetica')
               .text(details, M, doc.y, { width: CW, align: 'justify' });
          }
        }

        if (day.meals?.length) {
          doc.fill(MUTED).fontSize(8).font('Helvetica-Oblique')
             .text(`Meals: ${day.meals.join(', ')}`, M, doc.y, { width: CW });
        }

        doc.moveDown(0.5);
      });
    }

    // ── VESSELS ───────────────────────────────────────────────────────────────
    if (itinerary.cruise?.length) {
      needSpace(doc, 60);
      sectionBar(doc, 'Vessels');
      itinerary.cruise.forEach(c => {
        doc.fill(DARK).fontSize(10).font('Helvetica')
           .text(`▸  ${c.name}`, M, doc.y, { width: CW });
      });
      doc.moveDown(0.8);
    }

    // ── FOOTER ON EVERY PAGE ──────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      stampFooter(doc);
    }

    doc.flushPages();
    doc.end();
  });
}
