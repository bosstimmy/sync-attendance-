import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Attendee } from '../types';
import { calculateDistanceInMillimeters, formatProximity, getProximityStatus } from './geo';

export function generateAttendancePDF(
  eventName: string, 
  attendees: Attendee[], 
  eventDate: string,
  creatorLatitude?: number | null,
  creatorLongitude?: number | null
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

  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(grayColor[0], grayColor[1], grayColor[2]);
  doc.text('Total Joined:', 14, 46);
  
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(darkColor[0], darkColor[1], darkColor[2]);
  doc.text(`${attendees.length} attendee${attendees.length === 1 ? '' : 's'}`, 48, 46);

  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(grayColor[0], grayColor[1], grayColor[2]);
  doc.text('Anchor Location:', 14, 53);
  
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(darkColor[0], darkColor[1], darkColor[2]);
  const anchorStr = creatorLatitude !== null && creatorLatitude !== undefined && creatorLongitude !== null && creatorLongitude !== undefined
    ? `${creatorLatitude.toFixed(6)}, ${creatorLongitude.toFixed(6)}`
    : 'No reference coordinates recorded';
  doc.text(anchorStr, 48, 53);

  // 3. Table of Attendees
  const sortedAttendees = [...attendees].sort((a, b) => 
    new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
  );

  const tableBody = sortedAttendees.map((att, index) => {
    const joinDate = new Date(att.joinedAt);
    
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

    return [
      String(index + 1),
      att.name,
      att.gender || 'Not specified',
      locString,
      proximityString,
      judgmentString,
      joinDate.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    ];
  });

  autoTable(doc, {
    startY: 62,
    head: [['#', 'Name', 'Gender', 'Location Token', 'Proximity (mm)', 'Status Judgment', 'Checked In']],
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
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 38 },
      2: { cellWidth: 20, halign: 'center' },
      3: { cellWidth: 33, halign: 'center' },
      4: { cellWidth: 33, halign: 'center' },
      5: { cellWidth: 25, halign: 'center' },
      6: { cellWidth: 25, halign: 'center' },
    },
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

  // Save the document
  const sanitizedName = eventName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  doc.save(`attendance_${sanitizedName}.pdf`);
}
