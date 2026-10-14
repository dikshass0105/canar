import jsPDF from "jspdf";

interface ProfileData {
  name?: string | null;
  email?: string | null;
  bio?: string | null;
  education?: Array<{ degree: string; university: string; duration: string }>;
  projects?: Array<{ name: string; description: string; link: string; duration: string }>;
  skills?: Array<{ name: string; proficiency: string }>;
  experiences?: Array<{ role: string; company: string; duration: string; description: string }>;
}

const MARGIN = 20;
const BOTTOM_MARGIN = 20;

/**
 * Builds the profile PDF. Every block asks for the space it needs first, so long
 * profiles continue on a new page instead of running off the bottom (old bug: page
 * breaks were only checked at the start of some sections).
 */
export function generateProfilePDF(profile: ProfileData): void {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const textWidth = pageWidth - 2 * MARGIN;
  let y = MARGIN;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - BOTTOM_MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const heading = (title: string) => {
    ensureSpace(20); // keep a heading together with at least its first lines
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(title, MARGIN, y);
    y += 3;
    doc.setDrawColor(200);
    doc.line(MARGIN, y, pageWidth - MARGIN, y);
    y += 7;
  };

  const line = (text: string, opts: { bold?: boolean; size?: number; color?: [number, number, number]; gap?: number } = {}) => {
    const size = opts.size ?? 11;
    doc.setFontSize(size);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setTextColor(...(opts.color ?? [0, 0, 0]));
    const lineHeight = size * 0.5;
    // Long text is split to the page width and written line by line so it can span pages.
    for (const part of doc.splitTextToSize(text, textWidth) as string[]) {
      ensureSpace(lineHeight);
      doc.text(part, MARGIN, y);
      y += lineHeight;
    }
    y += opts.gap ?? 0;
    doc.setTextColor(0, 0, 0);
  };

  // Header
  line(profile.name || "Professional Profile", { bold: true, size: 24, gap: 4 });
  if (profile.email) line(profile.email, { size: 12, gap: 6 });
  else y += 4;

  if (profile.bio) {
    heading("Professional Summary");
    line(profile.bio, { gap: 8 });
  }

  if (profile.experiences?.length) {
    heading("Work Experience");
    profile.experiences.forEach((exp) => {
      ensureSpace(16);
      line(exp.role, { bold: true, size: 12 });
      line(`${exp.company} | ${exp.duration}`, { gap: exp.description ? 1 : 5 });
      if (exp.description) line(exp.description, { gap: 5 });
    });
    y += 3;
  }

  if (profile.education?.length) {
    heading("Education");
    profile.education.forEach((edu) => {
      ensureSpace(14);
      line(edu.degree, { bold: true, size: 12 });
      line(`${edu.university} | ${edu.duration}`, { gap: 5 });
    });
    y += 3;
  }

  if (profile.projects?.length) {
    heading("Projects");
    profile.projects.forEach((project) => {
      ensureSpace(16);
      line(project.name, { bold: true, size: 12 });
      if (project.duration) line(project.duration, { gap: 1 });
      if (project.description) line(project.description, { gap: 1 });
      if (project.link) line(`Link: ${project.link}`, { color: [0, 0, 255] });
      y += 5;
    });
    y += 3;
  }

  if (profile.skills?.length) {
    heading("Skills");
    line(profile.skills.map((s) => `${s.name} (${s.proficiency})`).join(", "));
  }

  // Page numbers (only useful with more than one page)
  const pages = doc.getNumberOfPages();
  if (pages > 1) {
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(9);
      doc.setTextColor(150);
      doc.text(`Page ${i} of ${pages}`, pageWidth / 2, pageHeight - 10, { align: "center" });
    }
  }

  // Filename: only safe characters, with a timestamp
  const safeName = (profile.name || "profile").trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "profile";
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  doc.save(`${safeName}_${timestamp}.pdf`);
}
