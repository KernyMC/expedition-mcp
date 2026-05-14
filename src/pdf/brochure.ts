import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import type { Itinerary, CruiseProduct } from '../api/expedition';

const VOYAGERS_LOGO_PNG = 'https://firebasestorage.googleapis.com/v0/b/travel-web-app-1.appspot.com/o/flamelink%2Fmedia%2Fvoyagers-logo.png?alt=media&token=e59141aa-54e1-496b-b55a-21ef9ab88175';

// ─── Fonts ────────────────────────────────────────────────────────────────────
const FONTS_DIR = path.join(__dirname, 'fonts');
const FONT_SERIF      = path.join(FONTS_DIR, 'Merriweather-Regular.woff');
const FONT_SERIF_BOLD = path.join(FONTS_DIR, 'Merriweather-Bold.woff');
const FONT_SANS       = path.join(FONTS_DIR, 'OpenSans-Regular.woff');
const FONT_SANS_ITALIC= path.join(FONTS_DIR, 'OpenSans-Italic.woff');

function registerFonts(doc: PDFKit.PDFDocument) {
  const customFontsAvailable = [FONT_SERIF, FONT_SERIF_BOLD, FONT_SANS, FONT_SANS_ITALIC]
    .every(f => fs.existsSync(f));

  if (customFontsAvailable) {
    doc.registerFont('Serif',       FONT_SERIF);
    doc.registerFont('Serif-Bold',  FONT_SERIF_BOLD);
    doc.registerFont('Sans',        FONT_SANS);
    doc.registerFont('Sans-Italic', FONT_SANS_ITALIC);
  } else {
    doc.registerFont('Serif',       'Helvetica');
    doc.registerFont('Serif-Bold',  'Helvetica-Bold');
    doc.registerFont('Sans',        'Helvetica');
    doc.registerFont('Sans-Italic', 'Helvetica-Oblique');
  }
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const DARK  = '#2f3031';
const GOLD  = '#c8a45a';
const WHITE = '#ffffff';
const LIGHT = '#f7f6f4';
const MUTED = '#888888';
const GREEN = '#2e7d5e';
const RED   = '#b03030';

// ─── A4 layout constants ──────────────────────────────────────────────────────
const PW = 595.28;
const PH = 841.89;
const M  = 50;
const CW = PW - M * 2;

const FOOTER_H = 58;
const FOOTER_Y = PH - FOOTER_H;
const SAFE_Y   = FOOTER_Y - 8;

// ─── HTML stripping ───────────────────────────────────────────────────────────

function stripHtml(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (typeof raw !== 'string') raw = String(raw);
  return (raw as string)
    .replace(/<\/(p|div|h[1-6]|li|tr|td|th|section|article|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
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
    .replace(/&#(\d+);/g,    (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/[ \t]+/g,  ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g,  '\n\n')
    .trim();
}

// ─── Image fetch ──────────────────────────────────────────────────────────────

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*,*/*' },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 100 ? buf : null;
  } catch {
    return null;
  }
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

const PAGE_TOP = 40; // top margin on new pages

function needSpace(doc: PDFKit.PDFDocument, required: number) {
  if (doc.y + required > SAFE_Y) {
    doc.addPage();
    doc.y = PAGE_TOP;
  }
}

/**
 * Write potentially long text, adding a new page when needed.
 * Splits on newlines and estimates height per paragraph.
 */
function safeText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  opts: PDFKit.Mixins.TextOptions & { fontSize?: number; fontName?: string; fillColor?: string }
) {
  const { fontSize = 9, fontName = 'Sans', fillColor = DARK, ...rest } = opts;
  doc.fontSize(fontSize).font(fontName).fill(fillColor);
  const paragraphs = text.split('\n');
  paragraphs.forEach((para, pi) => {
    if (!para.trim()) { doc.moveDown(0.3); return; }
    const charsPerLine = Math.floor((rest.width ?? CW) / (fontSize * 0.55));
    const estimatedH   = (Math.ceil(para.length / Math.max(1, charsPerLine)) + 1) * fontSize * 1.5;
    if (doc.y + estimatedH > SAFE_Y) { doc.addPage(); doc.y = PAGE_TOP; }
    doc.text(para, x, doc.y, { ...rest, lineBreak: true });
    if (pi < paragraphs.length - 1) doc.moveDown(0.2);
  });
}

function sectionBar(doc: PDFKit.PDFDocument, title: string) {
  needSpace(doc, 40);
  const y = doc.y;
  doc.rect(M, y, CW, 22).fill(DARK);
  doc.fill(GOLD).fontSize(9).font('Serif-Bold')
     .text(title.toUpperCase(), M + 8, y + 7, { width: CW - 16, characterSpacing: 1 });
  doc.y = y + 28;
}

function stampFooter(doc: PDFKit.PDFDocument) {
  doc.rect(0, FOOTER_Y, PW, FOOTER_H).fill(DARK);
  doc.rect(0, FOOTER_Y, PW, 3).fill(GOLD);
  doc.fill(WHITE).fontSize(9).font('Sans')
     .text('voyagers.travel  ·  info@voyagers.travel', M, FOOTER_Y + 14, {
       align: 'center', width: CW,
     });
  doc.fill(MUTED).fontSize(7.5).font('Sans')
     .text(
       `Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
       M, FOOTER_Y + 33, { align: 'center', width: CW }
     );
}

// ─── Cruise / Ship brochure ───────────────────────────────────────────────────

export async function generateCruiseBrochurePDF(cruise: CruiseProduct): Promise<string> {
  const imageUrl = cruise.mainImage?.[0]?.url ?? cruise.card?.[0]?.url;
  const [imageBuf, logoBuf] = await Promise.all([
    imageUrl ? fetchImage(imageUrl) : Promise.resolve(null),
    fetchImage(VOYAGERS_LOGO_PNG),
  ]);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });
    registerFonts(doc);

    doc.on('data',  (c: Buffer) => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    // ── HEADER ────────────────────────────────────────────────────────────────
    doc.rect(0, 0, PW, 88).fill(DARK);
    doc.rect(0, 85, PW, 4).fill(GOLD);

    if (logoBuf) {
      doc.image(logoBuf, M, 12, { height: 60, fit: [200, 60] });
    } else {
      doc.fill(WHITE).fontSize(22).font('Serif-Bold')
         .text('VOYAGERS', M, 20, { characterSpacing: 3 });
      doc.fill(GOLD).fontSize(7).font('Sans')
         .text('TRAVEL', M, 50, { characterSpacing: 5 });
    }
    doc.fill(GOLD).fontSize(8.5).font('Sans-Italic')
       .text('Expedition & Adventure Tours', 0, 38, { width: PW - M, align: 'right' });

    // ── TITLE BLOCK ───────────────────────────────────────────────────────────
    doc.rect(0, 89, PW, 90).fill(LIGHT);

    const titleFontSize = cruise.name.length > 60 ? 15 : 18;
    doc.fill(DARK).fontSize(titleFontSize).font('Serif-Bold')
       .text(cruise.name, M, 104, { width: CW, align: 'center' });

    const subtitle = [cruise.type, cruise.category, cruise.origin ? cruise.origin.charAt(0).toUpperCase() + cruise.origin.slice(1) : '']
      .filter(Boolean).join('  ·  ');
    doc.fill(GOLD).fontSize(11).font('Sans')
       .text(subtitle, M, 138, { width: CW, align: 'center' });

    if (cruise.capacity) {
      doc.fill(MUTED).fontSize(9).font('Sans')
         .text(`Capacity: ${cruise.capacity} passengers`, M, 158, { width: CW, align: 'center' });
    }

    // ── SHIP IMAGE ────────────────────────────────────────────────────────────
    const IMG_H = 200;
    if (imageBuf) {
      try {
        doc.image(imageBuf, 0, 179, { width: PW, height: IMG_H, cover: [PW, IMG_H] });
        // Dark overlay for readability
        doc.rect(0, 179, PW, IMG_H).fillOpacity(0.15).fill(DARK).fillOpacity(1);
        doc.y = 179 + IMG_H + 14;
      } catch {
        doc.y = 192;
      }
    } else {
      doc.y = 192;
    }

    // ── SHORT DESCRIPTION ─────────────────────────────────────────────────────
    if (cruise.shortDescription) {
      const desc = stripHtml(cruise.shortDescription);
      if (desc) {
        safeText(doc, desc, M, { width: CW, align: 'justify', fontSize: 10, fontName: 'Sans-Italic', fillColor: DARK });
        doc.moveDown(0.7);
      }
    }

    doc.moveTo(M, doc.y).lineTo(PW - M, doc.y)
       .strokeColor(GOLD).lineWidth(0.5).stroke();
    doc.moveDown(0.6);

    // ── DESCRIPTION ───────────────────────────────────────────────────────────
    if (cruise.description) {
      const desc = stripHtml(cruise.description);
      if (desc) {
        sectionBar(doc, 'About This Vessel');
        safeText(doc, desc, M, { width: CW, align: 'justify', fontSize: 9 });
        doc.moveDown(0.8);
      }
    }

    // ── SPECIFICATIONS ────────────────────────────────────────────────────────
    if (cruise.specifications?.length) {
      sectionBar(doc, 'Specifications');
      const colW = (CW - 16) / 2;
      const half = Math.ceil(cruise.specifications.length / 2);
      const leftItems  = cruise.specifications.slice(0, half);
      const rightItems = cruise.specifications.slice(half);
      const startY = doc.y;

      doc.fill(DARK).fontSize(9).font('Sans');
      leftItems.forEach(s => { doc.text(`- ${stripHtml(s)}`, M, doc.y, { width: colW }); });
      const afterLeft = doc.y;

      doc.y = startY;
      rightItems.forEach(s => { doc.text(`- ${stripHtml(s)}`, M + colW + 16, doc.y, { width: colW }); });

      doc.y = Math.max(afterLeft, doc.y);
      doc.moveDown(0.8);
    }

    // ── CABIN TYPES ───────────────────────────────────────────────────────────
    if (cruise.cabins?.length) {
      sectionBar(doc, 'Cabin Types');
      cruise.cabins.forEach((cabin: any) => {
        needSpace(doc, 50);
        const cabinY = doc.y;
        doc.rect(M, cabinY, CW, 18).fill(LIGHT);
        doc.fill(DARK).fontSize(10).font('Serif-Bold')
           .text(cabin.title ?? cabin.name ?? 'Cabin', M + 8, cabinY + 4, { width: CW - 16 });
        doc.y = cabinY + 22;

        const parts: string[] = [];
        if (cabin.size)          parts.push(`Size: ${cabin.size}`);
        if (cabin.maxOccupancy)  parts.push(`Max occupancy: ${cabin.maxOccupancy}`);
        if (parts.length) {
          doc.fill(MUTED).fontSize(8).font('Sans')
             .text(parts.join('  ·  '), M, doc.y, { width: CW });
        }
        if (cabin.description) {
          safeText(doc, stripHtml(cabin.description), M, { width: CW, fontSize: 9 });
        }
        doc.moveDown(0.5);
      });
    }

    // ── INCLUDES / NOT INCLUDED ───────────────────────────────────────────────
    const incItems = cruise.includes || [];
    const notItems = cruise.notInclude || [];

    if (incItems.length || notItems.length) {
      needSpace(doc, 100);
      const colW = (CW - 12) / 2;
      const startY = doc.y;

      doc.rect(M, startY, colW, 22).fill(GREEN);
      doc.fill(WHITE).fontSize(10).font('Serif-Bold')
         .text("What's Included", M + 6, startY + 6, { width: colW - 8 });

      doc.rect(M + colW + 12, startY, colW, 22).fill(RED);
      doc.fill(WHITE).fontSize(10).font('Serif-Bold')
         .text('Not Included', M + colW + 18, startY + 6, { width: colW - 8 });

      const itemsY = startY + 28;
      doc.fill(DARK).fontSize(9).font('Sans');

      doc.y = itemsY;
      incItems.forEach((item: string) => {
        doc.text(`+ ${stripHtml(item)}`, M, doc.y, { width: colW });
      });
      const afterLeft = doc.y;

      doc.y = itemsY;
      notItems.forEach((item: string) => {
        doc.text(`x ${stripHtml(item)}`, M + colW + 12, doc.y, { width: colW });
      });

      doc.y = Math.max(afterLeft, doc.y);
      doc.moveDown(1);
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

// ─── Tour itinerary brochure ──────────────────────────────────────────────────

export async function generateBrochurePDF(itinerary: Itinerary): Promise<string> {
  // Pre-fetch logo + vessel images
  const [logoBuf, ...vesselImagesList] = await Promise.all([
    fetchImage(VOYAGERS_LOGO_PNG),
    ...(itinerary.cruise ?? []).filter(c => c.image).map(c => fetchImage(c.image)),
  ]);
  const vesselImages = new Map<string, Buffer | null>();
  (itinerary.cruise ?? []).filter(c => c.image).forEach((c, i) => {
    vesselImages.set(c.id, vesselImagesList[i] ?? null);
  });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });
    registerFonts(doc);

    doc.on('data',  (c: Buffer) => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    // ── HEADER ────────────────────────────────────────────────────────────────
    doc.rect(0, 0, PW, 88).fill(DARK);
    doc.rect(0, 85, PW, 4).fill(GOLD);

    if (logoBuf) {
      doc.image(logoBuf, M, 12, { height: 60, fit: [200, 60] });
    } else {
      doc.fill(WHITE).fontSize(22).font('Serif-Bold')
         .text('VOYAGERS', M, 20, { characterSpacing: 3 });
      doc.fill(GOLD).fontSize(7).font('Sans')
         .text('TRAVEL', M, 50, { characterSpacing: 5 });
    }

    // Tagline right-aligned
    doc.fill(GOLD).fontSize(8.5).font('Sans-Italic')
       .text('Expedition & Adventure Tours', 0, 38, {
         width: PW - M, align: 'right',
       });

    // ── TITLE BLOCK ───────────────────────────────────────────────────────────
    doc.rect(0, 89, PW, 90).fill(LIGHT);

    const titleFontSize = itinerary.title.length > 60 ? 15 : 18;
    doc.fill(DARK).fontSize(titleFontSize).font('Serif-Bold')
       .text(itinerary.title, M, 104, { width: CW, align: 'center' });

    doc.fill(GOLD).fontSize(11).font('Sans')
       .text(
         `${itinerary.duration} Days  ·  ${itinerary.destination}`,
         M, 150, { width: CW, align: 'center' }
       );

    doc.y = 190;

    // ── SHORT DESCRIPTION ─────────────────────────────────────────────────────
    if (itinerary.shortDescription) {
      const desc = stripHtml(itinerary.shortDescription);
      if (desc) {
        safeText(doc, desc, M, { width: CW, align: 'justify', fontSize: 10, fontName: 'Sans-Italic', fillColor: DARK });
        doc.moveDown(0.7);
      }
    }

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

      doc.fill(DARK).fontSize(9).font('Sans');
      leftItems.forEach(h => { doc.text(`- ${stripHtml(h)}`, M, doc.y, { width: colW }); });
      const afterLeft = doc.y;

      doc.y = startY;
      rightItems.forEach(h => { doc.text(`- ${stripHtml(h)}`, M + colW + 16, doc.y, { width: colW }); });

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

      doc.rect(M, startY, colW, 22).fill(GREEN);
      doc.fill(WHITE).fontSize(10).font('Serif-Bold')
         .text("What's Included", M + 6, startY + 6, { width: colW - 8 });

      doc.rect(M + colW + 12, startY, colW, 22).fill(RED);
      doc.fill(WHITE).fontSize(10).font('Serif-Bold')
         .text('Not Included', M + colW + 18, startY + 6, { width: colW - 8 });

      const itemsY = startY + 28;
      doc.fill(DARK).fontSize(9).font('Sans');

      doc.y = itemsY;
      incItems.forEach(item => {
        doc.text(`+ ${stripHtml(item)}`, M, doc.y, { width: colW });
      });
      const afterLeft = doc.y;

      doc.y = itemsY;
      notItems.forEach(item => {
        doc.text(`x ${stripHtml(item)}`, M + colW + 12, doc.y, { width: colW });
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

        const dayY = doc.y;
        doc.rect(M, dayY, CW, 20).fill(LIGHT);
        doc.fill(DARK).fontSize(10).font('Serif-Bold')
           .text(`Day ${day.day}  –  ${day.title}`, M + 8, dayY + 5, { width: CW - 16 });
        doc.y = dayY + 26;

        if (day.details) {
          const details = stripHtml(day.details);
          if (details) {
            safeText(doc, details, M, { width: CW, align: 'justify' });
          }
        }

        if (day.meals?.length) {
          doc.fill(MUTED).fontSize(8).font('Sans-Italic')
             .text(`Meals: ${day.meals.join(', ')}`, M, doc.y, { width: CW });
        }

        doc.moveDown(0.5);
      });
    }

    // ── VESSELS ───────────────────────────────────────────────────────────────
    if (itinerary.cruise?.length) {
      needSpace(doc, 120);
      sectionBar(doc, 'Vessels');

      itinerary.cruise.forEach(c => {
        needSpace(doc, 110);
        const vesselY = doc.y;
        const imgBuf = vesselImages.get(c.id) ?? null;
        const imgW = 160;
        const imgH = 100;

        if (imgBuf) {
          try {
            doc.image(imgBuf, M, vesselY, { width: imgW, height: imgH, cover: [imgW, imgH] });
          } catch {
            // image failed — continue without it
          }
        }

        const textX = imgBuf ? M + imgW + 16 : M;
        const textW = imgBuf ? CW - imgW - 16 : CW;
        const textY = vesselY + 10;

        doc.fill(DARK).fontSize(15).font('Serif-Bold')
           .text(c.name, textX, textY, { width: textW });

        if (c.type) {
          doc.fill(GOLD).fontSize(9).font('Sans')
             .text(c.type.toUpperCase(), textX, doc.y + 4, { width: textW, characterSpacing: 1 });
        }

        if (c.category) {
          doc.fill(MUTED).fontSize(9).font('Sans')
             .text(c.category, textX, doc.y + 4, { width: textW });
        }

        doc.y = vesselY + imgH + 12;
        doc.moveDown(0.5);
      });
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
