// ============ PDF — jsPDF with proper download ============

function makePDF(title, textContent, subtitle='', customFileName='') {
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { toast('Biblioteca jsPDF nao carregou.','error'); return; }
  const doc = new jsPDF({ orientation:'p', unit:'mm', format:'a4' });
  const W = 210, M = 18, CW = W - M*2;
  let y = M;

  // Header bar
  doc.setFillColor(12, 15, 22);
  doc.rect(0, 0, W, 34, 'F');
  doc.setFillColor(34, 211, 180);
  doc.rect(0, 33, W, 1.5, 'F');
  doc.setTextColor(226, 232, 240);
  doc.setFontSize(18);
  doc.setFont('helvetica','bold');
  doc.text('Busca Sem Filtro', M, 16);
  doc.setFontSize(9);
  doc.setTextColor(122, 133, 153);
  doc.text('YouTube Analytics - Dark Channels', M, 23);
  doc.text(new Date().toLocaleString('pt-BR'), W - M, 23, { align:'right' });

  y = 42;

  // Title
  doc.setTextColor(34, 211, 180);
  doc.setFontSize(14);
  doc.setFont('helvetica','bold');
  const titleLines = doc.splitTextToSize(title, CW);
  doc.text(titleLines, M, y);
  y += titleLines.length * 6 + 4;

  if (subtitle) {
    doc.setTextColor(122, 133, 153);
    doc.setFontSize(9);
    doc.text(subtitle, M, y);
    y += 6;
  }

  doc.setDrawColor(60, 60, 80);
  doc.line(M, y, W - M, y);
  y += 6;

  // Strip HTML to plain text
  const tmp = document.createElement('div');
  tmp.innerHTML = textContent;
  const plain = (tmp.innerText || tmp.textContent || '').trim();

  // Write content
  const lines = doc.splitTextToSize(plain, CW);
  for (const line of lines) {
    if (y > 278) {
      doc.addPage();
      y = M;
    }
    const trimmed = line.trim();
    const isHeader = (trimmed.length > 3 && trimmed.length < 80 && !trimmed.endsWith('.') && !trimmed.endsWith(',') && (/^[A-Z\u00C0-\u024F\s\-\(\)]{5,}$/.test(trimmed) || trimmed.endsWith(':')));

    if (isHeader) {
      doc.setFont('helvetica','bold');
      doc.setTextColor(34, 211, 180);
      doc.setFontSize(11);
      y += 3;
    } else {
      doc.setFont('helvetica','normal');
      doc.setTextColor(80, 80, 90);
      doc.setFontSize(10);
    }
    doc.text(line, M, y);
    y += 5;
  }

  // Page numbers
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setTextColor(122, 133, 153);
    doc.setFontSize(8);
    doc.text('Pagina ' + i + '/' + total, W/2, 290, { align:'center' });
  }

  // Create clean filename
  const safeName = title
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .substring(0, 50);
  const fileName = customFileName
    ? customFileName.replace(/[^a-zA-Z0-9_\-]/g, '') + '.pdf'
    : 'BSF_' + safeName + '.pdf';

  // Force proper download with anchor element
  const pdfBlob = doc.output('blob');
  const url = URL.createObjectURL(pdfBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('PDF salvo: ' + fileName, 'success');
}
