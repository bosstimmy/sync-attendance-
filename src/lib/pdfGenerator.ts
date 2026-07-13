import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Attendee } from '../types';
import { calculateDistanceInMillimeters, formatProximity, getProximityStatus } from './geo';

export function generateAttendancePDF(
  eventName: string, 
  attendees: Attendee[], 
  eventDate: string,
  creatorLatitude?: number | null,
  creatorLongitude?: number | null,
  requireGeolocation: boolean = true,
  requireGender: boolean = true,
  requireMatricNumber: boolean = false,
  customQuestion: string | null = null,
  customQuestion2: string | null = null,
  customQuestion3: string | null = null,
  creatorName?: string | null,
  download: boolean = true
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Color Palette
  const primaryColor: [number, number, number] = [79, 70, 229]; // Indigo-600
  const grayColor: [number, number, number] = [107, 114, 128]; // Gray-500
  const darkColor: [number, number, number] = [17, 24, 39]; // Gray-900

  // 1. Header Block
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text('Attendance Record', 14, 20);

  // Divider Line
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.5);
  doc.line(14, 25, 196, 25);

  // 2. Event Metadata Details
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(grayColor[0], grayColor[1], grayColor[2]);
  doc.text('Event Name:', 14, 32);
  
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(darkColor[0], darkColor[1], darkColor[2]);
  doc.text(eventName, 48, 32);

  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(grayColor[0], grayColor[1], grayColor[2]);
  doc.text('Created On:', 14, 39);
  
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(darkColor[0], darkColor[1], darkColor[2]);
  doc.text(new Date(eventDate).toLocaleString(), 48, 39);

  let currentY = 46;

  if (creatorName) {
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(grayColor[0], grayColor[1], grayColor[2]);
    doc.text('Host/Instructor:', 14, currentY);
    
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(darkColor[0], darkColor[1], darkColor[2]);
    doc.text(creatorName, 48, currentY);
    currentY += 7;
  }

  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(grayColor[0], grayColor[1], grayColor[2]);
  doc.text('Total Joined:', 14, currentY);
  
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(darkColor[0], darkColor[1], darkColor[2]);
  doc.text(`${attendees.length} attendee${attendees.length === 1 ? '' : 's'}`, 48, currentY);
  currentY += 7;

  if (requireGeolocation) {
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(grayColor[0], grayColor[1], grayColor[2]);
    doc.text('Anchor Location:', 14, currentY);
    
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(darkColor[0], darkColor[1], darkColor[2]);
    const anchorStr = creatorLatitude !== null && creatorLatitude !== undefined && creatorLongitude !== null && creatorLongitude !== undefined
      ? `${creatorLatitude.toFixed(6)}, ${creatorLongitude.toFixed(6)}`
      : 'No reference coordinates recorded';
    doc.text(anchorStr, 48, currentY);
    currentY += 7;
  }

  // 3. Table of Attendees
  const sortedAttendees = [...attendees].sort((a, b) => 
    new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
  );

  // Pre-calculate device counts for duplicates in PDF
  const deviceCounts: { [key: string]: number } = {};
  sortedAttendees.forEach(att => {
    if (att.deviceId) {
      deviceCounts[att.deviceId] = (deviceCounts[att.deviceId] || 0) + 1;
    }
  });

  // Dynamic Column Setup
  const headers = ['#', 'Name'];
  if (requireGender) {
    headers.push('Gender');
  }
  if (requireMatricNumber) {
    headers.push('Matric Number');
  }
  if (customQuestion) {
    headers.push(`Answer 1 (${customQuestion})`);
  }
  if (customQuestion2) {
    headers.push(`Answer 2 (${customQuestion2})`);
  }
  if (customQuestion3) {
    headers.push(`Answer 3 (${customQuestion3})`);
  }
  if (requireGeolocation) {
    headers.push('Location Token');
    headers.push('Proximity (mm)');
    headers.push('Status Judgment');
  }
  headers.push('Join Time');
  headers.push('Join Date');

  const tableBody = sortedAttendees.map((att, index) => {
    const joinDate = new Date(att.joinedAt);
    
    // Flag same-device entries directly in the name column for auditing
    let displayName = att.name;
    if (att.deviceId && deviceCounts[att.deviceId] > 1) {
      displayName += ' (Shared Device)';
    }

    const row = [String(index + 1), displayName];

    if (requireGender) {
      row.push(att.gender || 'Not specified');
    }
    if (requireMatricNumber) {
      row.push(att.matricNumber || 'N/A');
    }
    if (customQuestion) {
      row.push(att.customResponse || 'N/A');
    }
    if (customQuestion2) {
      row.push(att.customResponse2 || 'N/A');
    }
    if (customQuestion3) {
      row.push(att.customResponse3 || 'N/A');
    }
    if (requireGeolocation) {
      const locString = att.latitude && att.longitude 
        ? `${att.latitude.toFixed(5)}, ${att.longitude.toFixed(5)}` 
        : 'No GPS data';

      const distMm = calculateDistanceInMillimeters(
        creatorLatitude,
        creatorLongitude,
        att.latitude,
        att.longitude
      );

      const proximityString = distMm !== null ? formatProximity(distMm) : 'N/A';
      const status = getProximityStatus(distMm);
      const judgmentString = distMm !== null ? status.label : 'N/A';

      row.push(locString, proximityString, judgmentString);
    }

    row.push(
      joinDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      joinDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    );

    return row;
  });

  const colStyles: { [key: number]: any } = {
    0: { cellWidth: 8, halign: 'center' },
  };
  
  // Style Join Time (second to last column)
  colStyles[headers.length - 2] = { cellWidth: 22, halign: 'center' };
  // Style Join Date (last column)
  colStyles[headers.length - 1] = { cellWidth: 24, halign: 'center' };

  autoTable(doc, {
    startY: currentY + 4,
    head: [headers],
    body: tableBody,
    theme: 'striped',
    headStyles: {
      fillColor: primaryColor,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    bodyStyles: {
      fontSize: 8.5,
      textColor: darkColor,
    },
    columnStyles: colStyles,
    didDrawPage: (data) => {
      // Footer: Page Numbering
      const pageCount = doc.getNumberOfPages();
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(grayColor[0], grayColor[1], grayColor[2]);
      
      const str = `Page ${data.pageNumber} of ${pageCount}`;
      const textWidth = doc.getStringUnitWidth(str) * doc.getFontSize() / doc.internal.scaleFactor;
      const x = doc.internal.pageSize.width - 14 - textWidth;
      const y = doc.internal.pageSize.height - 10;
      
      doc.text(str, x, y);
      
      // Standard branding/disclaimer footer
      doc.text('Online Attendance Tracker', 14, y);
    }
  });

  // Save the document (skipped when the caller only needs the in-memory doc,
  // e.g. to attach it to an email).
  if (download) {
    const sanitizedName = eventName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    doc.save(`attendance_${sanitizedName}.pdf`);
  }
  return doc;
}
