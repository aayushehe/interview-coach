// Reads the text out of an uploaded resume or job description, inside the browser.
// The file itself is never uploaded anywhere: only the extracted text is used,
// exactly like text you would have pasted by hand.
//
// Supported: PDF (with real text, not a scan/photo), DOCX, TXT, MD.

export const MAX_EXTRACTED_CHARS = 6000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type ExtractedText = { text: string; truncated: boolean };

/** Tidies spacing so the AI gets clean text. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type PdfTextItem = { str?: string; hasEOL?: boolean };
type PdfDocumentLike = {
  numPages: number;
  getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: PdfTextItem[] }> }>;
};

/** Joins the text of every page of an already-loaded PDF document. */
export async function pdfDocumentToText(doc: PdfDocumentLike): Promise<string> {
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    let pageText = '';
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      pageText += item.str + (item.hasEOL ? '\n' : ' ');
    }
    pages.push(pageText);
  }
  return pages.join('\n\n');
}

async function readPdf(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  return pdfDocumentToText(doc as unknown as PdfDocumentLike);
}

async function readDocx(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

export async function extractTextFromFile(file: File): Promise<ExtractedText> {
  if (file.size > MAX_FILE_BYTES) throw new Error('This file is larger than 10 MB. Please use a smaller file.');
  const name = file.name.toLowerCase();
  let raw: string;
  try {
    if (name.endsWith('.pdf')) raw = await readPdf(await file.arrayBuffer());
    else if (name.endsWith('.docx')) raw = await readDocx(await file.arrayBuffer());
    else if (name.endsWith('.txt') || name.endsWith('.md')) raw = await file.text();
    else if (name.endsWith('.doc')) throw new Error('Old .doc files are not supported. Please save it as PDF or DOCX and upload again.');
    else throw new Error('Please upload a PDF, DOCX or TXT file.');
  } catch (error) {
    if (error instanceof Error && /Old \.doc|Please upload/.test(error.message)) throw error;
    throw new Error('Could not read this file. Try another copy, or paste the text instead.');
  }

  const text = normalizeText(raw);
  if (text.length < 40) {
    throw new Error('No readable text was found. It may be a scanned image. Please paste the text instead.');
  }
  return text.length > MAX_EXTRACTED_CHARS
    ? { text: text.slice(0, MAX_EXTRACTED_CHARS), truncated: true }
    : { text, truncated: false };
}
