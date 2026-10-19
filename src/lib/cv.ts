import { prisma } from "@/lib/prisma";

const NON_PRINTABLE_CHARACTERS = /[^\x20-\x7E\n]/g;

function fileExtension(fileName: string): string | undefined {
  return fileName.split(".").pop()?.toLowerCase();
}

async function extractPdfText(pdf: Buffer): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const { text } = await pdfParse(pdf);
  return text;
}

export async function readCvText(userId: string): Promise<string> {
  const latestCv = await prisma.cvDocument.findFirst({
    where: { userId },
    orderBy: { uploadedAt: "desc" },
  });
  if (!latestCv) return "";

  const content = Buffer.from(latestCv.data);
  const extension = fileExtension(latestCv.originalName);
  if (extension === "txt") return content.toString("utf-8");
  if (extension === "pdf") return extractPdfText(content);
  return content.toString("utf-8").replace(NON_PRINTABLE_CHARACTERS, " ");
}
